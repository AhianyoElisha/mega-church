/**
 * End-to-end smoke for constituencies, bacentas, head scoping, birthdays and
 * push — driven through a running server against the LIVE Appwrite project.
 *
 *   npm run dev -- -p 3111     # in one terminal
 *   npm run e2e:groups         # in another
 *
 * Unlike `e2e-smoke.mjs` this NEVER opens an attendance session and never
 * touches the two services, so it is safe to run during a service. It creates
 * its own throwaway constituency, category, bacentas and member, and deletes
 * all of them at the end — it only ever touches what it made.
 *
 * The one shared thing it writes is a `notification_runs` row for today, and
 * only if `E2E_ALLOW_NOTIFY=1`. Without that flag the birthday-run checks are
 * skipped, because claiming today's run would stop the real morning
 * notification from going out.
 *
 * Credentials come from the SEED_* pairs in .env.local.
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

  const stamp = Date.now()
  const created = { constituencies: [], bacentas: [], categories: [], members: [] }

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

    // --- bacentas: both shapes ---------------------------------------------
    console.log('\nbacentas')
    const cat = await admin('/api/bacenta-categories', {
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

    const biazo = await admin('/api/bacentas', {
      method: 'POST',
      body: JSON.stringify({ name: 'Biazo', category_id: categoryId }),
    })
    const living = await admin('/api/bacentas', {
      method: 'POST',
      body: JSON.stringify({ name: 'Living Waters', category_id: categoryId }),
    })
    const tech = await admin('/api/bacentas', {
      method: 'POST',
      body: JSON.stringify({ name: `E2E Technical Team ${stamp}` }),
    })
    for (const [label, res] of [
      ['Biazo', biazo],
      ['Living Waters', living],
      ['Technical Team', tech],
    ]) {
      if (res.status === 201) created.bacentas.push(res.body.bacenta.$id)
      else bad(`create ${label} failed (${res.status}): ${JSON.stringify(res.body)}`)
    }
    biazo.body?.bacenta?.category_id === categoryId
      ? ok('Biazo is filed under the category')
      : bad('Biazo lost its category')
    tech.body?.bacenta?.category_id === null
      ? ok('a bacenta created with no category is standalone (category_id null)')
      : bad(`standalone bacenta has category_id ${JSON.stringify(tech.body?.bacenta?.category_id)}`)

    // Same name, different category, is two different real groups.
    const sameNameOtherCategory = await admin('/api/bacentas', {
      method: 'POST',
      body: JSON.stringify({ name: 'Biazo' }),
    })
    if (sameNameOtherCategory.status === 201) {
      created.bacentas.push(sameNameOtherCategory.body.bacenta.$id)
      ok('"Biazo" standalone is allowed alongside "Biazo" under Choir')
    } else {
      bad(`same name in another category refused (${sameNameOtherCategory.status})`)
    }

    const dupeInCategory = await admin('/api/bacentas', {
      method: 'POST',
      body: JSON.stringify({ name: '  biazo ', category_id: categoryId }),
    })
    dupeInCategory.status === 400
      ? ok('a duplicate name WITHIN a category is refused')
      : bad(`duplicate in category gave ${dupeInCategory.status}`)

    // A category holding bacentas must not be deletable — deleting it would
    // orphan real groups full of real people.
    const delHeld = await admin(`/api/bacenta-categories/${categoryId}`, { method: 'DELETE' })
    delHeld.status === 409
      ? ok('a category with bacentas in it refuses to be deleted (409)')
      : bad(`deleting a held category gave ${delHeld.status}`)

    // --- a member in a constituency and TWO bacentas -------------------------
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
        bacenta_ids: [biazo.body.bacenta.$id, tech.body.bacenta.$id],
      }),
    })
    if (member.status !== 201) {
      bad(`create member failed (${member.status}): ${JSON.stringify(member.body)}`)
      process.exit(1)
    }
    const memberId = member.body.member.$id
    created.members.push(memberId)
    ok('member registered with a constituency and two bacentas at once')

    const read = await admin(`/api/members/${memberId}`)
    read.body?.member?.constituency_id === constituencyId
      ? ok('constituency read back on the member')
      : bad(`constituency is ${read.body?.member?.constituency_id}`)
    const readBacentas = (read.body?.bacenta_ids ?? []).slice().sort()
    readBacentas.length === 2
      ? ok('both bacentas read back — one member, several work groups')
      : bad(`bacenta_ids came back as ${JSON.stringify(readBacentas)}`)

    // A PATCH that never mentions bacentas must leave them alone. This is the
    // bug that would otherwise remove somebody from their choir every time an
    // admin corrected a phone number.
    const patch = await admin(`/api/members/${memberId}`, {
      method: 'PATCH',
      body: JSON.stringify({ call_number: '0244000222' }),
    })
    patch.status === 200 && (patch.body?.bacenta_ids ?? []).length === 2
      ? ok('editing an unrelated field leaves bacenta membership untouched')
      : bad(`unrelated PATCH left bacenta_ids = ${JSON.stringify(patch.body?.bacenta_ids)}`)

    // An explicit empty array DOES clear them.
    const clear = await admin(`/api/members/${memberId}`, {
      method: 'PATCH',
      body: JSON.stringify({ bacenta_ids: [] }),
    })
    const cleared = clear.body?.bacenta_ids ?? ['not-returned']
    cleared.length === 0
      ? ok('an explicit empty list clears bacenta membership')
      : bad(`clearing left ${JSON.stringify(cleared)}`)

    // Put one back for the bulk-assign checks below.
    await admin(`/api/members/${memberId}`, {
      method: 'PATCH',
      body: JSON.stringify({ bacenta_ids: [biazo.body.bacenta.$id] }),
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
    const assignBacenta = await admin(`/api/bacentas/${living.body.bacenta.$id}/members`, {
      method: 'POST',
      body: JSON.stringify({ member_ids: [memberId], mode: 'add' }),
    })
    assignBacenta.status === 200 && assignBacenta.body.added === 1
      ? ok('bulk-added a member to a second bacenta')
      : bad(`bacenta assign gave ${assignBacenta.status}: ${JSON.stringify(assignBacenta.body)}`)

    const afterAssign = await admin(`/api/members/${memberId}`)
    const afterIds = afterAssign.body?.bacenta_ids ?? []
    afterIds.length === 2
      ? ok('adding to one bacenta did not remove them from the other')
      : bad(`member now in ${JSON.stringify(afterIds)}`)

    // Adding the same person twice must not create a second row.
    const again = await admin(`/api/bacentas/${living.body.bacenta.$id}/members`, {
      method: 'POST',
      body: JSON.stringify({ member_ids: [memberId], mode: 'add' }),
    })
    again.body?.added === 0
      ? ok('re-adding an existing member is a no-op, not a duplicate row')
      : bad(`re-add reported added=${again.body?.added}`)

    const detail = await admin(`/api/bacentas/${living.body.bacenta.$id}`)
    detail.body?.members?.some((m) => m.$id === memberId)
      ? ok('the bacenta roster lists the member, with attendance columns')
      : bad('member missing from the bacenta roster')

    const cDetail = await admin(`/api/constituencies/${constituencyId}`)
    cDetail.body?.members?.some((m) => m.$id === memberId)
      ? ok('the constituency roster lists the member')
      : bad('member missing from the constituency roster')

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
      (mineBefore.body?.bacentas ?? []).length === 0
        ? ok('an unappointed leader gets empty lists, not an error')
        : bad(`my-groups before appointment: ${JSON.stringify(mineBefore.body)}`)

      // Appoint them to the constituency AND a bacenta — the case the single
      // `leader` label exists for.
      await admin(`/api/constituencies/${constituencyId}`, {
        method: 'PATCH',
        body: JSON.stringify({ head_user_id: leaderUser.id }),
      })
      await admin(`/api/bacentas/${tech.body.bacenta.$id}`, {
        method: 'PATCH',
        body: JSON.stringify({ head_user_id: leaderUser.id }),
      })

      const mineAfter = await leader('/api/my-groups')
      const gotC = (mineAfter.body?.constituencies ?? []).length
      const gotB = (mineAfter.body?.bacentas ?? []).length
      gotC === 1 && gotB === 1
        ? ok('one login sees BOTH the constituency and the bacenta they head')
        : bad(`my-groups after appointment: ${gotC} constituencies, ${gotB} bacentas`)

      const nowMine = await leader(`/api/constituencies/${constituencyId}`)
      nowMine.status === 200
        ? ok('the head can now read their own constituency')
        : bad(`head reading their own group gave ${nowMine.status}`)

      const otherBacenta = await leader(`/api/bacentas/${biazo.body.bacenta.$id}`)
      otherBacenta.status === 403
        ? ok('but still not a bacenta they do not head (403)')
        : bad(`head reading an unheaded bacenta gave ${otherBacenta.status}`)

      const writeAttempt = await leader('/api/bacentas', {
        method: 'POST',
        body: JSON.stringify({ name: `Leader should not create ${stamp}` }),
      })
      writeAttempt.status === 403
        ? ok('a head cannot create groups (403) — read-only, as specified')
        : bad(`leader creating a bacenta gave ${writeAttempt.status}`)

      const memberWrite = await leader('/api/members', {
        method: 'POST',
        body: JSON.stringify({ first_name: 'No', last_name: 'Way', call_number: '0240000000' }),
      })
      memberWrite.status === 403
        ? ok('a head cannot register members (403)')
        : bad(`leader creating a member gave ${memberWrite.status}`)
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
    // --- cleanup ------------------------------------------------------------
    // In `finally` so a failed assertion above does not leave throwaway groups
    // in a live project. Members first: deleting one cascades to its bacenta
    // rows, so the groups are empty by the time they go.
    console.log('\ncleanup')
    for (const id of created.members) {
      const res = await admin(`/api/members/${id}`, { method: 'DELETE' })
      res.status === 200 ? ok(`member ${id} removed`) : bad(`member ${id} left behind`)
    }
    for (const id of created.bacentas) {
      const res = await admin(`/api/bacentas/${id}`, { method: 'DELETE' })
      res.status === 200 ? ok(`bacenta ${id} removed`) : bad(`bacenta ${id} left behind`)
    }
    for (const id of created.categories) {
      const res = await admin(`/api/bacenta-categories/${id}`, { method: 'DELETE' })
      res.status === 200 ? ok(`category ${id} removed`) : bad(`category ${id} left behind`)
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
