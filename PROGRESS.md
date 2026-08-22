# Progress

Module status for the The Mega Church Biometric Attendance System.
See `.agent/plans/1.foundation.md` and `.agent/plans/2.groups-birthdays-pwa.md`
for the phase breakdowns.

| Phase | Module | Status |
|---|---|---|
| A | Scaffold + docs | ✅ done |
| B | UI system (PickLT, re-themed) | ✅ done |
| C | Biometric core (semp, verbatim) | ✅ done |
| D | Appwrite schema + setup script | ✅ done — **not yet run against a real project** |
| E | Attendance orchestrator | ✅ done |
| F | Routes + auth/RBAC | ✅ done |
| G | Screens | ✅ done |
| H | Verification pass | ✅ done — see below |
| I | Constituencies + bacentas | ✅ done — Plan 2, verified live |
| J | Head accounts (`leader`) | ✅ done — Plan 2, scoping proven server-side |
| K | Birthday lead-time + `celebrations` role | ✅ done — Plan 2 |
| L | PWA + Web Push | ✅ done — Plan 2. **Needs a scheduler wired; see below** |
| M | Head accounts created in-app | ✅ done — Plan 3 |
| N | Per-constituency attendance exports | ✅ done — Plan 3 |
| O | Bulk SMS (mNotify) | ✅ done — Plan 3, verified against a real handset |

## Verified

- `npx tsc --noEmit` — clean.
- `npx vitest run` — 79 passed, 4 skipped (the skips need a real fingerprint
  corpus in `corpus/`, which is deliberately not committed).
- `npm run build` — 31 routes compiled.
- Browser pass against a stubbed Appwrite: login, dashboard, member registry,
  member detail with the four-finger enrolment panel, services, meetings, the
  member checklist, the live monitor, and the kiosk in both its idle and
  session-open states.
- **Single active session** — activating Second Service while another session
  is open returns `409` with
  *"Youth Committee is still open. End it before activating Second Service —
  only one session can run at a time."*
