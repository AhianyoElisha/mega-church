/**
 * End-to-end smoke for constituencies, BACENTAS, BASONTAS, care links, head
 * scoping, member numbers, birthdays and push — driven through a running server
 * against the LIVE Appwrite project.
 *
 *   npm run dev -- -p 3111     # in one terminal
 *   npm run e2e:groups         # in another
 *
 * Unlike `e2e-smoke.mjs` this NEVER opens an attendance session and never
 * touches the two services, so it is safe to run during a service. It creates
 * its own throwaway constituency, category, bacentas, basontas and members, and
 * deletes all of them at the end — it only ever touches what it made.
 *
 * The one shared thing it writes is a `notification_runs` row for today, and
 * only if `E2E_ALLOW_NOTIFY=1`. Without that flag the birthday-run checks are
 * skipped, because claiming today's run would stop the real morning
 * notification from going out.
 *
 * It NEVER SENDS AN SMS. The treasurer section asserts refusals and reads the
 * log; a suite that spends the church's SMS credit every time it runs is a
 * suite nobody runs.
 *
 * ## Why the whole serving-group half was renamed
 *
 * This suite was written when `bacentas` was one collection doing two unrelated
 * jobs. After `scripts/migrate-basonta.ts` a BACENTA is a PLACE under a
 * constituency and a BASONTA is a serving group, so every assertion that used
 * to say "bacenta" and mean "choir" now says basonta. The old file did not
 * merely have stale names — it asserted `bacenta_ids` as a many-to-many list
 * and that "adding to one bacenta did not remove them from the other", which is
 * now the exact INVERSE of the rule: assigning a bacenta MOVES somebody.
 * Running it unchanged would have written pre-migration data into a live
 * congregation and left unfiled bacentas behind.
 *
 * Credentials come from the SEED_* pairs in .env.local.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BASE = process.env.BASE_URL ?? 'http://localhost:3111'

/**
 * `.env.local` first, then the real environment ON TOP.
 *
 * The override matters when the seeded credentials have drifted from what the
 * project actually holds — someone changes the admin password in the console,
 * or the template `leader` account is replaced by the church’s real heads, and
 * the suite stops being runnable at all. Being able to point it at a throwaway
 * pair for one run is the difference between running it and shelving it. It is
 * also what lets CI supply credentials it will never write to a file.
 */
const env = {
  ...Object.fromEntries(
    fs
      .readFileSync(path.join(ROOT, '.env.local'), 'utf8')
      .split(/\r?\n/)
      .filter((l) => l.includes('=') && !l.trimStart().startsWith('#'))
      .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
  ),
  ...Object.fromEntries(
    Object.entries(process.env).filter(([k, v]) => k.startsWith('SEED_') && v),
  ),
}

let failures = 0
const ok = (m) => console.log(`  ✓ ${m}`)
const bad = (m) => {
  console.log(`  ✗ ${m}`)
  failures++
}

/** One cookie jar per role, so the three sessions do not overwrite each other. */
function makeClient() {
  let cookie = ''
  return async function api(pathname, init = {}) {
    const res = await fetch(BASE + pathname, {
      ...init,
      headers: {
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...(cookie ? { cookie } : {}),
        ...(init.headers ?? {}),
      },
      redirect: 'manual',
    })
    const setCookie = res.headers.get('set-cookie')
    if (setCookie) cookie = setCookie.split(';')[0]
    let body = null
    try {
      body = await res.json()
    } catch {
      /* not json */
    }
    return { status: res.status, body }
  }
}

async function signIn(api, email, password, label) {
  const res = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
  if (res.status !== 200 || !res.body?.ok) {
    bad(`${label} login failed (${res.status}): ${JSON.stringify(res.body)}`)
    return null
  }
  ok(`${label} signed in, label=${res.body.user.label}`)
  return res.body.user
}

