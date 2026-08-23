// Template store + candidate galleries (Appwrite reads/writes).
//
// Deliberately importable WITHOUT lib/appwrite/server (which pulls in
// next/headers): callers pass a Databases handle. That keeps the module usable
// from Route Handlers, scripts and vitest alike, and keeps the
// biometricService dependency-injection seam clean.
//
// This file is the church-specific half of the biometric port. Everything else
// in lib/biometrics/ came across from SEMP unchanged; this one was rewritten,
// because SEMP scoped its galleries by exam hall and slot and the church scopes
// them by meeting roster.

import { ID, Query, type Databases, type Models } from 'node-appwrite'
import {
  COLLECTIONS,
  DATABASE_ID,
  FINGER_LABELS,
  TEMPLATES_PER_MEMBER,
  VARIATIONS_PER_FINGER,
  type FingerLabel,
} from '@/lib/appwrite/config'
import { decodeXytTemplate, countMinutiae } from './codec'
import type {
  BiometricTemplateDoc,
  BiometricTemplateMeta,
  EnrolledMemberSummary,
  MatcherCandidate,
} from './types'

const PAGE = 200

/** One finger, three presses. Anything more is a client bug. */
export const MAX_TEMPLATES_PER_ENROLL = VARIATIONS_PER_FINGER

// The bulk write API exists at runtime but is missing from the SDK's types.
type BulkDatabases = {
  createDocuments: (db: string, col: string, docs: object[]) => Promise<unknown>
}
const bulk = (db: Databases): BulkDatabases => db as unknown as BulkDatabases

function docToTemplate(doc: Models.Document): BiometricTemplateDoc {
  const d = doc as unknown as Record<string, unknown>
  return {
    $id: doc.$id,
    member_id: String(d.member_id ?? ''),
    finger_label: (d.finger_label as FingerLabel) ?? 'right-thumb',
    variation: Number(d.variation ?? 1),
    template: String(d.template ?? ''),
    minutiae: Number(d.minutiae ?? 0),
    created_by: (d.created_by as string | null) ?? null,
    $createdAt: doc.$createdAt,
  }
}

async function listAllTemplateDocs(
  databases: Databases,
  extraQueries: string[] = [],
): Promise<BiometricTemplateDoc[]> {
  const out: BiometricTemplateDoc[] = []
  let cursor: string | null = null
  for (;;) {
    const queries = [Query.limit(PAGE), ...extraQueries]
    if (cursor) queries.push(Query.cursorAfter(cursor))
    const page = await databases.listDocuments(
      DATABASE_ID,
      COLLECTIONS.biometric_templates,
      queries,
    )
    out.push(...page.documents.map(docToTemplate))
    if (page.documents.length < PAGE) return out
    cursor = page.documents[page.documents.length - 1].$id
  }
}

export async function listTemplatesForMember(
  databases: Databases,
  member_id: string,
): Promise<BiometricTemplateDoc[]> {
  return listAllTemplateDocs(databases, [Query.equal('member_id', member_id)])
}

export function toMeta(doc: BiometricTemplateDoc): BiometricTemplateMeta {
  return {
    $id: doc.$id,
    member_id: doc.member_id,
    finger_label: doc.finger_label,
    variation: doc.variation,
    minutiae: doc.minutiae,
    created_at: doc.$createdAt,
  }
}

function summarise(docs: BiometricTemplateDoc[]): Map<string, EnrolledMemberSummary> {
  const byMember = new Map<string, EnrolledMemberSummary>()
  for (const d of docs) {
    let s = byMember.get(d.member_id)
    if (!s) {
      s = { member_id: d.member_id, template_count: 0, by_finger: {}, complete: false }
      byMember.set(d.member_id, s)
    }
    s.template_count++
    s.by_finger[d.finger_label] = (s.by_finger[d.finger_label] ?? 0) + 1
  }
  for (const s of byMember.values()) {
    // "Complete" means every finger has all three presses — not merely that the
    // total happens to reach 12. Twelve presses of one thumb is not enrolment.
    s.complete = FINGER_LABELS.every((f) => (s.by_finger[f] ?? 0) >= VARIATIONS_PER_FINGER)
  }
  return byMember
}

