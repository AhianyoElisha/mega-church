/**
 * End-to-end smoke against the LIVE Appwrite project, driven through a running
 * server's HTTP API.
 *
 *   npm run dev -- -p 3111     # in one terminal
 *   npm run e2e                # in another
 *
 * Exercises what unit tests cannot: real writes, the unique indexes doing their
 * job, the single-active-session invariant, and the three roles being enforced
 * server-side rather than by the UI hiding controls.
 *
 * WRITES REAL DATA and removes it again at the end (deleting a member cascades
 * to their templates, roster rows and attendance). It only ever touches what it
 * created, so it is safe on a project that already has members — but it does
 * open and close a real session on First Service, so DO NOT run it during a
 * service.
 *
 * Credentials come from the SEED_* pairs in .env.local.
 * Point it elsewhere with BASE_URL=http://localhost:3000.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BASE = process.env.BASE_URL ?? 'http://localhost:3111'

const env = Object.fromEntries(
  fs
    .readFileSync(path.join(ROOT, '.env.local'), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trimStart().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
)

let cookie = ''
let failures = 0
const ok = (m) => console.log(`  ✓ ${m}`)
const bad = (m) => {
  console.log(`  ✗ ${m}`)
  failures++
}

async function api(pathname, init = {}) {
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

async function main() {
  console.log(`E2E against ${BASE} → ${env.APPWRITE_ENDPOINT}\n`)

  // --- auth ---------------------------------------------------------------
  console.log('auth')
  const bad1 = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: env.SEED_ADMIN_EMAIL, password: 'wrong-password' }),
  })
  bad1.status === 401 ? ok('wrong password rejected (401)') : bad(`wrong password gave ${bad1.status}`)

  const login = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: env.SEED_ADMIN_EMAIL, password: env.SEED_ADMIN_PASSWORD }),
  })
  if (login.status !== 200 || !login.body?.ok) {
    bad(`admin login failed (${login.status}): ${JSON.stringify(login.body)}`)
    process.exit(1)
  }
  ok(`admin signed in, label=${login.body.user.label}`)

  const me = await api('/api/auth/me')
  me.body?.user?.label === 'admin' ? ok('/api/auth/me returns the admin') : bad('/api/auth/me wrong')

  // --- member registration ------------------------------------------------
  console.log('\nmembers')
  const stamp = Date.now()
  const create = await api('/api/members', {
    method: 'POST',
    body: JSON.stringify({
      first_name: 'Ama',
      last_name: `Testmember${stamp}`,
      other_names: 'Serwaa',
      call_number: '024 123 4567',
      whatsapp_number: '0201112222',
      birth_month: 2,
      birth_day: 29,
      address: 'Ayeduase',
      home_service: 'first',
    }),
  })
  if (create.status !== 201) {
    bad(`create member failed (${create.status}): ${JSON.stringify(create.body)}`)
    process.exit(1)
  }
  const memberId = create.body.member.$id
  ok(`member created: ${create.body.member.first_name} ${create.body.member.last_name}`)
  create.body.member.call_number === '+233241234567'
    ? ok('call number normalised 024… → +233…')
    : bad(`call number is ${create.body.member.call_number}`)
  create.body.member.whatsapp_number === '+233201112222'
    ? ok('whatsapp kept independently of call number')
    : bad(`whatsapp is ${create.body.member.whatsapp_number}`)
  create.body.member.birth_day === 29 && create.body.member.birth_month === 2
    ? ok('29 February accepted (no year is collected)')
    : bad('leap-day birthday rejected')

  const badPhone = await api('/api/members', {
    method: 'POST',
    body: JSON.stringify({ first_name: 'X', last_name: 'Y', call_number: 'not-a-number' }),
  })
  badPhone.status === 400 ? ok('bad phone rejected server-side') : bad('bad phone accepted')

  const noCall = await api('/api/members', {
    method: 'POST',
    body: JSON.stringify({ first_name: 'X', last_name: 'Y' }),
  })
  noCall.status === 400 ? ok('missing call number rejected') : bad('missing call number accepted')

  const list = await api('/api/members')
  list.body?.ok && list.body.members.some((m) => m.$id === memberId)
    ? ok(`registry lists ${list.body.total} member(s), enrolment joined`)
    : bad('registry did not include the new member')

  // --- meetings + roster ---------------------------------------------------
  console.log('\nmeetings')
  const meeting = await api('/api/meetings', {
    method: 'POST',
    body: JSON.stringify({
      name: `E2E Committee ${stamp}`,
      description: 'Created by the end-to-end check.',
      member_ids: [memberId],
    }),
  })
  if (meeting.status !== 201) {
    bad(`create meeting failed (${meeting.status}): ${JSON.stringify(meeting.body)}`)
    process.exit(1)
  }
  const meetingId = meeting.body.meeting.$id
  ok(`meeting created, restricted=${meeting.body.meeting.restricted}`)

  const detail = await api(`/api/meetings/${meetingId}`)
  detail.body?.member_ids?.includes(memberId)
    ? ok('roster persisted and reads back ticked')
    : bad('roster did not persist')

  const rosterOnService = await api('/api/meetings/first-service', {
    method: 'PATCH',
    body: JSON.stringify({ member_ids: [memberId] }),
  })
  rosterOnService.status === 400
    ? ok('refuses to put a roster on a service (they are open to all)')
    : bad(`service accepted a roster (${rosterOnService.status})`)

  // --- the single-active-session invariant ---------------------------------
  console.log('\nsession lifecycle')
  const act1 = await api('/api/occurrences/activate', {
    method: 'POST',
    body: JSON.stringify({ meeting_id: 'first-service' }),
  })
  if (act1.status !== 201) {
    bad(`activate First Service failed (${act1.status}): ${JSON.stringify(act1.body)}`)
    process.exit(1)
  }
  const occId = act1.body.session.occurrence.$id
  ok('First Service activated')

  const act2 = await api('/api/occurrences/activate', {
    method: 'POST',
    body: JSON.stringify({ meeting_id: 'second-service' }),
  })
  act2.status === 409
    ? ok(`Second Service blocked: "${act2.body.error}"`)
    : bad(`Second Service was NOT blocked (${act2.status})`)

  const act3 = await api('/api/occurrences/activate', {
    method: 'POST',
    body: JSON.stringify({ meeting_id: meetingId }),
  })
  act3.status === 409
    ? ok('a meeting is blocked too — the rule is global, not services-only')
    : bad(`meeting was NOT blocked (${act3.status})`)

  // --- attendance ----------------------------------------------------------
  console.log('\nattendance (First Service — open to all)')
  const mark1 = await api('/api/attendance/manual', {
    method: 'POST',
    body: JSON.stringify({ member_id: memberId }),
  })
  mark1.body?.result?.kind === 'marked'
    ? ok(`marked present, sequence ${mark1.body.result.sequence}`)
    : bad(`expected marked, got ${JSON.stringify(mark1.body?.result ?? mark1.body)}`)

  const mark2 = await api('/api/attendance/manual', {
    method: 'POST',
    body: JSON.stringify({ member_id: memberId }),
  })
  mark2.body?.result?.kind === 'already_marked'
    ? ok('second attempt returns already_marked, writes nothing')
    : bad(`expected already_marked, got ${mark2.body?.result?.kind}`)

  const live = await api('/api/attendance/live')
  live.body?.ok && live.body.stats.present === 1
    ? ok(`live stats: present=${live.body.stats.present} expected=${live.body.stats.expected}`)
    : bad(`live stats wrong: ${JSON.stringify(live.body?.stats)}`)

  const records = await api('/api/attendance/records')
  records.body?.ok && records.body.records.length === 1
    ? ok(`record log joins the member: ${records.body.records[0].member.full_name}`)
    : bad('record log wrong')

  // --- close, then the restricted meeting ---------------------------------
  console.log('\nrestricted meeting')
  const close = await api(`/api/occurrences/${occId}/close`, { method: 'POST' })
  close.body?.ok
    ? ok(`First Service closed, tally frozen at ${close.body.present_count}`)
    : bad(`close failed: ${JSON.stringify(close.body)}`)

  const act4 = await api('/api/occurrences/activate', {
    method: 'POST',
    body: JSON.stringify({ meeting_id: meetingId }),
  })
  act4.status === 201
    ? ok('meeting activates once the service is ended')
    : bad(`meeting still blocked (${act4.status})`)
  const occId2 = act4.body?.session?.occurrence?.$id

  // The authorised member.
  const authed = await api('/api/attendance/manual', {
    method: 'POST',
    body: JSON.stringify({ member_id: memberId }),
  })
  authed.body?.result?.kind === 'marked'
    ? ok('authorised member marked present')
    : bad(`expected marked, got ${authed.body?.result?.kind}`)

  // Somebody NOT on the roster.
  const outsider = await api('/api/members', {
    method: 'POST',
    body: JSON.stringify({
      first_name: 'Kwaku',
      last_name: `Outsider${stamp}`,
      call_number: '0209998888',
    }),
  })
  const outsiderId = outsider.body?.member?.$id
  const refused = await api('/api/attendance/manual', {
    method: 'POST',
    body: JSON.stringify({ member_id: outsiderId }),
  })
  if (refused.body?.result?.kind === 'not_authorised') {
    ok(`unauthorised member IDENTIFIED by name: "${refused.body.result.member.full_name}"`)
    ok(`  and told which meeting: "${refused.body.result.meeting_name}"`)
  } else {
    bad(`expected not_authorised, got ${refused.body?.result?.kind}`)
  }

  // Inactive member.
  await api(`/api/members/${outsiderId}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'inactive' }),
  })
  await api(`/api/meetings/${meetingId}`, {
    method: 'PATCH',
    body: JSON.stringify({ member_ids: [memberId, outsiderId] }),
  })
  const inactive = await api('/api/attendance/manual', {
    method: 'POST',
    body: JSON.stringify({ member_id: outsiderId }),
  })
  inactive.body?.result?.kind === 'inactive_member'
    ? ok('inactive member refused even though on the roster')
    : bad(`expected inactive_member, got ${inactive.body?.result?.kind}`)

  // --- role enforcement ----------------------------------------------------
  console.log('\nrole enforcement')
  const savedCookie = cookie
  cookie = ''
  const anon = await api('/api/members')
  anon.status === 401 ? ok('unauthenticated read rejected (401)') : bad(`anon got ${anon.status}`)
  const anonScan = await api('/api/attendance/scan', {
    method: 'POST',
    body: JSON.stringify({ fingerprint_data: 'sim:x' }),
  })
  anonScan.status === 401 ? ok('unauthenticated scan rejected (401)') : bad(`anon scan ${anonScan.status}`)

  const usher = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: env.SEED_USHER_EMAIL, password: env.SEED_USHER_PASSWORD }),
  })
  if (usher.body?.ok) {
    ok(`usher signed in, label=${usher.body.user.label}`)
    const usherWrite = await api('/api/members', {
      method: 'POST',
      body: JSON.stringify({ first_name: 'No', last_name: 'Way', call_number: '0240000000' }),
    })
    usherWrite.status === 403
      ? ok('usher cannot create members (403)')
      : bad(`usher create gave ${usherWrite.status}`)
    const usherActivate = await api('/api/occurrences/activate', {
      method: 'POST',
      body: JSON.stringify({ meeting_id: 'second-service' }),
    })
    usherActivate.status === 403
      ? ok('usher cannot activate a session (403)')
      : bad(`usher activate gave ${usherActivate.status}`)
    const usherRead = await api('/api/members')
    usherRead.status === 200 ? ok('usher can read the registry') : bad('usher cannot read members')
  } else {
    bad('usher login failed')
  }

  const kiosk = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: env.SEED_KIOSK_EMAIL, password: env.SEED_KIOSK_PASSWORD }),
  })
  if (kiosk.body?.ok) {
    ok(`kiosk signed in, station="${kiosk.body.user.station}"`)
    const kioskScan = await api('/api/attendance/scan', {
      method: 'POST',
      body: JSON.stringify({ fingerprint_data: `sim:${memberId}` }),
    })
    // Already marked in this occurrence, so the expected answer is
    // already_marked — which also proves the sim payload resolved a real member
    // and the scan route accepted a kiosk.
    kioskScan.body?.result?.kind === 'already_marked'
      ? ok('kiosk scan path works (sim payload → already_marked)')
      : bad(`kiosk scan gave ${JSON.stringify(kioskScan.body?.result ?? kioskScan.body)}`)
    const kioskMembers = await api('/api/members')
    kioskMembers.status === 403
      ? ok('kiosk cannot read the registry (403)')
      : bad(`kiosk registry read gave ${kioskMembers.status}`)
  } else {
    bad('kiosk login failed')
  }

  // --- cleanup -------------------------------------------------------------
  cookie = savedCookie
  console.log('\ncleanup')
  const c1 = await api(`/api/occurrences/${occId2}/close`, { method: 'POST' })
  c1.body?.ok ? ok('meeting occurrence closed') : bad('close failed')
  for (const id of [memberId, outsiderId]) {
    const r = await api(`/api/members/${id}`, { method: 'DELETE' })
    r.body?.ok ? ok(`member ${id} deleted (cascade: ${JSON.stringify(r.body.removed)})`) : bad(`delete ${id} failed`)
  }
  const dm = await api(`/api/meetings/${meetingId}`, { method: 'DELETE' })
  dm.body?.ok ? ok('test meeting deleted') : bad('meeting delete failed')

  console.log(failures === 0 ? '\n─── all E2E checks passed ───' : `\n─── ${failures} FAILED ───`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