async function main() {
  console.log(`Groups E2E against ${BASE}\n`)

  const admin = makeClient()
  const leader = makeClient()
  const celebrations = makeClient()
  const anon = makeClient()
  const treasurer = makeClient()
  const shepherd = makeClient()

  const stamp = Date.now()
  const created = { constituencies: [], bacentas: [], basontas: [], categories: [], members: [] }

  console.log('auth')
  const adminUser = await signIn(admin, env.SEED_ADMIN_EMAIL, env.SEED_ADMIN_PASSWORD, 'admin')
  if (!adminUser) process.exit(1)
  const leaderUser = await signIn(
    leader,
    env.SEED_LEADER_EMAIL,
    env.SEED_LEADER_PASSWORD,
    'leader',
  )
  const celebUser = await signIn(
    celebrations,
    env.SEED_CELEBRATIONS_EMAIL,
    env.SEED_CELEBRATIONS_PASSWORD,
    'celebrations',
  )
  const treasurerUser = await signIn(
    treasurer,
    env.SEED_TREASURER_EMAIL,
    env.SEED_TREASURER_PASSWORD,
    'treasurer',
  )
  const shepherdUser = await signIn(
    shepherd,
    env.SEED_SHEPHERD_EMAIL,
    env.SEED_SHEPHERD_PASSWORD,
    'shepherd',
  )

  try {
    // --- constituencies -----------------------------------------------------
    console.log('\nconstituencies')
    const c1 = await admin('/api/constituencies', {
      method: 'POST',
      body: JSON.stringify({ name: `E2E Ahodwo ${stamp}`, description: 'Throwaway' }),
    })
    if (c1.status !== 201) {
      bad(`create constituency failed (${c1.status}): ${JSON.stringify(c1.body)}`)
      process.exit(1)
    }
    const constituencyId = c1.body.constituency.$id
    created.constituencies.push(constituencyId)
    ok(`created "${c1.body.constituency.name}"`)

    const dupe = await admin('/api/constituencies', {
      method: 'POST',
      body: JSON.stringify({ name: `  e2e ahodwo ${stamp}  ` }),
    })
    dupe.status === 400 && /already exists/i.test(dupe.body?.error ?? '')
      ? ok('duplicate name refused, case- and space-insensitively')
      : bad(`duplicate name gave ${dupe.status}: ${JSON.stringify(dupe.body)}`)

    // Appointing a non-leader account as head must be refused — a head who
    // cannot open the page is worse than no head at all.
    const badHead = await admin('/api/constituencies', {
      method: 'POST',
      body: JSON.stringify({ name: `E2E BadHead ${stamp}`, head_user_id: adminUser.id }),
    })
    badHead.status === 400 && /leader account/i.test(badHead.body?.error ?? '')
      ? ok('an admin account is refused as a group head')
      : bad(`non-leader head gave ${badHead.status}: ${JSON.stringify(badHead.body)}`)

    // --- basontas: both shapes ---------------------------------------------
    console.log('\nbasontas')
    const cat = await admin('/api/basonta-categories', {
      method: 'POST',
      body: JSON.stringify({ name: `E2E Choir ${stamp}` }),
    })
    if (cat.status !== 201) {
      bad(`create category failed (${cat.status}): ${JSON.stringify(cat.body)}`)
      process.exit(1)
    }
    const categoryId = cat.body.category.$id
    created.categories.push(categoryId)
    ok(`created category "${cat.body.category.name}"`)

    const biazo = await admin('/api/basontas', {
      method: 'POST',
      body: JSON.stringify({ name: 'Biazo', category_id: categoryId }),
    })
    const living = await admin('/api/basontas', {
      method: 'POST',
      body: JSON.stringify({ name: 'Living Waters', category_id: categoryId }),
    })
    const tech = await admin('/api/basontas', {
      method: 'POST',
      body: JSON.stringify({ name: `E2E Technical Team ${stamp}` }),
    })
    for (const [label, res] of [
      ['Biazo', biazo],
      ['Living Waters', living],
      ['Technical Team', tech],
    ]) {
      if (res.status === 201) created.basontas.push(res.body.basonta.$id)
      else bad(`create ${label} failed (${res.status}): ${JSON.stringify(res.body)}`)
    }
    biazo.body?.basonta?.category_id === categoryId
      ? ok('Biazo is filed under the category')
      : bad('Biazo lost its category')
    tech.body?.basonta?.category_id === null
      ? ok('a basonta created with no category is standalone (category_id null)')
      : bad(`standalone basonta has category_id ${JSON.stringify(tech.body?.basonta?.category_id)}`)

    // Same name, different category, is two different real groups.
    const sameNameOtherCategory = await admin('/api/basontas', {
      method: 'POST',
      body: JSON.stringify({ name: 'Biazo' }),
    })
    if (sameNameOtherCategory.status === 201) {
      created.basontas.push(sameNameOtherCategory.body.basonta.$id)
      ok('"Biazo" standalone is allowed alongside "Biazo" under Choir')
    } else {
      bad(`same name in another category refused (${sameNameOtherCategory.status})`)
    }

    const dupeInCategory = await admin('/api/basontas', {
      method: 'POST',
      body: JSON.stringify({ name: '  biazo ', category_id: categoryId }),
    })
    dupeInCategory.status === 400
      ? ok('a duplicate name WITHIN a category is refused')
      : bad(`duplicate in category gave ${dupeInCategory.status}`)

    // A category holding basontas must not be deletable — deleting it would
    // orphan real groups full of real people.
    const delHeld = await admin(`/api/basonta-categories/${categoryId}`, { method: 'DELETE' })
    delHeld.status === 409
      ? ok('a category with basontas in it refuses to be deleted (409)')
      : bad(`deleting a held category gave ${delHeld.status}`)

    // --- a member in a constituency and TWO basontas -------------------------
    console.log('\nmember with groups')
    const member = await admin('/api/members', {
      method: 'POST',
      body: JSON.stringify({
        first_name: 'Kofi',
        last_name: `E2EGroups${stamp}`,
        call_number: '0244000111',
        birth_month: 2,
        birth_day: 29,
        constituency_id: constituencyId,
        basonta_ids: [biazo.body.basonta.$id, tech.body.basonta.$id],
      }),
    })
    if (member.status !== 201) {
      bad(`create member failed (${member.status}): ${JSON.stringify(member.body)}`)
      process.exit(1)
    }
    const memberId = member.body.member.$id
    created.members.push(memberId)
    ok('member registered with a constituency and two basontas at once')

    const read = await admin(`/api/members/${memberId}`)
    read.body?.member?.constituency_id === constituencyId
      ? ok('constituency read back on the member')
      : bad(`constituency is ${read.body?.member?.constituency_id}`)
    const readBasontas = (read.body?.basonta_ids ?? []).slice().sort()
    readBasontas.length === 2
      ? ok('both basontas read back — one member, several work groups')
      : bad(`basonta_ids came back as ${JSON.stringify(readBasontas)}`)

    // A PATCH that never mentions basontas must leave them alone. This is the
    // bug that would otherwise remove somebody from their choir every time an
    // admin corrected a phone number.
    const patch = await admin(`/api/members/${memberId}`, {
      method: 'PATCH',
      body: JSON.stringify({ call_number: '0244000222' }),
    })
    patch.status === 200 && (patch.body?.basonta_ids ?? []).length === 2
      ? ok('editing an unrelated field leaves basonta membership untouched')
      : bad(`unrelated PATCH left basonta_ids = ${JSON.stringify(patch.body?.basonta_ids)}`)

    // An explicit empty array DOES clear them.
    const clear = await admin(`/api/members/${memberId}`, {
      method: 'PATCH',
      body: JSON.stringify({ basonta_ids: [] }),
    })
    const cleared = clear.body?.basonta_ids ?? ['not-returned']
    cleared.length === 0
      ? ok('an explicit empty list clears basonta membership')
      : bad(`clearing left ${JSON.stringify(cleared)}`)

    // Put one back for the bulk-assign checks below.
    await admin(`/api/members/${memberId}`, {
      method: 'PATCH',
      body: JSON.stringify({ basonta_ids: [biazo.body.basonta.$id] }),
    })

    const bogus = await admin(`/api/members/${memberId}`, {
      method: 'PATCH',
      body: JSON.stringify({ constituency_id: 'does-not-exist' }),
    })
    bogus.status === 400
      ? ok('a constituency id that names nothing is refused')
      : bad(`bogus constituency gave ${bogus.status}`)

    // --- bulk assignment ----------------------------------------------------
    console.log('\nbulk assignment')
    const assignBasonta = await admin(`/api/basontas/${living.body.basonta.$id}/members`, {
      method: 'POST',
      body: JSON.stringify({ member_ids: [memberId], mode: 'add' }),
    })
    assignBasonta.status === 200 && assignBasonta.body.added === 1
      ? ok('bulk-added a member to a second basonta')
      : bad(`basonta assign gave ${assignBasonta.status}: ${JSON.stringify(assignBasonta.body)}`)

    const afterAssign = await admin(`/api/members/${memberId}`)
    const afterIds = afterAssign.body?.basonta_ids ?? []
    afterIds.length === 2
      ? ok('adding to one basonta did not remove them from the other')
      : bad(`member now in ${JSON.stringify(afterIds)}`)

    // Adding the same person twice must not create a second row.
    const again = await admin(`/api/basontas/${living.body.basonta.$id}/members`, {
      method: 'POST',
      body: JSON.stringify({ member_ids: [memberId], mode: 'add' }),
    })
    again.body?.added === 0
      ? ok('re-adding an existing member is a no-op, not a duplicate row')
      : bad(`re-add reported added=${again.body?.added}`)

    const detail = await admin(`/api/basontas/${living.body.basonta.$id}`)
    detail.body?.members?.some((m) => m.$id === memberId)
      ? ok('the basonta roster lists the member, with attendance columns')
      : bad('member missing from the basonta roster')

    const cDetail = await admin(`/api/constituencies/${constituencyId}`)
    cDetail.body?.members?.some((m) => m.$id === memberId)
      ? ok('the constituency roster lists the member')
      : bad('member missing from the constituency roster')

    // --- bacentas: PLACES, and the opposite of a basonta ---------------------
    //
    // Everything here is the mirror image of the basonta section above, and
    // that is the point of the split. A basonta is a JOIN and assigning ADDS; a
    // bacenta is a FIELD and assigning MOVES. The two routes look almost
    // identical, so the suite proves they behave OPPOSITELY rather than
    // trusting that somebody kept them apart.
    console.log('\nbacentas (places)')
    const anloga = await admin('/api/bacentas', {
      method: 'POST',
      body: JSON.stringify({ name: `E2E Anloga ${stamp}`, constituency_id: constituencyId }),
    })
    const susu = await admin('/api/bacentas', {
      method: 'POST',
      body: JSON.stringify({ name: `E2E Susuankyi ${stamp}`, constituency_id: constituencyId }),
    })
    for (const res of [anloga, susu]) {
      if (res.status === 201) created.bacentas.push(res.body.bacenta.$id)
      else bad(`create bacenta failed (${res.status}): ${JSON.stringify(res.body)}`)
    }
    if (anloga.status !== 201 || susu.status !== 201) {
      bad('cannot continue the bacenta section without two places')
    } else {
      const anlogaId = anloga.body.bacenta.$id
      const susuId = susu.body.bacenta.$id

      anloga.body.bacenta.constituency_id === constituencyId
        ? ok('a bacenta is filed into its constituency')
        : bad(`bacenta filed into ${anloga.body.bacenta.constituency_id}`)

      // Names are unique per CONSTITUENCY, not globally — two constituencies
      // may each have a place the congregation calls "Central".
      const dupePlace = await admin('/api/bacentas', {
        method: 'POST',
        body: JSON.stringify({
          name: `  e2e anloga ${stamp}  `,
          constituency_id: constituencyId,
        }),
      })
      dupePlace.status === 400
        ? ok('a duplicate bacenta name in the SAME constituency is refused')
        : bad(`duplicate bacenta name gave ${dupePlace.status}`)

      // --- assigning a bacenta MOVES ---------------------------------------
      const toAnloga = await admin(`/api/bacentas/${anlogaId}/members`, {
        method: 'POST',
        body: JSON.stringify({ member_ids: [memberId], mode: 'assign' }),
      })
      toAnloga.status === 200
        ? ok('a member is assigned into a bacenta')
        : bad(`bacenta assign gave ${toAnloga.status}: ${JSON.stringify(toAnloga.body)}`)

      const toSusu = await admin(`/api/bacentas/${susuId}/members`, {
        method: 'POST',
        body: JSON.stringify({ member_ids: [memberId], mode: 'assign' }),
      })
      toSusu.status === 200
        ? ok('and re-assigned into a second one')
        : bad(`second bacenta assign gave ${toSusu.status}`)

      // THE assertion this whole collection split exists for. The basonta
      // section above proves the OPPOSITE about the other route, and if these
      // two ever agree, one of them is wrong.
      const afterMove = await admin(`/api/members/${memberId}`)
      afterMove.body?.member?.bacenta_id === susuId
        ? ok('assigning a bacenta MOVED them — a member lives in exactly one place')
        : bad(
            `after moving, bacenta_id is ${afterMove.body?.member?.bacenta_id}, expected ${susuId}`,
          )

      const anlogaRoster = await admin(`/api/bacentas/${anlogaId}`)
      ;(anlogaRoster.body?.members ?? []).some((m) => m.$id === memberId)
        ? bad('the member is STILL in the first bacenta — the move did not remove them')
        : ok('and left the first bacenta, which a basonta assignment would not have done')

      // An unrecognised mode is REFUSED, never defaulted to `assign`. This
      // shipped as a bug once: a Remove button that would have ADDED everybody
      // it named to the group they were being taken out of.
      const badMode = await admin(`/api/bacentas/${susuId}/members`, {
        method: 'POST',
        body: JSON.stringify({ member_ids: [memberId], mode: 'remove' }),
      })
      badMode.status === 400
        ? ok('an unrecognised mode is refused, not silently treated as "assign"')
        : bad(`mode "remove" gave ${badMode.status} — it must be refused by name`)

      // --- care links -------------------------------------------------------
      //
      // A member looked after by another MEMBER, who needs no account. Every
      // refusal below is either a shape nobody can be at the top of, or a link
      // pointing outside the bacenta it is supposed to describe.
      console.log('\ncare links')
      const carer = await admin('/api/members', {
        method: 'POST',
        body: JSON.stringify({
          first_name: 'Carer',
          last_name: `E2E ${stamp}`,
          call_number: '0240000009',
          constituency_id: constituencyId,
          status: 'active',
        }),
      })
      if (carer.status !== 201) {
        bad(`could not create a carer (${carer.status}): ${JSON.stringify(carer.body)}`)
      } else {
        const carerId = carer.body.member.$id
        created.members.push(carerId)

        const self = await admin(`/api/members/${memberId}`, {
          method: 'PATCH',
          body: JSON.stringify({ care_of_member_id: memberId }),
        })
        self.status === 400
          ? ok('a member cannot be assigned to look after themselves')
          : bad(`self care assignment gave ${self.status}`)

        // The carer is in the constituency but NOT yet in the member's bacenta.
        const crossBacenta = await admin(`/api/members/${memberId}`, {
          method: 'PATCH',
          body: JSON.stringify({ care_of_member_id: carerId }),
        })
        crossBacenta.status === 400
          ? ok("a carer from outside the member's bacenta is refused")
          : bad(`cross-bacenta carer gave ${crossBacenta.status}`)

        // Put them in the same place, and the same assignment must now land.
        await admin(`/api/bacentas/${susuId}/members`, {
          method: 'POST',
          body: JSON.stringify({ member_ids: [carerId], mode: 'assign' }),
        })
        const sameBacenta = await admin(`/api/members/${memberId}`, {
          method: 'PATCH',
          body: JSON.stringify({ care_of_member_id: carerId }),
        })
        sameBacenta.status === 200
          ? ok('a carer in the SAME bacenta is accepted')
          : bad(`same-bacenta carer gave ${sameBacenta.status}: ${JSON.stringify(sameBacenta.body)}`)

        // The cycle. This is a HANGS-or-refuses check: without the `seen` set in
        // the walk the request never returns, which is a worse failure than a
        // wrong answer and exactly why that set is load-bearing.
        const cycle = await admin(`/api/members/${carerId}`, {
          method: 'PATCH',
          body: JSON.stringify({ care_of_member_id: memberId }),
        })
        cycle.status === 400
          ? ok('a care CYCLE is refused — nobody can be at the top of a loop')
          : bad(`cycle gave ${cycle.status} (a HANG here means the seen set is gone)`)

        // Moving somebody between bacentas releases the care link, because it
        // would otherwise point across a boundary it is not allowed to cross.
        await admin(`/api/bacentas/${anlogaId}/members`, {
          method: 'POST',
          body: JSON.stringify({ member_ids: [memberId], mode: 'assign' }),
        })
        const afterBacentaMove = await admin(`/api/members/${memberId}`)
        afterBacentaMove.body?.member?.care_of_member_id == null
          ? ok('moving bacenta CLEARS the care link rather than leaving it dangling')
          : bad(
              `care link survived a bacenta move: ${afterBacentaMove.body?.member?.care_of_member_id}`,
            )
      }
    }

    // --- member numbers ------------------------------------------------------
    //
    // `member_no` is the human reference the church writes on paper, claimed by
    // the INSERT. A number is never reissued, so a gap stays a gap.
    console.log('\nmember numbers')
    const numbered = await admin(`/api/members/${memberId}`)
    const memberNo = numbered.body?.member?.member_no
    const looksLikeAMemberNumber = /^\d{7,}$/.test(String(memberNo ?? ''))
    looksLikeAMemberNumber
      ? ok(`a registered member is given a member number (${memberNo})`)
      : bad(`member_no came back as ${JSON.stringify(memberNo)}`)

    if (memberNo) {
      const found = await admin(`/api/members/search?q=${encodeURIComponent(memberNo)}`)
      ;(found.body?.members ?? []).some((m) => m.$id === memberId)
        ? ok('and can be looked up BY that number, not only by name')
        : bad(`searching for ${memberNo} did not return the member`)
    }

    // --- BENMP ---------------------------------------------------------------
    //
    // Read as `=== true`, never cast. A non-boolean is REFUSED rather than
    // coerced: the string "false" is truthy, and coercing it enrols the very
    // person being taken off the list — at the church's expense, about a
    // commitment they never made.
    console.log('\nBENMP partner')
    const benmpOn = await admin(`/api/members/${memberId}`, {
      method: 'PATCH',
      body: JSON.stringify({ benmp_partner: true }),
    })
    benmpOn.status === 200 && benmpOn.body?.member?.benmp_partner === true
      ? ok('a member is recorded as a BENMP partner')
      : bad(`setting benmp_partner gave ${benmpOn.status}`)

    const benmpJunk = await admin(`/api/members/${memberId}`, {
      method: 'PATCH',
      body: JSON.stringify({ benmp_partner: 'false' }),
    })
    benmpJunk.status === 400
      ? ok('the STRING "false" is refused, not coerced — it is truthy, and coercing it enrols them')
      : bad(`benmp_partner:"false" gave ${benmpJunk.status} — it must be refused`)

    const stillOn = await admin(`/api/members/${memberId}`)
    stillOn.body?.member?.benmp_partner === true
      ? ok('and the refused write left the stored value alone')
      : bad('a refused benmp_partner write changed the stored value')

    // --- head scoping -------------------------------------------------------
    console.log('\nhead scoping (server-side)')
    if (leaderUser) {
      const listAttempt = await leader('/api/constituencies')
      listAttempt.status === 403
        ? ok('a leader cannot enumerate every constituency (403)')
        : bad(`leader listing constituencies gave ${listAttempt.status}`)

      const notMine = await leader(`/api/constituencies/${constituencyId}`)
      notMine.status === 403
        ? ok('a leader cannot read a group they do not head (403)')
        : bad(`leader reading an unheaded group gave ${notMine.status}`)

      const mineBefore = await leader('/api/my-groups')
      mineBefore.status === 200 &&
      (mineBefore.body?.constituencies ?? []).length === 0 &&
      (mineBefore.body?.basontas ?? []).length === 0
        ? ok('an unappointed leader gets empty lists, not an error')
        : bad(`my-groups before appointment: ${JSON.stringify(mineBefore.body)}`)

      // Appoint them to the constituency AND a basonta — the case the single
      // `leader` label exists for.
      await admin(`/api/constituencies/${constituencyId}`, {
        method: 'PATCH',
        body: JSON.stringify({ head_user_id: leaderUser.id }),
      })
      await admin(`/api/basontas/${tech.body.basonta.$id}`, {
        method: 'PATCH',
        body: JSON.stringify({ head_user_id: leaderUser.id }),
      })

      const mineAfter = await leader('/api/my-groups')
      const gotC = (mineAfter.body?.constituencies ?? []).length
      const gotB = (mineAfter.body?.basontas ?? []).length
      gotC === 1 && gotB === 1
        ? ok('one login sees BOTH the constituency and the basonta they head')
        : bad(`my-groups after appointment: ${gotC} constituencies, ${gotB} basontas`)

      const nowMine = await leader(`/api/constituencies/${constituencyId}`)
      nowMine.status === 200
        ? ok('the head can now read their own constituency')
        : bad(`head reading their own group gave ${nowMine.status}`)

      const otherBasonta = await leader(`/api/basontas/${biazo.body.basonta.$id}`)
      otherBasonta.status === 403
        ? ok('but still not a basonta they do not head (403)')
        : bad(`head reading an unheaded basonta gave ${otherBasonta.status}`)

      const writeAttempt = await leader('/api/basontas', {
        method: 'POST',
        body: JSON.stringify({ name: `Leader should not create ${stamp}` }),
      })
      writeAttempt.status === 403
        ? ok('a head cannot create groups (403) — read-only, as specified')
        : bad(`leader creating a basonta gave ${writeAttempt.status}`)

      // --- a head registering a member ------------------------------------
      //
      // The one creating write the read-only rule makes room for (PRD 5.2).
      // Every check below is a boundary that, if it moved, would be invisible
      // afterwards: the member simply turns up in the wrong roster, or
      // registered as somebody a scanner will never recognise.
      const base = { last_name: `Registered ${stamp}`, call_number: '0240000001' }

      const noHome = await leader('/api/members', {
        method: 'POST',
        body: JSON.stringify({ ...base, first_name: 'Nowhere' }),
      })
      noHome.status === 400
        ? ok('a head who omits the constituency is REFUSED, not defaulted into one')
        : bad(`leader registering with no constituency gave ${noHome.status}`)

      // A real constituency, headed by nobody — so the refusal is about who
      // heads it and not about the id being made up.
      const otherC = await admin('/api/constituencies', {
        method: 'POST',
        body: JSON.stringify({ name: `E2E Elsewhere ${stamp}` }),
      })
      if (otherC.status === 201) created.constituencies.push(otherC.body.constituency.$id)

      const notTheirs = await leader('/api/members', {
        method: 'POST',
        body: JSON.stringify({
          ...base,
          first_name: 'Neighbour',
          constituency_id: otherC.body?.constituency?.$id,
        }),
      })
      notTheirs.status === 403
        ? ok("a head cannot register into another constituency (403)")
        : bad(`leader registering into an unheaded constituency gave ${notTheirs.status}`)

      const foreignBasonta = await leader('/api/members', {
        method: 'POST',
        body: JSON.stringify({
          ...base,
          first_name: 'Wrongchoir',
          constituency_id: constituencyId,
          basonta_ids: [biazo.body.basonta.$id],
        }),
      })
      foreignBasonta.status === 403
        ? ok('a head cannot put a new member into a basonta they do not head (403)')
        : bad(`leader registering into an unheaded basonta gave ${foreignBasonta.status}`)

      // The positive case, and the three forced fields with it. `status` and
      // `sms_template_id` are sent deliberately wrong: the server must ignore
      // both rather than trust a form it did not draw.
      const registered = await leader('/api/members', {
        method: 'POST',
        body: JSON.stringify({
          ...base,
          first_name: 'Properly',
          other_names: 'Head Registered',
          birth_month: 3,
          birth_day: 14,
          address: '12 Test Street',
          whatsapp_number: '0240000002',
          home_service: 'first',
          constituency_id: constituencyId,
          basonta_ids: [tech.body.basonta.$id],
          status: 'inactive',
          sms_template_id: 'some-template-they-cannot-see',
        }),
      })
      if (registered.status !== 201) {
        bad(`head registering into their own constituency gave ${registered.status}: ${JSON.stringify(registered.body)}`)
      } else {
        const m = registered.body.member
        created.members.push(m.$id)
        ok('a head registers a member into the constituency they head (201)')

        m.constituency_id === constituencyId
          ? ok('the new member is filed into that constituency')
          : bad(`new member filed into ${m.constituency_id}`)
        m.status === 'active'
          ? ok('status is FORCED active — a head cannot register somebody invisible to the scanner')
          : bad(`head-registered member has status ${m.status}`)
        m.sms_template_id === null
          ? ok('the birthday template is FORCED null, not taken from the request')
          : bad(`head-registered member has sms_template_id ${m.sms_template_id}`)
        // Every other detail is the head's to give, and must survive intact.
        m.call_number === '+233240000001' && m.whatsapp_number === '+233240000002'
          ? ok('both numbers normalised to +233 exactly as an admin registration would')
          : bad(`numbers came back ${m.call_number} / ${m.whatsapp_number}`)
        m.birth_month === 3 && m.birth_day === 14 && m.home_service === 'first'
          ? ok('birthday and usual service saved from a head registration')
          : bad('birthday or usual service lost on a head registration')
        ;(registered.body.basonta_ids ?? []).includes(tech.body.basonta.$id)
          ? ok('and into the one basonta they DO head')
          : bad('the basonta they head was not applied')

        // --- a head editing their own member --------------------------------
        const readBack = await leader(`/api/members/${m.$id}`)
        readBack.status === 200 && readBack.body?.constituency_name
          ? ok('a head can open one of their members, constituency resolved by NAME')
          : bad(`head reading their own member gave ${readBack.status}`)

        const fixed = await leader(`/api/members/${m.$id}`, {
          method: 'PATCH',
          body: JSON.stringify({ call_number: '0249999999', address: '13 Test Street' }),
        })
        fixed.status === 200 && fixed.body?.member?.call_number === '+233249999999'
          ? ok('a head corrects a mistyped number on their own member (200)')
          : bad(`head editing their member gave ${fixed.status}: ${JSON.stringify(fixed.body)}`)

        // The three refusals, each of which must NAME the field rather than
        // drop it — a head told nothing assumes the edit landed.
        const flip = await leader(`/api/members/${m.$id}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: 'inactive' }),
        })
        flip.status === 403
          ? ok('a head cannot mark a member inactive (403) — that hides them from the scanner')
          : bad(`head setting status gave ${flip.status}`)

        const retemplate = await leader(`/api/members/${m.$id}`, {
          method: 'PATCH',
          body: JSON.stringify({ sms_template_id: 'anything' }),
        })
        retemplate.status === 403
          ? ok('a head cannot change which birthday message a member is sent (403)')
          : bad(`head setting sms_template_id gave ${retemplate.status}`)

        const move = await leader(`/api/members/${m.$id}`, {
          method: 'PATCH',
          body: JSON.stringify({ constituency_id: otherC.body?.constituency?.$id }),
        })
        move.status === 403
          ? ok('a head cannot MOVE a member to another constituency (403)')
          : bad(`head moving a member gave ${move.status}`)

        const resend = await leader(`/api/members/${m.$id}`, {
          method: 'PATCH',
          body: JSON.stringify({ constituency_id: constituencyId, address: '14 Test Street' }),
        })
        resend.status === 200
          ? ok('resending the constituency they already have is not a move')
          : bad(`head resending the same constituency gave ${resend.status}`)

        // The merge, and the reason it exists. An admin puts the member into a
        // basonta the head does NOT head; the head then saves a form that only
        // ever drew their own basontas. The one they cannot see must survive.
        await admin(`/api/basontas/${biazo.body.basonta.$id}/members`, {
          method: 'POST',
          body: JSON.stringify({ member_ids: [m.$id], mode: 'add' }),
        })
        const cleared = await leader(`/api/members/${m.$id}`, {
          method: 'PATCH',
          body: JSON.stringify({ basonta_ids: [] }),
        })
        const after = cleared.body?.basonta_ids ?? []
        cleared.status === 200 &&
        after.includes(biazo.body.basonta.$id) &&
        !after.includes(tech.body.basonta.$id)
          ? ok('a head unticking their own basonta does NOT remove the one they cannot see')
          : bad(`basonta merge went wrong (${cleared.status}): ${JSON.stringify(after)}`)

        // Enrolment is the line this feature does not cross.
        const enrolAttempt = await leader('/api/biometrics/enroll', {
          method: 'POST',
          body: JSON.stringify({ member_id: m.$id, finger_label: 'right-thumb', variation: 1 }),
        })
        enrolAttempt.status === 403
          ? ok('a head still cannot enrol fingerprints (403) — that stays with an admin')
          : bad(`leader enrolling gave ${enrolAttempt.status}`)

        const deleteAttempt = await leader(`/api/members/${m.$id}`, { method: 'DELETE' })
        deleteAttempt.status === 403
          ? ok('and cannot delete a member (403)')
          : bad(`leader deleting a member gave ${deleteAttempt.status}`)

        // Somebody outside every group they head, to prove the scope is a
        // scope and not "any member the head knows the id of".
        const stranger = await admin('/api/members', {
          method: 'POST',
          body: JSON.stringify({
            first_name: 'Stranger',
            last_name: `Elsewhere ${stamp}`,
            call_number: '0240000009',
            constituency_id: otherC.body?.constituency?.$id,
            basonta_ids: [],
          }),
        })
        if (stranger.status === 201) {
          created.members.push(stranger.body.member.$id)
          const peek = await leader(`/api/members/${stranger.body.member.$id}`)
          peek.status === 403
            ? ok('a head cannot open a member outside every group they head (403)')
            : bad(`head reading a stranger gave ${peek.status}`)
          const poke = await leader(`/api/members/${stranger.body.member.$id}`, {
            method: 'PATCH',
            body: JSON.stringify({ address: 'Nope' }),
          })
          poke.status === 403
            ? ok('and cannot edit them either (403)')
            : bad(`head editing a stranger gave ${poke.status}`)
        } else {
          bad(`could not create the out-of-scope member (${stranger.status})`)
        }
      }
    } else {
      bad('leader account unavailable — scoping checks skipped')
    }

    // --- birthdays ----------------------------------------------------------
    console.log('\nbirthdays')
    const birthdays = await admin('/api/birthdays')
    if (birthdays.status !== 200) {
      bad(`/api/birthdays gave ${birthdays.status}`)
    } else {
      birthdays.body.lead_days === 1
        ? ok('the lead time is one day — the church is told the day BEFORE')
        : bad(`lead_days is ${birthdays.body.lead_days}`)
      Array.isArray(birthdays.body.to_prepare)
        ? ok(`${birthdays.body.to_prepare.length} celebrant(s) to prepare for tomorrow`)
        : bad('to_prepare is not a list')
      // Every entry in `to_prepare` must be exactly one day away, or the page
      // is telling the team to prepare something that is not due.
      const allTomorrow = (birthdays.body.to_prepare ?? []).every((c) => c.days_away === 1)
      allTomorrow
        ? ok('every "to prepare" celebrant is exactly one day away')
        : bad('to_prepare contains someone who is not celebrating tomorrow')
      const sorted = (birthdays.body.upcoming ?? []).every(
        (c, i, arr) => i === 0 || arr[i - 1].days_away <= c.days_away,
      )
      sorted ? ok('upcoming birthdays are soonest first') : bad('upcoming list is out of order')
    }

    if (celebUser) {
      const celebRead = await celebrations('/api/birthdays')
      celebRead.status === 200
        ? ok('the birthday team can read the celebrant list')
        : bad(`celebrations reading birthdays gave ${celebRead.status}`)

      const celebMembers = await celebrations('/api/members')
      celebMembers.status === 403
        ? ok('but cannot browse the member registry (403)')
        : bad(`celebrations reading members gave ${celebMembers.status}`)
    }

    const anonBirthdays = await anon('/api/birthdays')
    anonBirthdays.status === 401
      ? ok('anonymous callers get 401, not a redirect to HTML')
      : bad(`anonymous /api/birthdays gave ${anonBirthdays.status}`)

    // --- push ---------------------------------------------------------------
    console.log('\npush')
    const push = await admin('/api/push')
    push.status === 200
      ? ok(
          push.body.vapid_public_key
            ? 'VAPID key served — a device can subscribe'
            : 'push reports itself unconfigured (no VAPID keys set)',
        )
      : bad(`/api/push gave ${push.status}`)

    const incomplete = await admin('/api/push/subscribe', {
      method: 'POST',
      body: JSON.stringify({ endpoint: 'https://example.com/x' }),
    })
    incomplete.status === 400
      ? ok('a subscription missing its keys is refused')
      : bad(`incomplete subscription gave ${incomplete.status}`)

    const notHttps = await admin('/api/push/subscribe', {
      method: 'POST',
      body: JSON.stringify({
        endpoint: 'http://example.com/x',
        keys: { p256dh: 'a', auth: 'b' },
      }),
    })
    notHttps.status === 400
      ? ok('a non-HTTPS push endpoint is refused')
      : bad(`http endpoint gave ${notHttps.status}`)

    // The route is exempt from the proxy's session gate (a cron has no cookie),
    // so these two must prove the ROUTE refuses them — not the proxy. Asserting
    // on the message is what distinguishes the two layers: a proxy 401 says
    // "Authentication required", the route says something specific.
    const unauthRun = await anon('/api/notifications/birthday-run', { method: 'POST' })
    unauthRun.status === 401 && unauthRun.body?.error === 'Unauthorized'
      ? ok('the birthday run refuses an anonymous caller at the route, not the proxy')
      : bad(`anonymous run gave ${unauthRun.status}: ${JSON.stringify(unauthRun.body)}`)

    const wrongToken = await anon('/api/notifications/birthday-run', {
      method: 'POST',
      headers: { authorization: 'Bearer not-the-secret' },
    })
    wrongToken.status === 401 && /scheduler token/i.test(wrongToken.body?.error ?? '')
      ? ok('and refuses a wrong scheduler token by name')
      : bad(`wrong token gave ${wrongToken.status}: ${JSON.stringify(wrongToken.body)}`)

    if (process.env.E2E_ALLOW_NOTIFY === '1' && env.NOTIFICATIONS_CRON_SECRET) {
      const run1 = await anon('/api/notifications/birthday-run', {
        method: 'POST',
        headers: { authorization: `Bearer ${env.NOTIFICATIONS_CRON_SECRET}` },
      })
      run1.status === 200
        ? ok(`scheduler run accepted: ${run1.body.status}`)
        : bad(`scheduler run gave ${run1.status}: ${JSON.stringify(run1.body)}`)

      const run2 = await anon('/api/notifications/birthday-run', {
        method: 'POST',
        headers: { authorization: `Bearer ${env.NOTIFICATIONS_CRON_SECRET}` },
      })
      // `no_subscribers` releases its claim on purpose, so a second run is
      // allowed to try again — that is correct, not a broken guard.
      const idempotent =
        run2.body?.status === 'already_sent' || run1.body?.status === 'no_subscribers'
      idempotent
        ? ok(`a second run is idempotent (${run2.body?.status})`)
        : bad(`second run reported ${run2.body?.status}`)
    } else {
      console.log(
        '  · birthday-run send skipped (set E2E_ALLOW_NOTIFY=1 to claim today’s run)',
      )
    }
  } finally {
    // --- the treasurer -------------------------------------------------------
    //
    // NOTHING HERE SENDS AN SMS. Every positive path stops at the refusal or at
    // a read; a suite that spends the church's SMS credit on every run is a
    // suite nobody runs, and the one send worth proving costs real money and
    // reaches a real handset.
    //
    // The rule is an ALLOW-map, so the interesting assertion is not "tithe is
    // allowed" but that everything else is refused BY NAME. Silently
    // downgrading a birthday send to a tithe one would return 200 and leave the
    // treasurer believing a hundred birthday messages went out.
    console.log('\ntreasurer')
    if (!treasurerUser) {
      bad('no treasurer account — set SEED_TREASURER_* to cover this')
    } else {
      const balance = await treasurer('/api/sms/balance')
      balance.status === 200
        ? ok('a treasurer reads the SMS balance — a sender who cannot see it finds out from the congregation')
        : bad(`treasurer reading the balance gave ${balance.status}`)

      const log = await treasurer('/api/sms/log')
      log.status === 200
        ? ok('and the send log')
        : bad(`treasurer reading the log gave ${log.status}`)

      // The refusal, with no template id and no member ids: the category gate
      // runs BEFORE anything is looked up, so this cannot send even if it
      // somehow passed.
      const birthdaySend = await treasurer('/api/sms/send', {
        method: 'POST',
        body: JSON.stringify({ category: 'birthday', template_id: 'x', member_ids: [] }),
      })
      const namesTheCategory = /birthday/i.test(birthdaySend.body?.error ?? '')
      birthdaySend.status === 403 && namesTheCategory
        ? ok('a treasurer sending BIRTHDAY is refused 403, and the refusal NAMES the category')
        : bad(
            `treasurer birthday send gave ${birthdaySend.status}: ${JSON.stringify(birthdaySend.body?.error)}`,
          )

      const generalSend = await treasurer('/api/sms/send', {
        method: 'POST',
        body: JSON.stringify({ category: 'general', template_id: 'x', member_ids: [] }),
      })
      generalSend.status === 403
        ? ok('and GENERAL too — an open cheque against the credit is an administrator’s')
        : bad(`treasurer general send gave ${generalSend.status}`)

      // Authority over a category means authoring its templates as well, read
      // from the same map. A treasurer who may send but not write has to ask an
      // administrator to type it for them.
      const birthdayTemplate = await treasurer('/api/sms/templates', {
        method: 'POST',
        body: JSON.stringify({
          name: `E2E Nope ${stamp}`,
          category: 'birthday',
          body: 'should never be created',
        }),
      })
      birthdayTemplate.status === 403
        ? ok('a treasurer cannot write a BIRTHDAY template either — same map, same refusal')
        : bad(`treasurer writing a birthday template gave ${birthdayTemplate.status}`)

      // Congregation data is readable — that is the half they share with a
      // shepherd — but writing it is not.
      const readsMembers = await treasurer('/api/members')
      readsMembers.status === 200
        ? ok('a treasurer reads the registry, like a shepherd does')
        : bad(`treasurer reading members gave ${readsMembers.status}`)

      const writesMember = await treasurer(`/api/members/${memberId}`, {
        method: 'PATCH',
        body: JSON.stringify({ address: 'treasurer should not be able to write this' }),
      })
      writesMember.status === 403
        ? ok('but cannot correct one (403) — SMS is the one thing they write')
        : bad(`treasurer editing a member gave ${writesMember.status}`)
    }

    // --- the shepherd --------------------------------------------------------
    //
    // Wider read than a leader, zero write. Enforced by ABSENCE: `shepherd`
    // appears on GET handlers only, so a mutating route refuses it without
    // naming it and a new POST is shepherd-proof the moment it is written.
    //
    // Which means the assertions worth making are the WRITES. A read that works
    // proves the label is wired up; a write that is refused proves the default
    // is refusal.
    console.log('\nshepherd')
    if (!shepherdUser) {
      bad('no shepherd account — set SEED_SHEPHERD_* to cover this')
    } else {
      const wholeChurch = await shepherd('/api/members')
      wholeChurch.status === 200
        ? ok('a shepherd reads the WHOLE registry, not a scoped slice of it')
        : bad(`shepherd reading members gave ${wholeChurch.status}`)

      // The difference from a leader, in one call: a leader gets 403 here.
      const everyConstituency = await shepherd('/api/constituencies')
      everyConstituency.status === 200
        ? ok('and enumerates every constituency, which a leader is refused')
        : bad(`shepherd listing constituencies gave ${everyConstituency.status}`)

      const everyBasonta = await shepherd('/api/basontas')
      everyBasonta.status === 200
        ? ok('and every basonta')
        : bad(`shepherd listing basontas gave ${everyBasonta.status}`)

      const everyBacenta = await shepherd('/api/bacentas')
      everyBacenta.status === 200
        ? ok('and every bacenta')
        : bad(`shepherd listing bacentas gave ${everyBacenta.status}`)

      const editMember = await shepherd(`/api/members/${memberId}`, {
        method: 'PATCH',
        body: JSON.stringify({ address: 'shepherd should not be able to write this' }),
      })
      editMember.status === 403
        ? ok('but writes NOTHING — correcting a member is refused (403)')
        : bad(`shepherd editing a member gave ${editMember.status}`)

      const makeGroup = await shepherd('/api/constituencies', {
        method: 'POST',
        body: JSON.stringify({ name: `Shepherd should not create ${stamp}` }),
      })
      makeGroup.status === 403
        ? ok('nor creates a group')
        : bad(`shepherd creating a constituency gave ${makeGroup.status}`)

      // The three reads deliberately withheld, because they are not
      // congregation data.
      const templates = await shepherd('/api/biometrics/templates')
      templates.status === 403
        ? ok('raw fingerprint templates are withheld — not congregation data')
        : bad(`shepherd reading templates gave ${templates.status}`)

      const smsLog = await shepherd('/api/sms/log')
      smsLog.status === 403
        ? ok('and the SMS log, which is what the church spends')
        : bad(`shepherd reading the SMS log gave ${smsLog.status}`)
    }

    // --- cleanup ------------------------------------------------------------
    // In `finally` so a failed assertion above does not leave throwaway groups
    // in a live project. Members first: deleting one cascades to its basonta
    // rows, so the groups are empty by the time they go.
    console.log('\ncleanup')
    for (const id of created.members) {
      const res = await admin(`/api/members/${id}`, { method: 'DELETE' })
      res.status === 200 ? ok(`member ${id} removed`) : bad(`member ${id} left behind`)
    }
    for (const id of created.basontas) {
      const res = await admin(`/api/basontas/${id}`, { method: 'DELETE' })
      res.status === 200 ? ok(`basonta ${id} removed`) : bad(`basonta ${id} left behind`)
    }
    for (const id of created.categories) {
      const res = await admin(`/api/basonta-categories/${id}`, { method: 'DELETE' })
      res.status === 200 ? ok(`category ${id} removed`) : bad(`category ${id} left behind`)
    }
    // Bacentas before constituencies: a bacenta is filed INTO a constituency,
    // and `verify:appwrite` checks that every one of them is. A bacenta left
    // behind after its constituency went is exactly the unfiled row that check
    // exists to catch.
    for (const id of created.bacentas) {
      const res = await admin(`/api/bacentas/${id}`, { method: 'DELETE' })
      res.status === 200 ? ok(`bacenta ${id} removed`) : bad(`bacenta ${id} left behind`)
    }
    for (const id of created.constituencies) {
      const res = await admin(`/api/constituencies/${id}`, { method: 'DELETE' })
      res.status === 200 ? ok(`constituency ${id} removed`) : bad(`constituency ${id} left behind`)
    }
  }

  console.log(
    failures === 0 ? '\n─── all checks passed ───' : `\n─── ${failures} check(s) FAILED ───`,
  )
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