/** Enrolment state for every member who has at least one template. */
export async function listEnrolledSummaries(
  databases: Databases,
): Promise<EnrolledMemberSummary[]> {
  const docs = await listAllTemplateDocs(databases)
  return [...summarise(docs).values()].sort((a, b) => a.member_id.localeCompare(b.member_id))
}

/** Same data keyed by member id, for joining onto a member list. */
export async function enrolmentByMember(
  databases: Databases,
): Promise<Map<string, EnrolledMemberSummary>> {
  return summarise(await listAllTemplateDocs(databases))
}

export function emptyEnrolment(member_id: string): EnrolledMemberSummary {
  return { member_id, template_count: 0, by_finger: {}, complete: false }
}

/** Total presses a fully-enrolled member has. Re-exported so UI code does not
 *  have to know the 4 × 3 arithmetic. */
export const FULL_ENROLMENT_TEMPLATES = TEMPLATES_PER_MEMBER

/**
 * Store validated templates for ONE finger. The caller has already verified
 * the member exists.
 */
export async function storeTemplates(
  databases: Databases,
  opts: {
    member_id: string
    finger_label: FingerLabel
    templates: string[]
    replace: boolean
    created_by?: string
  },
): Promise<{ created: number; deleted: number }> {
  const valid: { template: string; minutiae: number }[] = []
  for (const t of opts.templates.slice(0, MAX_TEMPLATES_PER_ENROLL)) {
    const text = decodeXytTemplate(t)
    if (text) valid.push({ template: t, minutiae: countMinutiae(text) })
  }
  if (valid.length === 0) throw new Error('no valid templates in request')

  let deleted = 0
  if (opts.replace) {
    deleted = await deleteTemplatesForFinger(databases, opts.member_id, opts.finger_label)
  }
  invalidateCandidateCache()

  await bulk(databases).createDocuments(
    DATABASE_ID,
    COLLECTIONS.biometric_templates,
    valid.map((v, i) => ({
      $id: ID.unique(),
      member_id: opts.member_id,
      finger_label: opts.finger_label,
      variation: i + 1,
      template: v.template,
      minutiae: v.minutiae,
      created_by: opts.created_by ?? null,
    })),
  )
  return { created: valid.length, deleted }
}

/**
 * Bulk delete with a feature-detect + parallel fallback. The sequential loop
 * this replaces cost ~800ms per template against a remote Appwrite, which for
 * a twelve-template member is ten seconds of an admin staring at a spinner.
 */
async function deleteWhere(
  databases: Databases,
  queries: string[],
  fallback: () => Promise<BiometricTemplateDoc[]>,
): Promise<number> {
  invalidateCandidateCache()
  const dbAny = databases as unknown as {
    deleteDocuments?: (db: string, coll: string, queries?: string[]) => Promise<unknown>
  }
  if (typeof dbAny.deleteDocuments === 'function') {
    const res = (await dbAny.deleteDocuments(
      DATABASE_ID,
      COLLECTIONS.biometric_templates,
      queries,
    )) as { total?: number } | undefined
    return typeof res?.total === 'number' ? res.total : 0
  }
  const docs = await fallback()
  await Promise.all(
    docs.map((d) =>
      databases.deleteDocument(DATABASE_ID, COLLECTIONS.biometric_templates, d.$id),
    ),
  )
  return docs.length
}

export async function deleteTemplatesForMember(
  databases: Databases,
  member_id: string,
): Promise<number> {
  return deleteWhere(databases, [Query.equal('member_id', member_id)], () =>
    listTemplatesForMember(databases, member_id),
  )
}