- **Scan outcomes** — `already_marked`, `not_authorised` (returning the
  member's NAME and the meeting), and `inactive_member` all resolve correctly.
- **Biometric chain** — a real Futronic bridge on `127.0.0.1:7788` reports
  healthy, and `/api/biometrics/matcher-health` confirms the server matches
  in-process via the NBIS WebAssembly artifact.

## Live backend

Appwrite **Cloud**, `fra` region, project `mega-church`, server version 1.9.6.
(An early draft of `CLAUDE.md` said "self-hosted only" — that is SEMP's
constraint, carried over here by mistake and since removed.)

Applied 2026-08-09 with `npm run setup:appwrite`:

- 6 collections, 46 attributes, 19 indexes, 2 buckets, both services seeded.
- A second run reports `created 0` across the board — idempotency confirmed,
  not assumed.
- `npm run verify:appwrite` passes every check: no attribute stuck
  `processing`, both services `restricted: false`, both unique indexes present
  and actually unique, both buckets reachable, and the biometric gallery loads.

One schema bug was found and fixed doing this: Appwrite rejects an attribute
that is both `required` and defaulted. Seven attributes had both. The helpers
now throw on that combination before the API is called.

## Accounts

`npm run seed:users` created three, one per role, with generated passwords in
`.env.local` (gitignored). Re-running reports "exists — password left
unchanged", so it will never silently reset a password someone has changed.

| Role | Email | |
|---|---|---|
| admin | `admin@megachurch.local` | everything |
| usher | `usher@megachurch.local` | live monitor, manual check-in, member lookup |
| kiosk | `kiosk@megachurch.local` | `/kiosk` only; `station = "Main entrance"` |

The domain is a placeholder. Nothing depends on it — there is no
forgot-password flow — but change it when the church has a real domain.

## End-to-end, against the live project

`npm run e2e` (needs `npm run dev` running) drives the real HTTP API against
Cloud. 38 checks, all passing, verified twice:

- wrong password → 401; each role signs in with the right label
- `024…` normalised to `+233…`; WhatsApp kept independent; 29 February accepted
- bad phone and missing call number rejected **server-side**
- roster persists and reads back ticked; a roster on a service is refused
- First Service open ⇒ Second Service **409**, and a *meeting* is blocked too —
  proving the rule is global, not "the two services are exclusive"
- mark → `marked`; mark again → `already_marked` with no second row
- unauthorised member comes back **`not_authorised` with their name and the
  meeting's name**, not `no_match`
- an inactive member is refused even while on the roster
- usher cannot create members or activate a session (403); kiosk cannot read
  the registry (403); anonymous callers get 401
- kiosk scan path resolves a `sim:` payload end to end

It writes real data and cascades it away afterwards; `npm run verify:appwrite`
confirms the project is left at 0 members with no session open.

**Do not run `npm run e2e` during a service** — it opens and closes a real
session on First Service.

## Kiosk pack — published

`npm run build:kiosk-pack` built and published `church-kiosk-pack-20260809.zip`
(4.2 MB) to `kiosk-downloads/current`. Verified after publishing, not before:

- `/api/kiosk-pack` returns 401 anonymous, **403 to a kiosk account** (it is a
  provisioning artifact, not something a kiosk needs), 200 to an admin.
- All 10 files verify against the pack's own `SHA256SUMS.txt` after a full
  round trip through Storage, and `church-scan.exe` is still i386 — the check
  that would catch the byte-level corruption that bit this port once already.
- The downloaded pack was unzipped into an empty folder with no repo, no
  `node_modules` and no `.env`, and its bridge started and reported
  `{"ok":true,"device":true,"scanBin":true,"nbis":true}` **against the real
  Futronic scanner**.

To provision a PC: sign in as admin, download `/api/kiosk-pack`, run
`install.cmd`. Re-publish with `npm run build:kiosk-pack` — it overwrites the
same `current` id, so the link never has to change.

## Plan 2 — groups, birthdays, PWA push

Applied 2026-08-12. See `.agent/plans/2.groups-birthdays-pwa.md`.

### Schema

`npm run setup:appwrite` added 6 collections, 36 attributes and 17 indexes
against the live project. A second run reported `created 0` across the board —
idempotency confirmed, not assumed. `npm run verify:appwrite` passes, including
all seven unique indexes and a new check that no bacenta points at a missing
category.

### Verified

- `npx tsc --noEmit` — clean.
- `npx vitest run` — **140 passed**, 4 skipped (was 79). 54 of those are Plan
  2's own: the bacenta tree and the birthday calendar arithmetic, both pure.
  The remaining rise came with the day-attendance exports and the FS81 fixes.
- `npm run build` — 47 routes, including `/manifest.webmanifest`.
- `npm run e2e:groups` — **46 checks, all passing** against the live project.
  Safe to run during a service: it never opens an attendance session, and it
  deletes everything it creates in a `finally` block.

The e2e suite proves, among others:

- a duplicate group name is refused case- and whitespace-insensitively
- an **admin** account is refused as a group head — a head who cannot open the
  page is worse than no head
- `category_id: null` really is the standalone case, and "Biazo" standalone
  coexists with "Biazo" under Choir
- deleting a category that still holds bacentas is a 409
- one member registered into a constituency **and two bacentas** at once
- editing an unrelated field leaves bacenta membership untouched; `[]` clears it
- a `leader` cannot enumerate constituencies (403), cannot read a group they do
  not head (403), and **can** read both a constituency and a bacenta once
  appointed to each — one login, two kinds of data
- a head cannot create groups or register members (403)
- the `celebrations` account reads birthdays but not the member registry (403)
- the birthday run is idempotent: a second call returns `already_sent`

### Browser pass (live data, 38 real members)

Bacentas render in both shapes — *Choir* over Biazo / Fresh Oil / Living
Waters, and *Groups on their own* holding Media / Technical Team / Ushers. The
registration form shows the constituency dropdown and the grouped bacenta
ticks. The bulk assigner listed all 38 members with a "Select these (38)"
control; ticking three and pressing **Add to Ahodwo** reported "3 members added"
and the roster and stat cards followed.

Signed in as the head account, the navigation collapses to **My groups** alone,
the tile shows their one constituency, and the group page is read-only — no
Delete, no Assign tab — with real attendance ("1×, last seen 2026-08-09").

The dashboard card reads **Birthdays tomorrow · For 2026-08-13**, one day ahead
as specified.

### One bug found and fixed doing this

`proxy.ts` gated `/api/notifications/*` behind the session cookie, so a
scheduler presenting a valid bearer token got a `401 Authentication required`
from the proxy **before the route ever saw the token**. The daily notification
would simply never have fired, with nothing in the app to explain why. The path
is now public at the proxy and authenticated by the route itself; the smoke
test asserts on the error *message* so it can tell the two layers apart.

## Not yet done

Needs people, hardware or a decision — not more code:

1. ~~**Wire the scheduler.**~~ ✅ Done in Plan 3 — declared as a Vercel Cron Job
   in `vercel.json`, alongside the new birthday-SMS run. See "The two daily
   jobs" in `README.md`. **`CRON_SECRET` must be set in the Vercel project's
   environment variables**, because that is the exact variable Vercel reads to
   build the `Authorization: Bearer` header it sends.
2. **Push on real phones.** The VAPID keys are generated and the server serves
   them, but no device has subscribed yet. On iPhone the app must be added to
   the Home Screen first — Safari does not deliver push to an ordinary tab, and
   the birthdays page says so before anyone tries.
3. **The rest of the head accounts.** `npm run seed:users` creates one template
   `leader`. The church needs one per head — create them in the Appwrite console
   with the same `leader` label, then appoint each from its group's page.
4. **Real constituency names.** "Ahodwo" was created during verification as a
   placeholder and has three members filed into it. Rename or delete it and
   create the church's actual four.
5. **End-to-end enrolment on hardware** — capture twelve real prints for one
   member and check them in at the kiosk. The pipeline is the one proven in
   SEMP, but it has not been run on a member of this congregation.
6. **Threshold calibration.** 33 is evidence-backed on a small corpus
   (`lib/biometrics/matching.ts`). Widen the corpus before trusting it against
   a large congregation — false-accept probability grows with gallery size.

## Plan 3 — heads, per-constituency exports, SMS

Applied 2026-08-21. See `.agent/plans/3.heads-exports-sms.md`.

### Schema

`npm run setup:appwrite` added 2 collections, 18 attributes and 6 indexes.
A second run reported `created 0` across the board — idempotency confirmed, not
assumed. `npm run verify:appwrite` passes, including the new
`sms_messages.dedupe_unique` check and a "at most one default template per
category" check.

### What the report got right, and what it got wrong

"There is no implemented way to add a head" was half right, and the half that
was wrong said where the work went. `resolveHead()`, both POST routes, both
PATCH routes and `GET /api/leaders` all already existed and worked. What was
missing:

1. no head control on either **detail** page — only on the create dialogs;
2. no way to create a `leader` ACCOUNT outside the Appwrite console.

(2) is what made (1) look total: a church that had never opened the console saw
an empty Head dropdown and reasonably concluded the feature was absent.

### Verified

- `npx tsc --noEmit` — clean.
- `npx vitest run` — **170 passed**, 4 skipped (was 140). 30 new: SMS rendering,
  part counting, the `+233`→`233` conversion, constituency slicing and
  worksheet-name de-duplication.
- `npm run build` — **69 routes** (was 47).
- **A real SMS reached a real handset.** `POST /api/notifications/birthday-sms`
  with the cron token: `sent: 1`, mNotify replied *"messages sent
  successfully"*. A tithe send through `/sms` reached the same handset.
- **Idempotency proven, not assumed.** Second and third calls of the birthday
  run returned `sent: 0, skipped: 1`, and the log held exactly ONE row for
  three calls. The tithe send to the same member on the same day went through,
  because its key is `manual:<random>` — the guard blocks repeats without
  blocking legitimate re-sends.
- **Cascade** — deleting the test member removed its 2 `sms_messages` rows.
- **Export partition is exact.** For 2026-08-09 the whole-church absent list was
  113; the per-constituency workbook gave 28 + 1 + 0 + 0 + 84 = **113**. Nobody
  double-counted, nobody dropped.
- **Leader export authorisation, all four branches:** own constituency 200 with
  a real .xlsx; another constituency 403; `constituency_id` **omitted** 403 (not
  defaulted to the whole church); `by=constituency` 403.
- **Head accounts end to end** — created through the UI, signed in with the
  generated password, landed on `/my-groups`, saw one group read-only with the
  download card and **no** Head card, **no** Assign tab and **no** constituency
  picker. The admin-only `/api/constituencies` was never even requested.
- **Refusals** — duplicate leader email 409; unknown `{{placeholder}}` 400
  naming the token; duplicate template name caught case- and
  whitespace-insensitively; a tithe template submitted under `category:
  birthday` refused, which is what stops a tithe send taking the birthday
  dedupe key and silently suppressing the real birthday message.
- `leader` gets 403 on every `/api/sms/*` route and on `POST /api/leaders`;
  anonymous gets 401.

Everything created during verification was deleted afterwards — the test
member, its messages, and the `alos.head@megachurch.local` account, which was
also un-appointed from Alos Constituency first. `npm run verify:appwrite`
confirms the project is back to 116 members.

### Scheduling

Both daily jobs are declared in `vercel.json` as Vercel Cron Jobs, so deploying
schedules them:

| Job | Schedule (UTC) | Audience |
|---|---|---|
| `/api/notifications/birthday-run` | `0 6 * * *` | the celebrations team, by push, the day BEFORE |
| `/api/notifications/birthday-sms` | `0 8 * * *` | the celebrant, by SMS, ON the day |

**Africa/Accra is UTC+0 all year** — GMT with no daylight saving — so those UTC
hours are already Accra times. That is geography, not design; a deployment in a
DST zone would drift an hour twice a year.

**`CRON_SECRET` must be set in the Vercel project's environment variables.**
Vercel reads that exact name and sends `Authorization: Bearer <CRON_SECRET>` on
every invocation; without it the header is absent and the routes correctly
refuse. `NOTIFICATIONS_CRON_SECRET` is also accepted, so an external scheduler
can carry a different secret. The shared check lives in
`lib/notifications/cron.ts` — previously duplicated in both routes, which is a
timing-safe comparison that only gets fixed in one of them.

Vercel's Hobby plan allows exactly two daily cron jobs. Both slots are used.

Confirmed registered and enabled on 2026-08-21 via the Vercel API — both
definitions present, `disabledAt: null`.

**Vercel Authentication is scoped to *Only Preview Deployments*, deliberately.**
A cron invokes the production DEPLOYMENT url, not the alias, and under the
previous `all_except_custom_domains` setting that url answered `302` to
`vercel.com/sso-api` — the invocation would never have reached the route, and
nothing in the app would have reported it. Re-tightening that setting silently
stops birthday texts. See "Deployment protection" in `README.md`.

Verified after the change, against the cron's exact target host and with no
bypass header: no token ⇒ 401, wrong token ⇒ 401 `Invalid scheduler token`,
real token ⇒ 200. Preview deployments still answer 302 to SSO, so nothing was
opened that was not already public at `mega-church.vercel.app`.

### Templates

`npm run seed:sms` writes five starting templates — two birthday, two tithe,
one general. Idempotent: it creates only what is missing by name and **never**
overwrites a body somebody has edited, so it is safe to re-run after the church
has rewritten the wording. It also refuses to seed anything that renders to
more than one SMS part, rather than trusting whoever edits the file to count.

The wording is a starting point, not a house style. The second birthday
template exists to make the per-member override useful on day one: an elder or
a recently bereaved member is not addressed the same way as everybody else, and
having a second wording ready makes that a choice rather than a project.

### Still to do for SMS

1. ~~**Watch the mNotify credit balance.**~~ ✅ Done 2026-08-22 (PR #15). The
   balance is shown on `/sms`, warns below `LOW_CREDIT_AT`, and the confirm
   dialog refuses to be quiet when a send costs more than the account holds.
   `credit_left` was already arriving on every send response and being
   discarded; it is now reported too. The threshold still wants calibrating
   against the church's real send volume.
2. ~~**Confirm the first live cron firing.**~~ ✅ Done 2026-08-22 — and it did
   not work. See below.

## The cron had never once run — 2026-08-22

Confirming the first scheduled firing took a full morning and four slots,
because the answer was that **no scheduled firing had ever reached the route,
on any day, since the crons were declared.**

### The bug

A Vercel Cron Job invokes its path with **GET**. Both notification routes
exported only `POST`. Every firing answered **405 Method Not Allowed** before
the handler ran.

From the Vercel log of a manual Run at 11:03 UTC, on the production deployment
host a cron actually targets:

    GET /api/notifications/birthday-run -> 405
    User Agent:  vercel-cron/1.0
    Firewall:    Allowed
    Middleware:  200

That single entry also clears everything else that had been suspected.
`Firewall: Allowed` and `Middleware: 200` mean deployment protection was never
in the way and the `/api/notifications/*` proxy exemption works. `CRON_SECRET`
is set correctly and was never reached, because 405 happens before auth.

### Why it survived every check

Every manual proof — in this file, in the smoke tests, in the by-hand checks
against the exact deployment host — was a `curl -X POST`, and every one
passed. The scheduler's request and the tested request differed in exactly the
one dimension nobody compared.

**Verify a cron the way the cron calls it.** "Proven by hand" and "proven as
invoked" are different claims, and only the second keeps a birthday text
arriving. The rule is now in `CLAUDE.md`.

### Why it took a morning to see

The other half of the problem was that a firing left no trace. `birthday-sms`
had four exits and three wrote nothing at all, so on a day with no celebrants
a firing was indistinguishable from a scheduler that never fired — and the
only prescribed evidence, "a row stamped `scheduler` in the SMS log", could
not exist unless somebody happened to have a birthday.

Fixed in PR #16: every exit now records a `notification_runs` row via
`recordRun`, which UPSERTS and never gates — deliberately not `claimRun`,
because the SMS job is idempotent per member so a run that dies at member
forty of sixty can be re-run for the remaining twenty.

### Proven working

Both fixes deployed, then the scheduler fired **unattended** at 11:21:30 UTC
against a 11:15 slot, with nothing touched by hand:

    notification_runs  2026-08-22  kind=birthday-sms  by=scheduler
                       status=sent  celebrants=2  sent=2  failed=0  skipped=0
    sms_messages       233599494442  sent  key=birthday:<member>:2026-08-22
                       provider: "messages sent successfully"

Two test members carrying that day's birthday received real texts. Both were
deleted afterwards with `deleteMemberCascade`, verified to leave no orphan
`sms_messages` rows, and the project is back to 116 members.

Also confirmed along the way, by a manual tithe send at 10:44 that reached a
real handset: credit, the approved sender ID, rendering, the dedupe key and
the provider are all healthy. The fault was only ever the verb.

### Left as it was

The Hobby plan gives cron jobs a **one-hour flexible window**, so `0 8 * * *`
fires somewhere in 08:00–09:00 UTC. That is not a fault and nothing in the app
can make it punctual; a quiet log at 08:05 means nothing until 09:00 has
passed.

`birthday-run`'s `no_subscribers` and send-failure paths still call
`releaseRun`, which deletes the row so a retry can send — so those two exits
leave no trace. Closing that means separating the mutex from the audit trail,
a larger change to a working lock. Its quiet-day path keeps its row, so the
common case is covered.