export async function deleteTemplatesForFinger(
  databases: Databases,
  member_id: string,
  finger_label: FingerLabel,
): Promise<number> {
  return deleteWhere(
    databases,
    [Query.equal('member_id', member_id), Query.equal('finger_label', finger_label)],
    async () =>
      (await listTemplatesForMember(databases, member_id)).filter(
        (d) => d.finger_label === finger_label,
      ),
  )
}

// === Candidate galleries ===================================================
//
// Every scan pays one comparison per stored template in the gallery, at ~1ms
// for an impostor (lib/biometrics/wasm-matcher.ts). At twelve templates a head
// the whole registry does not fit inside the time a person will hold still.
//
// Accuracy matters at least as much as cost: false-accept probability grows
// with the number of comparisons, so a smaller CORRECT gallery is safer, not
// merely faster.
//
// The galleries here mirror what the church actually is:
//   - a service is open to every active member, so that IS the gallery;
//   - a restricted meeting has a roster, which is a much smaller gallery.
//
// Two-stage escalation for restricted meetings lives in
// lib/services/biometricService.ts — see the note there on why an unauthorised
// person must still be identified.

/**
 * How long a loaded gallery is served before it is refreshed.
 *
 * Five minutes, not one, and the reason it can be this long is that every write
 * that changes the gallery calls `invalidateCandidateCache()` explicitly —
 * enrolling, deleting a template, deleting a member, flipping a member
 * inactive. The TTL is the backstop, not the freshness mechanism.
 *
 * It used to be 60s, and the cost was measured rather than guessed: fetching
 * the live gallery (99 members, 1,188 templates) takes **5.7 seconds**. At a
 * 60-second TTL that bill landed on one unlucky member every minute, who stood
 * at the scanner for eight seconds while the other fifty-nine got sub-second
 * answers — and nothing on the kiosk could explain why.
 */
const CANDIDATE_CACHE_TTL_MS = 5 * 60_000

/** Keyed by scope: `all` or `meeting:<id>`. */
const candidateCache = new Map<string, { at: number; data: MatcherCandidate[] }>()
/** Refreshes in flight, so a burst of scans triggers ONE re-fetch, not twenty. */
const refreshing = new Map<string, Promise<MatcherCandidate[]>>()

export function invalidateCandidateCache(): void {
  candidateCache.clear()
  refreshing.clear()
}

/**
 * Serve what we have, refresh underneath.
 *
 * A gallery that has aged past its TTL is still the right answer for the next
 * few hundred milliseconds — the alternative is making somebody wait 5.7
 * seconds to be told something the stale copy already knew. So an expired entry
 * is returned immediately and a refresh runs in the background.
 *
 * Note the asymmetry with `invalidateCandidateCache`, and it is deliberate:
 * expiry serves stale, but an explicit invalidation DROPS the entry so the next
 * scan blocks on a fresh load. Enrol-then-immediately-test is a real flow, and
 * a member who has just been enrolled must be matchable on the very next press.
 */
async function cached(
  key: string,
  maxAge: number,
  load: () => Promise<MatcherCandidate[]>,
): Promise<MatcherCandidate[]> {
  const hit = candidateCache.get(key)
  if (hit && Date.now() - hit.at < maxAge) return hit.data

  if (hit) {
    if (!refreshing.has(key)) {
      const job = load()
        .then((data) => {
          candidateCache.set(key, { at: Date.now(), data })
          return data
        })
        .catch(() => hit.data) // keep serving the stale copy; try again later
        .finally(() => refreshing.delete(key))
      refreshing.set(key, job)
    }
    return hit.data
  }

  // Nothing cached at all — this one has to wait.
  const existing = refreshing.get(key)
  if (existing) return existing
  const job = load()
    .then((data) => {
      candidateCache.set(key, { at: Date.now(), data })
      return data
    })
    .finally(() => refreshing.delete(key))
  refreshing.set(key, job)
  return job
}

function groupTemplates(docs: BiometricTemplateDoc[]): MatcherCandidate[] {
  const byMember = new Map<string, string[]>()
  for (const d of docs) {
    const arr = byMember.get(d.member_id) ?? []
    arr.push(d.template)
    byMember.set(d.member_id, arr)
  }
  return [...byMember.entries()].map(([member_id, templates]) => ({ member_id, templates }))
}

async function templatesForMembers(
  databases: Databases,
  memberIds: string[],
): Promise<MatcherCandidate[]> {
  if (memberIds.length === 0) return []
  const docs: BiometricTemplateDoc[] = []
  // Appwrite caps the size of an `equal` array; chunk rather than assume.
  const CHUNK = 100
  for (let i = 0; i < memberIds.length; i += CHUNK) {
    const slice = memberIds.slice(i, i + CHUNK)
    docs.push(...(await listAllTemplateDocs(databases, [Query.equal('member_id', slice)])))
  }
  return groupTemplates(docs)
}

/** Member `$id`s on a meeting's authorised roster. */
export async function rosterMemberIds(
  databases: Databases,
  meetingId: string,
): Promise<string[]> {
  const out = new Set<string>()
  let cursor: string | null = null
  for (;;) {
    const queries = [
      Query.equal('meeting_id', meetingId),
      Query.select(['$id', 'member_id']),
      Query.limit(PAGE),
    ]
    if (cursor) queries.push(Query.cursorAfter(cursor))
    const page = await databases.listDocuments(
      DATABASE_ID,
      COLLECTIONS.meeting_members,
      queries,
    )
    for (const d of page.documents) {
      const id = (d as Models.Document & { member_id?: string }).member_id
      if (id) out.add(id)
    }
    if (page.documents.length < PAGE) break
    cursor = page.documents[page.documents.length - 1].$id
  }
  return [...out]
}

/** `$id`s of every ACTIVE member. Inactive members are excluded from the
 *  gallery outright — a lapsed member should not be silently matchable. */
async function activeMemberIds(databases: Databases): Promise<string[]> {
  const out: string[] = []
  let cursor: string | null = null
  for (;;) {
    const queries = [
      Query.equal('status', 'active'),
      Query.select(['$id']),
      Query.limit(PAGE),
    ]
    if (cursor) queries.push(Query.cursorAfter(cursor))
    const page = await databases.listDocuments(DATABASE_ID, COLLECTIONS.members, queries)
    out.push(...page.documents.map((d) => d.$id))
    if (page.documents.length < PAGE) break
    cursor = page.documents[page.documents.length - 1].$id
  }
  return out
}

/** Every active member's templates — the gallery for an open service. */
export async function loadAllCandidateTemplates(
  databases: Databases,
  opts: { maxAgeMs?: number } = {},
): Promise<MatcherCandidate[]> {
  return cached('all', opts.maxAgeMs ?? CANDIDATE_CACHE_TTL_MS, async () =>
    templatesForMembers(databases, await activeMemberIds(databases)),
  )
}

/** A restricted meeting's roster — the small, fast, correct gallery. */
export async function loadCandidatesForMeeting(
  databases: Databases,
  meetingId: string,
  opts: { maxAgeMs?: number } = {},
): Promise<MatcherCandidate[]> {
  return cached(
    `meeting:${meetingId}`,
    opts.maxAgeMs ?? CANDIDATE_CACHE_TTL_MS,
    async () => templatesForMembers(databases, await rosterMemberIds(databases, meetingId)),
  )
}

/**
 * Load the gallery ahead of the first scan.
 *
 * Called when a session is activated or resumed. Without it the FIRST member of
 * the service pays the whole 5.7-second fetch while standing at the scanner,
 * which is both the worst possible moment and the one someone always notices.
 *
 * Fire-and-forget on purpose: activation must not fail, or even wait, because
 * the gallery was slow to load.
 */
export function warmCandidateCache(
  databases: Databases,
  scope: { meeting_id: string; restricted: boolean },
): void {
  void loadAllCandidateTemplates(databases).catch(() => {})
  if (scope.restricted) {
    void loadCandidatesForMeeting(databases, scope.meeting_id).catch(() => {})
  }
}
