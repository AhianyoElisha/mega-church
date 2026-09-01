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
| L | PWA + Web Push | ✅ done — Plan 2. Scheduler wired; delivery observed on Android AND iPhone 2026-08-31 |
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
   jobs" in `README.md`. `CRON_SECRET` is **set in the Vercel project and
   confirmed working** — five consecutive days of scheduled runs authenticated
   with it. See "`CRON_SECRET` is set — confirmed from the outside" below.
2. **Push on real phones.** ⚠️ Both platforms now deliver — Android from the
   scheduled run, and the iPhone as of 2026-08-27, whose `last_success_at` had
   been `null` since the day it subscribed. The cause was the `VAPID_SUBJECT`
   placeholder, which Apple refuses and FCM ignores; see "The iPhone had never
   received a push" below. ✅ **`VAPID_SUBJECT` is now set in the Vercel
   project** — `https://mega-church.vercel.app`, on all three environments, and
   PR #30 is merged. It turned out to have been set all along, to the very
   placeholder the code was being cleaned of; see "The variable was set all
   along, to the wrong value" below. What is left is one READING, not a change:
   the iPhone's `last_success_at` after the next scheduled run.
3. ~~**The rest of the head accounts.**~~ ✅ Done — four `leader` accounts
   (`alos`, `tsalack`, `anagkazo`, `anadeia`) exist as of 2026-08-22, and heads
   are now created in-app rather than in the console (Plan 3). **`.env.local`
   was never updated:** `SEED_LEADER_EMAIL` still names the deleted template
   account `leader@megachurch.local`, and `SEED_ADMIN_PASSWORD` is no longer
   what `admin@megachurch.local` holds. Both break `npm run e2e:groups` until
   corrected — see "How it was run" under the head-editing section.
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

## Constituency heads register members — 2026-08-23

A head was read-only. They now have a third write, and it is the one the church
asked for: **registering a new member into a constituency they head**, with
every detail in PRD §1.1 except the three the church decides rather than the
head. **Biometric enrolment is not part of it and is not reachable from it.**

| Layer | Change |
|---|---|
| `lib/groups/tree.ts` | `headRegistrationScope()` — pure, the whole boundary in one function |
| `POST /api/members` | `admin` → `admin \| leader`; a leader is narrowed by the above, then `status` and `sms_template_id` are FORCED |
| `POST /api/members/[id]/photo` | `admin` → `admin \| leader`, gated on `canReadGroup` over the MEMBER's own constituency |
| `/constituencies/[id]/register` | the head's front desk — one page, files into one group, photo on the screen after |
| `components/member-form.tsx` | a `restrict` prop, so it is the same form minus what a head may not decide — not a second form that can drift |
| `useBacentas` / `useSmsTemplates` | gained `enabled`, because both 403 a leader and a cached failure would put a broken page in front of them |

### Why the constituency is refused rather than defaulted

A head of two constituencies who does not say which one gets a 400, never
"their first". It is the same rule `/api/reports/export` follows, for the same
reason: a guessed constituency is invisible afterwards — the member simply
turns up in the wrong roster and nobody knows to look.

### Verified

- `npx tsc --noEmit` — clean.
- `npx vitest run` — **197 passed**, 4 skipped (was 186). 11 new, all on
  `headRegistrationScope`: the positive case, both foreign-group refusals, the
  omitted constituency, and a bacenta-only head, who is refused because they
  have no basis for saying where anybody LIVES.
- `npm run build` — 73 routes, including `/constituencies/[id]/register`.
- Anonymous callers still get 401 from both widened routes, and the new page
  307s to `/login` — it sits under the `/constituencies` prefix the proxy
  already covers, so no matcher change was needed.

### Proven against the live project

`npm run e2e:groups` — **72 checks, all passing**, including 13 for this
strand: an omitted constituency refused, a neighbour's constituency refused, a
foreign bacenta refused, the positive registration, both forced fields, phone
normalisation through a head registration, and enrolment still 403.

## Heads edit their own members too — 2026-08-23

The door left shut above, opened in the same session. A head may now correct any
member in a constituency **or** a bacenta they head.

| Layer | Change |
|---|---|
| `lib/groups/tree.ts` | `headEditScope()` and `headBacentaMerge()` |
| `GET /api/members/[id]` | `admin \| usher` → `+ leader`, scoped; now also returns `constituency_name`, because a head cannot resolve the id themselves (`/api/constituencies` 403s them) |
| `PATCH /api/members/[id]` | `admin` → `admin \| leader`, narrowed by `headEditScope` |
| `/my-groups/members/[id]` | the head's member page — details, photo, nothing else |
| `components/group-roster-table.tsx` | `linkToMembers: boolean` → `memberHref: (id) => string`, because admins and heads go to different pages for the same member |

### Two decisions worth keeping

**Editing is scoped wider than registering.** Registering demands a
constituency the head runs — a bacenta head cannot say where somebody lives.
Editing reaches anyone their group pages already show them in full. Different
scopes, on purpose, in two separate functions.

**Bacenta ticks are MERGED, not substituted.** A head only ever sees the
bacentas they head, so writing that list as the member's complete answer would
remove them from every other one — a constituency head correcting a phone
number would silently take somebody out of the choir. This is the
`undefined`/`[]` rule from `CLAUDE.md` one level deeper, and it would have
failed in exactly the same silent way. `headBacentaMerge` carries untouchable
memberships through, and the form says so on screen rather than showing a head
an unticked list that reads as "in no other bacenta".

A refused field is refused **by name**: a `PATCH` carrying `status` or
`sms_template_id` gets a 403 saying which and why. Silently stripping it would
answer 200 and leave the head believing it saved.

### Verified

- `npx tsc --noEmit` — clean.
- `npx vitest run` — **214 passed**, 4 skipped (was 197). 17 new, on
  `headEditScope` and `headBacentaMerge`, including the merge case that is the
  whole reason the second function exists.
- `npm run build` — 74 routes.

### Proven against the live project

`npm run e2e:groups` — **72 checks, all passing**, 26 of them for these two
features together. The edit half:

- a head opens one of their members, constituency resolved by NAME
- corrects a mistyped number (200), and `0249999999` comes back `+233249999999`
- `status` refused, `sms_template_id` refused, a CHANGED `constituency_id`
  refused — each 403
- the same `constituency_id` resent is **not** a move and is accepted
- **the merge**: an admin put the member into a bacenta the head does not head,
  the head then saved a form with everything unticked, and the invisible
  membership survived while their own was removed
- enrol 403, delete 403
- a member outside every group they head: 403 on read AND on write

`npm run verify:appwrite` afterwards — all checks pass, 116 members, 4
constituencies. The suite deletes everything it creates in a `finally`, and it
left nothing behind.

### How it was run, and what that says about the seeded credentials

Two things were stale and both would have shelved the suite indefinitely:

1. `SEED_ADMIN_PASSWORD` is no longer what `admin@megachurch.local` holds.
   Appwrite answers `user_invalid_credentials` to the credential directly, so
   this is not the app. `seed:users` will not fix it — by design it never
   resets a password somebody has changed.
2. `SEED_LEADER_EMAIL` is `leader@megachurch.local`, which **no longer
   exists**. The template head was replaced by the church's four real heads
   (`alos`, `tsalack`, `anagkazo`, `anadeia`) on 2026-08-22, and nothing
   updated the suite's expectation.

Rather than reset a live login or borrow a real head's, the run used two
throwaway accounts created through the server API key
(`e2e.admin@`, `e2e.leader@`), and **both were deleted afterwards** — confirmed
by re-listing the project's accounts.

To make that possible without editing `.env.local`, the script now reads
`.env.local` **first and the real environment on top**, for any `SEED_*` key.
That is also what lets CI supply credentials it will never write to a file:

    SEED_ADMIN_EMAIL=… SEED_ADMIN_PASSWORD=… npm run e2e:groups

**Fix the two stale values in `.env.local`** so the next person does not have to
rediscover this.

## Camera capture for member photos — 2026-08-23

Uploading was the only way to give a member a photo. Now **Take photo** sits
beside **Upload** on every screen that has the control (the member page, the
head's member page, and the register flow) — one component, three call sites,
no API change.

`components/camera-capture.tsx` is a dialog: live preview, shutter, then a
review step with **Retake** / **Use this photo**. It captures to a canvas at
1280px on the long side and hands back a JPEG the existing upload mutation
sends unchanged, so a photo behaves identically whichever door it came through.

### The parts that are easy to lose in a refactor

- **The stream is stopped on close, on unmount, before switching cameras, and
  the moment there is a photo to review.** A `MediaStream` nobody stopped keeps
  the lens live and the indicator light on after the dialog is gone — which
  reads, to the person being photographed, as being recorded.
- **`playsInline` and `muted`** — without both, iOS Safari takes the video
  fullscreen and the shutter button is no longer on screen to press. Nothing
  errors; the feature is just unusable on the phones most likely to be used.
- **Nothing is mirrored.** The operator is photographing somebody across a
  desk, not taking a selfie, and a face stored mirrored is a face an usher
  compares against backwards on the kiosk card.
- **Upload never goes away.** `navigator.mediaDevices` is undefined outside a
  secure context — exactly how a kiosk PC on a church LAN is reached over plain
  http — so `cameraAvailable()` is checked in an effect and the camera button
  is simply not offered there.

Rear camera is requested by `facingMode: { ideal: 'environment' }`, which
degrades to the only camera on a laptop rather than failing. A **Switch
camera** control appears when the device reports more than one, built from
`enumerateDevices` after permission is granted — ids are not readable before
that.

getUserMedia rejections are translated by `DOMException.name`, not message:
a refused permission says how to un-refuse it, a camera in use by another app
says so, and both point at upload as the way through.

## Pausing and resuming a session — 2026-08-23

Activating used to leave exactly one way out: **End**. That is the wrong tool
when a service has not finished but a different activity needs the scanner —
ending freezes the tally and makes the rest of the service a second occurrence.

`OccurrenceStatus` gains `paused`, defined as precisely **"not `open`"**, and
both behaviours the church asked for fall out of that one fact:

- every liveness check already filters on `open`, so **the kiosk stops
  scanning**;
- `canActivate` filters on `open`, so **the slot is free** and another session
  can be activated while the first stays paused.

Neither is a special case anybody has to remember, which is the point.

| Layer | Change |
|---|---|
| `lib/attendance/occurrenceResolver.ts` | `canResume()`, `resumeBlockedMessage()` — pure, unit-tested |
| `lib/attendance/server.ts` | `pauseOccurrence`, `resumeOccurrence`; `resolveSessions()` now returns `{ session, paused }` from ONE query; `closeOccurrence` accepts a paused session |
| `POST /api/occurrences/[id]/pause` `…/resume` | admin only; resume 409s with the blocking session attached |
| `GET /api/attendance/active` | carries `paused: ActiveSession[]` alongside `session` |
| scan + manual routes | a 423 now says *"First Service is paused"* rather than *"No session is open"* |
| Services page, session bar, header pill, kiosk | all name a paused session instead of implying nothing is running |

### What pausing is NOT

**A small close.** Nothing is frozen: `present_count` is still computed from
the rows at close, so attendance marked before the pause and after the resume
belongs to the same occurrence and is counted once. Closing and re-activating
would give the church two half-counts of one service and no way to add them up
afterwards — that difference is the whole reason this is not just a button that
calls close.

A paused session **can be closed directly**, without being resumed first. A
service that was paused and then simply finished is the ordinary way this ends,
and re-arming the scanner for a moment to satisfy a state machine is not.

Resuming **is** refused while something else is open, naming it — that would
put two sessions on the scanner, which PRD §2.2 forbids.

### Verified

- `npx tsc --noEmit` — clean.
- `npx vitest run` — **223 passed**, 4 skipped (was 214). 9 new on the resolver,
  including the two that matter: a paused session does not block activation,
  and a resume is refused while something else is open.
- `npm run build` — 76 routes.

### Schema applied — 2026-08-23, after the service ended

`npm run setup:appwrite` reported **`attributes created 2`**: the `status` enum
widened to `open|closed|paused`, and `paused_at` added. A second run reported
`created 0` across the board — idempotency confirmed, not assumed.

The widening was **in place**. All five occurrence rows survived with their
statuses intact, and the `by_status` index over them was never dropped. That is
`ensureEnumAttribute` doing what it was written to do; dropping and recreating
an enum attribute would have taken the index and every row's status with it.

`npm run verify:appwrite` passes.

### Proven against the live project

A focused check drove the whole state machine through the HTTP API, on its own
throwaway member and two throwaway meetings — **neither real service was
touched** — and deleted everything in a `finally`. 24 checks, all passing:

- pause returns 200, `status=paused`, `paused_at` stamped
- **the kiosk sees no live session** — `/api/attendance/active` reports
  `session: null` with the paused one named on the same response
- a check-in during the pause is **423, and the message says it is paused**
  rather than that no session is open
- **another session activates while the first stays paused** — the slot really
  is free, which is the entire reason this feature exists
- resuming while that other session is open is **409, naming the blocker**
- after it ends, resume returns 200, `status=open`, `paused_at` cleared
- **the member marked BEFORE the pause is still marked after it**, and the
  session closes with `present_count = 1` — one occurrence, counted once across
  the pause. This is the claim that separates pause from close, and it is now
  proven rather than argued.
- a paused session can be **ended directly** without being resumed first
- a closed session **cannot** be resumed

Afterwards: 5 occurrence rows, all `closed`; 2 meetings, both real services;
133 members. Nothing left behind.

The run needed an admin session, and `SEED_ADMIN_PASSWORD` is still stale (see
the open items), so it used a throwaway `e2e.admin@` account created through the
server API key and **deleted afterwards** — no live login was touched.

## Fingerprint identification was taking ~2.8 seconds — 2026-08-23

The church reported check-in as too slow. Measured against the **live** gallery
(99 members, 1,188 templates) before changing anything:

| | |
|---|---|
| one identification | **2,799 ms** |
| gallery fetch, cold | **5,876 ms**, and cached for only 60s |

So a member stood at the scanner for ~2.8 seconds normally, and for ~8.7
seconds once a minute when the cache had expired — with nothing on the kiosk to
explain the difference. Both figures grow linearly with the congregation.

### What the measurement killed

The first hypothesis was that `decodeXytTemplate` re-validating every stored
template on every scan (a per-line regex over ~1,188 templates) was the cost.
**It was not.** Decoding once and reusing the wasm pointers came out at 1.0x —
no improvement at all. bozorth3 itself is the whole bill, at ~3.2 ms per
comparison × 1,188 comparisons.

Worth writing down, because it is the obvious-looking optimisation and it is
worthless.

### What actually worked

| Change | Effect |
|---|---|
| Stop on a **decisive** score instead of always taking the argmax | 1.9x |
| **+ score the people who have not checked in yet first** | **4.3x** |

They only work together: ordering alone buys nothing, because argmax has to
look at everything anyway. It is the early exit that turns a good ordering into
time saved.

**2,799 ms → 646 ms**, measured through the shipping code path. All ten sampled
scans named the same member before and after.

### The honest cost

Argmax over the whole gallery is the only rule that cannot, even in principle,
be beaten by a candidate that was never scored. Exiting early trades that for
speed, so the bar is set where an impostor realistically cannot reach: **twice
the threshold** (66 by default), against a corpus where impostors scored 3-27
and genuine pairs had a median of 84.

On the live sample, genuine scans scored min 49 / median 146 / max 283. The one
at 49 does **not** clear the bar — so that scan falls through to a full argmax
and is decided exactly as it is today: slower, and correct. Failing to be
decisive costs time, never accuracy, which is the direction this has to fail in.

`CHURCH_BIOMETRIC_DECISIVE=9999` disables the early exit and restores exact
argmax semantics. That is the escape hatch if a false accept is ever traced
here.

### The gallery-fetch cliff

`invalidateCandidateCache()` is already called on every write that changes the
gallery, so the TTL was never the freshness mechanism — only a backstop. It is
now 5 minutes rather than 60 seconds, and **expiry serves the stale copy while
refreshing underneath**, so no scan waits for a fetch.

Explicit invalidation still DROPS the entry, deliberately: enrol-then-test is a
real flow and a member just enrolled has to match on the very next press.

`warmCandidateCache()` now runs on activate and on resume, so the first member
of a service does not pay the fetch at the worst possible moment.

### Not done, and the bigger lever

`match_templates()` in `tools/nbis-wasm/src/nbis_wasm.c` re-parses **both**
templates on every call — so the probe is parsed and analysed 1,188 times per
scan, identically. Splitting it so the probe is prepared once per scan and each
gallery template once per gallery load would cut the remaining time
substantially **and preserve scores exactly**, since it is the same algorithm
with the redundant work removed.

It needs an emscripten rebuild of the wasm, and this machine has neither `emcc`
nor Docker, and the NBIS sources are not vendored (`setup.sh` fetches them). So
it is the obvious next step, not a skipped one.

### One pre-existing thing the benchmark surfaced

Under leave-one-out, **9 of 10** sampled members were identified correctly —
the same 9 before and after, so this is not caused by these changes. One
member's fresh press does not identify them at the current threshold. That is a
false reject, and it is worth investigating separately against a wider corpus
(the threshold note in `lib/biometrics/matching.ts` already flags that the
calibration corpus is small).

### The wasm probe re-parsing, fixed — same day

The lever named as "not done" above turned out to be reachable: `emsdk` installs
on Windows, and the NBIS sources are a `git clone` plus two headers that NBIS's
own setup generates from `.src` templates.

`match_templates()` is a **1:1 verification** call. Using it for 1:N was the
whole problem, because `bozorth_main` is literally:

    probe_len = bozorth_probe_init( pstruct );      <- parse + O(n^2) Web build
    return bozorth_to_gallery( probe_len, pstruct, gstruct );

so a 1,236-template gallery rebuilt the **same** probe Web 1,236 times to
produce 1,236 identical intermediate results.

NBIS already ships the split — `bz_drvrs.c` documents `bozorth_probe_init` as
being for exactly this scenario. Three new entry points expose it:

| | when it runs |
|---|---|
| `set_probe()` | once per **scan** |
| `prepare_template()` | once per **gallery load** |
| `match_prepared()` | the per-comparison work, and only that |

`struct xyt_struct` is ~2.4 KB, so holding the whole gallery parsed is under
3 MB — cheap enough that parsing belongs at load time rather than in the loop.

### Proven identical, not assumed

The old artifact was still in `public/nbis/`, so both were run side by side over
the real gallery: **7,416 score comparisons across 6 probes, 0 mismatches.**
Also checked: a prepared template reused three times scores the same each time,
and switching probes mid-life does not contaminate the next result.

That equivalence is expected — this is the same call sequence with the
loop-invariant half hoisted — but "expected" and "checked" are different claims,
and this is a matcher.

### The numbers

Measured on the live gallery, which had grown to 103 members / 1,236 templates
(so this is *more* work than the 2,799 ms baseline was doing):

| | before | after |
|---|---|---|
| full scan, no early exit | 2,799 ms | **935 ms** |
| + decisive early exit | — | 565 ms |
| + unmarked-first ordering | 646 ms | **225 ms** |

**~2.8 s → ~0.23 s end to end**, and every configuration named the same member
on all ten sampled scans.

### Two things the build needed

`build.sh` word-split its source lists, so a checkout under a path containing a
space (any Windows home directory) handed `emcc` half a directory name. Fixed
with arrays.

It also assumed the bridge's `setup.sh` had run, because two NBIS headers are
generated from `.src` templates. The wasm build needs neither the native
binaries nor Linux — only those headers — so it now generates them itself. A
bare clone used to fail with `'an2k.h' file not found`, which is a confusing way
to say "a prerequisite script has not run".

And `build.sh` now copies the result to `public/nbis/`. There is one artifact on
purpose; a rebuild that forgot the copy would leave the deployed matcher stale,
and the symptom is nothing at all — the old build works, just slowly.

## `shepherd` — a read-everything, write-nothing account — 2026-08-23

A fifth label. Sees the whole church, especially the people's group tabs;
changes nothing anywhere.

### Why not a flag on `leader`

They differ in **both** directions, so neither is a subset of the other:

| | sees | may change |
|---|---|---|
| `leader` | only the groups naming them as head | members inside those groups |
| `shepherd` | the whole church | nothing |

### Enforced by absence, not by a deny-list

`shepherd` was added to **GET handlers only** — 20 of them. Every mutating route
refuses it without naming it, and a POST written next year is shepherd-proof the
moment it exists, because the default is refusal. There is no list of forbidden
actions to fall out of date.

Withheld on purpose, because they are not congregation data: raw fingerprint
templates, the SMS log and balance, the kiosk provisioning pack, and the leader
account list.

Only `/sms` and `/kiosk` are closed as PAGES, for a reason no gate fixes: one
spends the church's money and the other is an appliance that writes attendance.

### One real trap this surfaced

**`!isAdmin` had quietly come to mean "a head".** Three group pages used it to
render leader-only write UI — the Assign tab, the "Register a member" button,
the claim form — so a read-only account would have been handed controls that
403. Those now test `canWrite` (admin OR leader), and `isAdmin` is kept for
admin-only controls. `OpenSessionBar` had no role test at all and offered
Pause / End / Resume to anyone who could see it.

### Verified — 43 checks against the live project

`shepherd@megachurch.local` created via `npm run seed:users`.

- **18 reads at 200**, including a constituency roster in full (28 members), a
  bacenta roster (8), one member in detail, that member's attendance history,
  and an unscoped whole-church `.xlsx` export.
- `my-groups` returns **4 constituencies and 12 bacentas** — the whole church,
  where a leader gets only what they head. That contrast is the role.
- **16 writes at 403**: register / edit / delete a member, upload a photo,
  create / rename / delete a constituency, assign members, create a bacenta, a
  category, a meeting, activate a session, mark somebody present, enrol a
  fingerprint, send an SMS, create a leader account.
- **5 out-of-scope reads at 403**: fingerprint templates, SMS log, SMS balance,
  kiosk pack, leader list.

### Not done: the browser pass

A real service (Second Service) was live, and the browser on this machine held a
working admin session on the dev server. Signing it out to check the read-only
screens is exactly the interference to avoid mid-service, so the UI was left
untested in a browser. The API boundary is proven; what is unverified is purely
cosmetic — whether the gated buttons are absent rather than merely refusing.
Worth ten minutes with the shepherd login once nothing is running.

### Side effect worth knowing

`npm run seed:users` also recreated `leader@megachurch.local`, which had been
deleted during earlier verification. That is the account `SEED_LEADER_EMAIL`
names, so `npm run e2e:groups` can now find its leader again — one of the two
stale credentials flagged above is fixed. `SEED_ADMIN_PASSWORD` is still wrong.

### `/services` and `/meetings` opened to shepherds — same day

Initially scoped out because they are action consoles and half-gating a dozen
buttons is how one gets missed. The church asked for them, so they were gated
properly instead:

| Page | What a shepherd sees | What is hidden |
|---|---|---|
| `/services` | which session is open or paused, present/expected counts, every service and meeting card | Activate, Pause, Resume, End, and the "end X first" hints, which only mean something to somebody who has buttons |
| `/meetings` | the list, the open-session bar | Create a meeting |
| `/meetings/[id]` | the meeting, its authorised roster, its past sessions | Activate/End, Save changes, Archive, Delete |
| `/meetings/new` | — | redirects to `/meetings` |

`MemberChecklist` gained a `readOnly` mode. A checkbox that still ticks with no
Save button is a lie: it looks like an edit and is silently discarded on
navigation. Read-only disables the inputs and drops the bulk select control.

`/meetings/new` redirects rather than being excluded by the proxy, because a
path prefix cannot express "this path but not that child". `POST /api/meetings`
is what actually refuses them; the redirect is so nobody fills in a form that
cannot be submitted.

### Verified — 17 more checks, against a LIVE service

Second Service was open at the time, which made the write checks worth more
than usual. The session-mutating probes were aimed at a **closed** occurrence on
purpose: if the role gate had been broken they would have failed on the state
check instead of pausing a service that was actually running.

- reads at 200: the meetings list, a meeting in detail with its roster, that
  meeting's past sessions, live attendance stats, and the open session
- writes at 403: create / edit roster / archive / delete a meeting, activate,
  **pause, resume and end** a session
- and the running session was confirmed **untouched** afterwards

## Nothing ever invited anyone to install the app — 2026-08-27

Reported as "is this even a PWA?", which is the right question to ask of an app
that never mentions installation. It has been one since Plan 2 — manifest,
service worker, maskable icons, iOS meta tags, all of it verified serving 200
unauthenticated in production. What was missing is that **nothing said so.**

On Android the invitation lives in Chrome's ⋮ menu. On iOS Safari there is no
prompt at all, ever — Share → Add to Home Screen — and the one place this app
explained that was the push banner on `/birthdays`, which a person sees only if
they had already gone looking for notifications. Installability nobody is told
about is indistinguishable from no installability.

### The race that makes this a two-file change

`beforeinstallprompt` fires **once, early**. On a returning visitor whose
engagement criteria are already met, it fires during page load — before React
hydrates. A listener attached in a component effect misses it, and the failure
is silent in the worst way: no error, no warning, just an Install button that
never appears.

So the event is caught in `app/layout.tsx` by a `next/script`
`strategy="beforeInteractive"` shim, parked on `window.__mcInstallEvent`, and
announced as `mc:installable`. `components/install-prompt.tsx` reads the stash
on mount **and** subscribes to the announcement, so it cannot lose the race in
either direction.

This is not theoretical. Loading the production build at `127.0.0.1:3100` and
reading the stash before touching anything returned a **trusted** event —
Chrome had already fired it during load. An effect-attached listener on that
page would have found nothing.

### What renders, and what deliberately does not

| Browser | Offered |
|---|---|
| Chromium (Android, desktop) | a banner with a working **Install** button |
| iOS Safari, ordinary tab | the Share → Add to Home Screen instruction |
| Anything else (desktop Firefox, in-app webviews) | **nothing** |

The third row is the decision worth keeping. A banner describing a menu item
the browser does not have is worse than silence.

`preventDefault()` on the captured event suppresses Chrome's own mini-infobar,
which is the trade being made: the invitation appears inside the app, in the
app's language, rather than as browser furniture people swipe away unread.

Three more things it declines to do:

- **It never shows once installed.** `display-mode: standalone`, plus
  `navigator.standalone` because that is still what an iPhone reports. An
  installed app nagging you to install it teaches people to ignore every banner
  it will ever show.
- **A deferred prompt is single-use.** It is dropped after `prompt()` whatever
  the person chooses — re-offering a spent event is a button that does nothing.
- **Dismissal is remembered** in `localStorage`, and both the read and the
  write are wrapped: storage *throws* in a private window on some browsers
  rather than returning null. A device that cannot remember shows the banner
  again, which is a much smaller problem than a page that will not render.

iPadOS 13+ reports itself as a Macintosh, so the iOS test also treats a
touch-capable "Mac" as an iPad. Without that, the only device whose sole
install route is the Share sheet is told nothing.

### Verified

- `npx tsc --noEmit` clean; `npx vitest run` 234 passed, 4 skipped;
  `npm run build` compiles all routes.
- The capture shim is present in the **pre-hydration HTML** of `/login`, not
  merely in a hydrated bundle.
- In real Chrome against the production build: the genuine event was captured
  at load, `defaultPrevented` is true, the stash holds it, and `mc:installable`
  fires.

### Not done

The banner itself has not been **seen** in a browser: it renders inside the
signed-in app shell, and this machine holds no session against a local server.
The capture path either side of it is proven; what is unverified is cosmetic —
whether the banner looks right, not whether it appears.

And no phone has yet installed the app, which is still item 2 of "Not yet
done". That check is now two taps rather than a hunt through a browser menu,
which was the point.

## /sms did not fit a phone — 2026-08-27

Reported as "the messages page seems not to be mobile responsive", and it was
two separate faults stacked on the same screen. The first was visible by
reading: the member search box was a fixed `w-64` in a flex row with no
`flex-wrap`, beside two buttons that a `Button` marks `shrink-0`. That row
cannot fold and cannot shrink, so it overflowed.

The second was the one that mattered, and it survived fixing the first.

### An implicit grid column cannot be narrower than its widest card

Each tab's wrapper was a bare `<div className="grid gap-6">`. An implicit
column is sized `minmax(min-content, auto)`, so the column takes a floor from
the largest min-content among its items — and the item here is the member
picker, whose rows carry a full name beside a `+233…` number.

Measured in a 390px viewport against the live congregation (158 active
members): the card's min-content was **407px** inside a **343px** container, so
the track refused to shrink, the card stuck out of it, and the whole document
scrolled sideways by 33px. The `truncate` already on those rows never got a
chance to fire, because nothing ever told the row it was short of room.

Tailwind's `grid-cols-1` is `repeat(1, minmax(0, 1fr))`. The `0` is the entire
fix. Applied to all three tab wrappers and the two inner grids; above `sm`
nothing changes, which is exactly why this was invisible on the screen it was
built on.

### A long link in a message body is the same bug one level down

An SMS body is free text and frequently carries a URL, which has no break
opportunity. With the track capped the page no longer scrolls, but the
paragraph itself still spilled 20px past the card. `break-words` on the three
message-body paragraphs closes it.

Worth knowing for the next time: `overflow-wrap: break-word` does **not**
reduce an element's min-content size, so it cannot rescue a grid track on its
own — it was measured doing nothing at all until `grid-cols-1` was in place.
The two fixes are ordered, not alternatives.

### Verified

- `npx tsc --noEmit` clean; `npx vitest run` 234 passed, 4 skipped.
- Real Chrome against `npm run dev` and the live project, the page rendered in
  a 390px frame so the `sm:` breakpoint actually applies: all three tabs report
  **zero** elements overflowing the viewport and `scrollWidth` 375 ≤ 390. Same
  at 320px. Before the fix, the Send tab measured 423.
- A long name now ellipses (*"Stanley Uriel Kwadwo Safo Ase…"*) instead of
  widening the card.
- A simulated receipt link in a template body and in a sent message: no page
  scroll, no spill past the card.
- At 1100px the select row is still two 464px columns and the picker header is
  still one horizontal row — the desktop layout is untouched.

### Left alone

Four bare `grid gap-*` wrappers remain elsewhere (`/bacentas`,
`/constituencies`, `template-editor`). All four are forms of fields rather than
lists of member-shaped rows, so none of them has a 407px item today. They are
the same hazard waiting for a long enough constituency name.

## Filtering the registry by service — 2026-08-27

`/members` could be narrowed by status, enrolment and constituency, but not by
which service somebody actually comes to — so "everyone at First Service"
meant reading 158 rows and picking out the 63. The filter is now a fifth
control beside the others.

It goes to the SERVER, like `constituency` and unlike the "no constituency
yet" case: `home_service` is a required enum with no null, so there is nothing
to fix up in memory afterwards.

**It filters the REGISTRY and nothing else.** `home_service` is where a member
usually sits; attendance is never gated by it, and anyone active may be marked
present at either service (PRD §2.1). Nothing on the attendance path reads
this parameter.

An unrecognised value is dropped and the caller gets the whole registry, the
same way `status` already behaves — measured, not assumed: `service=third`,
`service=` and `service=FIRST` each return all 158. A filter nobody can spell
should not be able to empty the page.

### Two things fixed on the way past

- The empty state tested `search || status || enrolment` and had never been
  told about `constituency`. Filtering to a constituency nobody is in yet
  therefore said **"No members yet"** and offered "Register a member", which is
  the opposite of what is wrong. It is one `filtered` flag now, so the next
  filter added cannot be forgotten in the same place.
- The filter row was a bare `grid` — one of the four wrappers the `/sms` fix
  listed under "Left alone". It is `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`
  now, five controls at three across.

### Verified

- `npx tsc --noEmit` clean; `npx vitest run` 234 passed, 4 skipped.
- Real Chrome against `npm run dev` and the live project: picking **First
  Service** fires exactly one request carrying `service=first`, returns **63
  members**, and every row on screen reads "First Service". Second Service
  returns 95. 63 + 95 = 158, the whole registry.
- Read back through `listMembers` directly against Cloud: the same 63/95/158,
  and every returned row really carries the service asked for.
- **First Service + Inactive only** is empty, and the page says "No members
  match those filters" rather than "No members yet".
- Every control in the filter row measures a min-content of 47px or less
  (the search box, 33px), against the ~343px a phone card leaves — so no
  item can put a floor under the track the way the `/sms` picker did.
  Confirmed afterwards in a real 390px frame (see the entry below for how):
  `/members` reports a document 375px wide with nothing escaping the viewport.

### Applied to the live project

`npm run setup:appwrite` created `by_home_service` and reported **indexes
created 1, existing 42**. A second run reported **created 0, existing 43** —
idempotency confirmed, not assumed. The index reads back `available`, and
`npm run verify:appwrite` passes every check afterwards, including all eight
unique indexes, both buckets and the 158-member registry.

The index is a speed matter and not a correctness one: Appwrite Cloud 1.9.6
answered the query without it, which was checked against the live project
before relying on it. What it buys is that a registry of three thousand is not
a table scan on every change of the filter. Filtered read after the index:
63 members in 286 ms.

## A hydration error on every page — 2026-08-27

The install capture added with the install-invitation work was written as a
direct child of `<html>`:

    <html>
      <Script id="install-capture" strategy="beforeInteractive">
      <body>

A `<script>` is not a legal child of `<html>`. The parser hoisted it into
`<head>`, React then compared the DOM against the tree it had rendered, and
every page of the app logged:

    In HTML, <script> cannot be a child of <html>.
    This will cause a hydration error.

It has been there since the feature shipped, on every route, and was found by
reading the console on an unrelated browser pass.

### The fix is where it is written, not how it loads

The script now sits last inside `<body>`, which is where Next's own
`beforeInteractive` example puts it. **Position in the tree was never what made
it early** — the strategy is. Next emits such a script into the initial HTML
and runs it before any Next module regardless of where it is written.

That was checked rather than assumed, because getting it wrong would silently
put the listener back after `beforeinstallprompt` had already fired — the
exact bug the capture exists to prevent. The served HTML was diffed either side
of the change: **both** emit it through the same `(self.__next_s=...).push(...)`
queue inside `<body>`, so the delivery mechanism is untouched and only the
offset within the body moved. At runtime the script is in `<head>` and
`'__mcInstallEvent' in window` is true before anything else runs.

### Verified

- `npx tsc --noEmit` clean; `npx vitest run` 234 passed, 4 skipped;
  `npm run build` compiled.
- Real Chrome, fresh navigation with console capture running: **no console
  messages at all** on `/` and `/members`. The dev overlay badge, which read
  **3 Issues**, is now clean.
- The install invitation still renders and the capture still executes.

## A long name took the page sideways, and `grid-cols-1` was not the fix — 2026-08-27

The /sms entry above left four bare `grid gap-*` wrappers alone and called them
"the same hazard waiting for a long enough constituency name". That was half
right. The hazard is real. The predicted fix was wrong, and it took measuring
to find out.

### Getting a real 390px viewport

The window on this machine would not resize below 1280 — Chrome ignores bounds
changes while a window is maximized, which is why the earlier registry work
fell back to measuring intrinsic widths. An **iframe** solves it properly: CSS
media queries inside one respond to the iframe's width, so a 390px iframe
pointed at a route is a genuine phone viewport, on the same origin and
therefore already signed in.

Swept that way, every page passes as it stands today: `/`, `/members`,
`/constituencies`, `/bacentas`, `/birthdays`, `/monitor`, `/reports`,
`/services`, `/meetings`, `/sms`, `/my-groups`, `/setup`, `/members/new`, and
the four detail pages — including the member with the longest name in the
church — all report a document no wider than the viewport.

### What breaks it

Free text from the database with no space in it. A 96-character name is what
the schema allows (`ensureStringAttribute(..., 'name', 96, ...)`), and at
390px:

| surface | document width |
|---|---|
| `PageHeader` `<h1>` (every detail page) | **1497px** |
| `/services` meeting card | **1175px** |
| `/my-groups` group tile | **1075px** |
| `/bacentas` bacenta card | **1043px** |

The bacenta card starts scrolling the page at **34** unbroken characters.
Hyphens do not count — they are break opportunities, so
"Living-Waters-Bacenta-Northern-Extension" is safe at 39 characters while 34
`B`s are not. A URL in a description is the realistic vector: one took
`/bacentas` to 535px.

### Four candidates, measured on the same card

| | result |
|---|---|
| as shipped | 1043px |
| `grid-cols-1` | 1023px — **no** |
| `break-words` (`overflow-wrap: break-word`) | 1043px — **no** |
| `truncate` on the paragraph | 1043px — **no** |
| `break-all` | 375px, but breaks ordinary words mid-letter |
| **`wrap-anywhere` (`overflow-wrap: anywhere`)** | **375px** |

`grid-cols-1` lets the TRACK shrink; nothing was making the card's own text
shrink with it, so the item overflowed its track instead of the track
overflowing the screen. 20px better, and still a page that scrolls sideways.
`break-words` permits a break but does not reduce min-content, which is the
same trap the /sms entry recorded one level up. `truncate` needs a parent that
has already been given a definite width, and here nothing had.

`overflow-wrap: anywhere` is the one that reduces min-content, and unlike
`break-all` it only breaks a word when there is no other option, so an ordinary
name is untouched.

Two of the four surfaces are **flex**, not grid — the page header and the
services card — so a grid-track fix could not have covered them at all.

### Verified

- `npx tsc --noEmit` clean; `npx vitest run` 234 passed, 4 skipped;
  `npm run build` compiled, 57 pages.
- Same stress, after: 1497 → 375, 1175 → 375, 1075 → 375,
  1043 → 375. Every one fits.
- At 1280px `/bacentas` is unchanged: three cards across, each name on one
  line, nothing broken mid-word.

## `CRON_SECRET` is set — confirmed from the outside — 2026-08-27

The open item said it "must be set" and nothing in the repo could say whether it
had been. It has been. Confirmed without the Vercel CLI or a dashboard login, by
two checks that do not depend on each other.

### 1. The route tells you whether a secret exists, without revealing it

`authoriseCronRun` answers a Bearer token in two distinguishable ways, and the
difference is exactly the question being asked:

| Response | Means |
|---|---|
| `403 No scheduler secret is configured…` | neither `CRON_SECRET` nor `NOTIFICATIONS_CRON_SECRET` is set |
| `401 Invalid scheduler token.` | one of them **is** set, and this was not it |

Against production, `GET` with a deliberately wrong token, as `vercel-cron/1.0`:

    GET /api/notifications/birthday-run  -> 401 {"ok":false,"error":"Invalid scheduler token."}
    GET /api/notifications/birthday-sms  -> 401 {"ok":false,"error":"Invalid scheduler token."}

A secret is configured. A wrong token cannot send anything — auth fails long
before a celebrant is looked up — so this probe is safe to repeat.

What it cannot tell you is **which** of the two variables holds it, and that
distinction is the whole point of the item: only `CRON_SECRET` is the one Vercel
itself sends.

### 2. The audit trail says which one

`triggered_by=scheduler` is written only after a bearer token has already
matched. `notification_runs`, read straight from Cloud:

| `run_date` | kind | `ran_at` (UTC) | status |
|---|---|---|---|
| 2026-08-27 | `birthday` | 06:21:06 | `sent` — 1 celebrant, 1 device, 1 failed |
| 2026-08-26 | `birthday-sms` | 08:19:32 | `sent` — 1 celebrant |
| 2026-08-25 | `birthday-sms` | 08:19:31 | `nobody_celebrating` |
| 2026-08-24 | `birthday` / `birthday-sms` | 06:29:37 / 08:19:31 | `nobody_celebrating` |
| 2026-08-23 | `birthday` / `birthday-sms` | 06:25:49 / 08:17:40 | `nobody_celebrating` |

Every row is `triggered_by=scheduler`, and every `ran_at` falls inside the
declared slot plus the Hobby plan's one-hour flexible window — `0 6 * * *`
landing at 06:21–06:29, `0 8 * * *` at 08:17–08:19. Vercel Cron attaches
`Authorization: Bearer <CRON_SECRET>` and reads no other variable name, so a
scheduled invocation that authenticated is `CRON_SECRET` being set and correct.

The residual, stated so nobody has to re-derive it: an *external* scheduler
carrying `NOTIFICATIONS_CRON_SECRET` on the same daily rhythm would look
identical from here. None is configured, in the repo or in the docs.

This also re-proves the 2026-08-22 fix from the other direction. Those runs are
`GET`s from `vercel-cron/1.0` reaching the handler — the verb bug is gone in the
only way that counts, which is unattended.

### The gap in the trail is the known one, not a new one

`birthday` has no row on 2026-08-25 or 2026-08-26, and 08-26 must have had a
celebrant, because 08-27's SMS run found one. That is `releaseRun` doing what
"Left as it was" already recorded: `birthday-run`'s `no_subscribers` and
send-failure exits delete the row so a retry can send, and therefore leave no
trace. The lock and the audit trail are the same row; separating them is the
change that would close this.

### What the same read turned up about push

Item 2 of "Not yet done" said no device had subscribed. Two have, both under the
admin account:

| device | `last_success_at` |
|---|---|
| Android phone | **2026-08-27T06:21:07Z** — stamped by the cron, not by hand |
| iPhone | **null** — never once delivered |

So push on Android is proven end to end by the scheduler itself, and the
`failed=1` on today's run is the iPhone.

`failed` is a count of **devices, not celebrants**, and it is specifically the
non-`404`/`410` bucket: a `410 Gone` is a dead subscription, gets pruned, and is
reported as `pruned`. The iPhone row survived, so Apple is refusing a
subscription it still considers live — which points at the VAPID credentials or
`VAPID_SUBJECT` rather than at an uninstalled app. Worth chasing separately;
it is the last thing standing between item 2 and done.

### How to re-check any of this

    curl -A "vercel-cron/1.0" -H "Authorization: Bearer wrong" \
      https://mega-church.vercel.app/api/notifications/birthday-run

401 means a secret is set; 403 means it has been removed. The runs themselves
read out of `notification_runs`, newest first — and a morning with no row is
only evidence after 09:00 UTC, because of the flexible window.

## The iPhone had never received a push, and the default was why — 2026-08-27

Found by the `CRON_SECRET` confirmation above: two devices subscribed, the
Android one stamped `last_success_at` by the cron itself, the iPhone `null`
since the day it subscribed. It was the `failed=1` on that morning's run.

### One variable, isolated

Reproduced against the church's real Apple endpoint, then narrowed. Same key
pair, same `ES256` header, same 12-hour `exp` (Apple caps at 24), same `aud`,
same encrypted payload, same device — the `sub` claim was the only thing that
moved:

| VAPID `sub` | Apple | FCM |
|---|---|---|
| `mailto:admin@megachurch.local` (what was deployed) | **403 BadJwtToken** | 201 |
| `https://mega-church.vercel.app` | **201** | — |
| `mailto:admin@mega-church.vercel.app` | **201** | — |

`mailto:` is not the problem and neither is the scheme. `.local` is reserved by
RFC 6762 and can never resolve to a mailbox, so it can never be what the `sub`
claim is *for* — an address a push service contacts about a misbehaving sender
(RFC 8292 §2.1). **Apple validates that. FCM ignores it entirely.**

### Why it was invisible

    lib/notifications/server.ts:57
    const subject = process.env.VAPID_SUBJECT || 'mailto:admin@megachurch.local'

The comment above it called the value a placeholder and said the church's real
address belonged there — so it was known to be provisional and looked harmless,
because the only devices anyone watched were Android and Android worked.

It is the `MNOTIFY_SENDER_ID` rule exactly, one service over: a plausible
default that one provider accepts and another silently rejects. And a `403` is
not a `404`/`410`, so `sendPush` correctly declines to prune — the iPhone stayed
on the list looking like a live device, which it was. Nothing anywhere was
wrong except the address, and nothing anywhere said so.

### The hardening

`vapidSubjectProblem()` in the new `lib/notifications/vapid.ts` — pure, 30 unit
tests. It refuses anything that is not a `mailto:`/`https:` URI, and any host
under a domain that cannot reach a person: `.local`, `.localhost`, `.test`,
`.invalid`, `.example`, `.internal`, and the RFC 2606 documentation domains.
It is careful about the false positive that would turn push off for an ordinary
church: `local.church.org` is fine, because "local" is a label there and not the
TLD.

**The default is gone rather than corrected.** A default that half the devices
reject is not safer than none — it is the same silent failure with nothing to
report it. Absent or unusable now means push is off and says which variable and
why, which is what `/api/push` already meant by "not configured on the server".
`vapidPublicKey()` checks it too, so nobody can tap Enable, see it succeed, and
join a list nothing is ever delivered from.

### Verified

- `npx tsc --noEmit` clean; `npx vitest run` **264 passed**, 4 skipped (was
  234); `npm run build` compiled.
- Through the **shipping send path**, not the pure function, against the real
  iPhone subscription:

| `VAPID_SUBJECT` | `vapidPublicKey()` | `sendToAll()` |
|---|---|---|
| `mailto:admin@megachurch.local` | `null` | refused, naming `.local` and the fix |
| absent | `null` | refused, naming the variable |
| `https://mega-church.vercel.app` | serves the key | **`sent: 1, failed: 0`** |

- **The iPhone's `last_success_at` is stamped for the first time since it
  subscribed** — `2026-08-27T07:44:15Z`, written by `sendToAll` itself.

### Still to do — the deploy order matters

**Done on 2026-08-30 — see "The variable was set all along, to the wrong
value" at the end of this file, which corrects the sentence below: the variable
already existed, holding the placeholder, so the code fix alone would have
turned push off for Android as well.**

**Set `VAPID_SUBJECT` in the Vercel project before deploying this**, to
`https://mega-church.vercel.app` or a `mailto:` on the church's real domain when
there is one. There is no longer a default, so a deploy that lands without it
turns push off for *both* platforms — loudly, on the birthdays page, which is
the intended behaviour but not a pleasant surprise. `.env.local` is already
corrected for local development.

Item 2 of "Not yet done" is then done on both platforms, and this is the first
time that claim has been true.

### The rule that came out of it

In `CLAUDE.md`, beside the `MNOTIFY_SENDER_ID` one it rhymes with: **verify push
on an Android and an iPhone, because each provider checks things the other does
not.** One healthy platform is not evidence about the other, and here it was
actively misleading for as long as it stood.

## The variable was set all along, to the wrong value — 2026-08-30

`VAPID_SUBJECT` is now `https://mega-church.vercel.app` on Production, Preview
and Development, and PR #30 is merged (`9c72511`). Push should be live on both
platforms in production for the first time.

The entry above, and the PR body, both said the deploy step was to *set* the
variable — that the code was falling back to
`|| 'mailto:admin@megachurch.local'` at `server.ts:57` and the fix was to
supply a real value where there had been none.

**That is not what production was doing.** The variable already existed, on all
three environments, explicitly set to `mailto:admin@megachurch.local` — the
same string as the fallback, entered by hand nine days earlier. The fallback in
the source was never reached in production. It was a second copy of the bug,
not the bug.

    $ vercel env ls
    VAPID_SUBJECT   mailto:admin@megac…   Config   Production, Preview, Development   9d ago

The diagnosis survives this intact: the subject Apple refused is the string it
was measured against, and every number in the table above still holds. What
changes is the **consequence of the code fix on its own**.

### Why this matters more than a footnote

Merging PR #30 without touching the environment would not have restored push to
the iPhone. It would have taken a failure that was silent and iOS-only and made
it loud and universal: `vapidSubjectProblem()` would have refused the stored
`.local` subject on every send, `vapidPublicKey()` would have returned `null`,
and the birthdays page would have reported push unconfigured — for Android too,
which had been working the whole time.

That is the designed behaviour and it is the right behaviour. But it means the
code change and the environment change are not two halves of one fix in the
order they were written down. **The environment change is the one that delivers
a notification.** The code change is what stops the next placeholder from
lasting eight months without anyone hearing about it.

The general form, since this is the second time this shape has appeared here
(the `MNOTIFY_SENDER_ID` rule is the first): removing a bad default fixes
nothing on a deployment that was overriding the default with the same bad
value. Check what is deployed before assuming the source is what is running.

### How it was set, and read back

Overwritten in place rather than removed and re-added, so no environment was
ever without a value:

    vercel env add VAPID_SUBJECT production,preview,development \
      --value "https://mega-church.vercel.app" --force --no-sensitive --yes

Read back with `vercel env pull` per environment, which decrypts to what the
runtime actually receives — `vercel env ls` shows the stored ciphertext for
this row and cannot confirm a value:

| environment | pulled value |
|---|---|
| production | `https://mega-church.vercel.app` |
| preview | `https://mega-church.vercel.app` |
| development | `https://mega-church.vercel.app` |

Preview and Development carry it too, so a branch deploy does not report push
unconfigured and read as a regression to whoever is testing it.

The pulled `.env` files hold the project's real secrets — `APPWRITE_API_KEY`,
both cron secrets, the mNotify key. Delete them after reading. `.env.local` was
not written to.

### The deployment

Merged 01:14:58Z; the Git integration built production three seconds later
(`mega-church-e7y5pl7e7`, Ready in 46s, aliased `git-main`). `GET /login` → 200.
The environment override landed **before** the merge, so this build has it.

### The deployed environment is verified — signed in, it does read out

The paragraph below originally said VAPID state "cannot be read from outside".
That is true of an ANONYMOUS probe and misleading about a signed-in one, which
answers the question outright.

`vapidPublicKey()` returns `null` whenever `vapidSubjectProblem()` rejects the
stored subject — the check added in #30 so nobody could tap Enable and join a
list nothing is delivered from. So a **non-null key from the deployed
function** is a direct statement that the deployment holds a usable subject.
Signed in against production:

    GET https://mega-church.vercel.app/api/push
    {"ok":true,"vapid_public_key":"BKjCLJMpp4wvS-aJDS9XPvdarss1jd3MCVKebd…"}

`/birthdays` agrees, in the state it renders: *"Off. Turn them on…"* — the
**you have not opted in** state, not **not configured on the server**. The two
are indistinguishable from the client, which is exactly why the key is served
from the route rather than baked into the bundle; here that distinction is what
carries the evidence.

Two things the same page confirmed in passing: its birthday list matches the
Appwrite read exactly (nobody tomorrow; Anthonia Okafor and Comfort Zowornu on
1 September), and the device list is still the same two `admin` subscriptions at
unchanged timestamps — installing the PWA does not subscribe anything, which is
why that page reports notifications off *on this device*.

So the chain is verified end to end except its last link. Environment: set and
read back per environment. Deployment: built after the override, and confirmed
serving a key rather than `null`. Delivery: not yet observed **as of that
writing** — closed the following morning, below.

### Proven — 2026-08-31

**Production push is now correct-by-OBSERVATION, on both providers.** The
`birthday` run of 2026-08-31 06:00 UTC — the first morning that could answer
this, because it is the first with celebrants since the `VAPID_SUBJECT` fix —
landed and stamped every device:

    notification_runs  2026-08-31 / birthday
      triggered_by  scheduler
      ran_at        2026-08-31T06:21:13.025Z
      celebrants    2          (Anthonia Okafor, Comfort Zowornu — 09-01)
      sent          2
      failed        0
      status        sent

| device | last_success_at | row updated |
|---|---|---|
| Android phone | 2026-08-31T06:21:13.982Z | 06:21:14.148Z |
| **iPhone** | **2026-08-31T06:21:13.982Z** | 06:21:14.488Z |

That is the read the paragraph above was waiting for, and it satisfies every
condition it set: the stamp ADVANCED off the old manual-test value, on a run row
that says `triggered_by=scheduler`, with `failed: 0`. Apple's push service
accepted the JWT, which is the one thing FCM could never have told us — an
unreachable `sub` is a `403 BadJwtToken` from Apple and a shrug from Google, and
that asymmetry is exactly how the placeholder survived for months.

One detail worth writing down rather than discovering later: the iPhone's
`push_subscriptions` row was CREATED `2026-08-30T12:36`, so it is a
re-subscription and not the row that carried the 08-27 manual-test stamp. The
proof is unaffected — the run reports `sent: 2, failed: 0` against exactly the
two rows that exist, so both were delivered to whatever their history.

`vapidSubjectProblem()` and the no-default rule stay. What was silently broken
is now silently working, and only the observation could tell the two apart.

## Members are addressed by their title in SMS — 2026-09-01

The church's leaders raised it: a bulk message that calls a Reverend by their
first name is not how the church addresses them. Pastors, Reverends, Lady
Reverends and the Mr./Mrs./Miss cases all needed to come out right in the same
broadcast, while everybody else stayed as they were.

### Nothing about SENDING had to change

`lib/sms/server.ts` already calls `render(template.body, member)` once per
recipient, not once per batch. A mixed broadcast was therefore a data problem
and a placeholder problem, and no part of the send path was touched.

### The decision that mattered: there is no `{{title}}`

Most of the congregation has none, so a bare title placeholder recreates the
exact failure this file already refuses:

    "Dear {{title}} {{last_name}},"  ->  "Dear  Serwaa,"   survivable
    "Dear {{title}},"                ->  "Dear ,"          not survivable

The second goes to hundreds of people, costs money and cannot be recalled. So
the title is never offered alone. Three COMPOSED placeholders were added, each
falling back to the bare name, which makes the broken message impossible to
write rather than merely discouraged:

|  | Reverend Ama Serwaa | Ama Serwaa |
|---|---|---|
| `{{salutation}}` | Reverend Serwaa | Ama |
| `{{title_first_name}}` | Reverend Ama | Ama |
| `{{titled_full_name}}` | Reverend Ama Serwaa | Ama Serwaa |

`{{salutation}}` drops to the FIRST name when untitled, not the surname — a
surname alone reads as a summons. Existing placeholders stay title-blind, so no
template already written changed meaning.

### The cost was real, and measured

A title is prepended to a name inside a message billed per 160-character part.
A 140-character body is **1 part** for an untitled member and **2 parts** for
`Lady Reverend` — asserted in a test, not estimated. The template editor now
prices `longestTitle()` rather than its preview sample, the same "quote high"
posture `isUnicode` already takes.

### A latent hazard found on the way

`lib/sms/render.ts` contained a literal NUL inside `isUnicode`'s character
class — `/[^<NUL>-ÿ]/`, which renders as `/[^ -ÿ]/` in every editor and
terminal. **Git classified the whole file as binary**, so every diff of the code
that decides what the congregation receives showed `Bin 5900 -> 8880 bytes` and
was never reviewable. It predates this change; it is now written ` `, which
is the same regex and is text.

### Applied to the live project

`npm run setup:appwrite` — `attributes created 1` (`members.title`), everything
else existing. A second run reports `created 0` across the board, so idempotency
is confirmed rather than assumed, and `npm run verify:appwrite` passes every
check with 123 attributes.

### Verified

- `npx tsc --noEmit` — clean.
- `npx vitest run` — **365 passed**, 4 skipped (was 354). 11 new, weighted at
  the untitled fallback, since that is the case that reaches most of the
  congregation.
- `npm run build` — compiles.

### Not verified

No browser pass on the title picker, and no live send with a titled member. The
renderer is pure and unit-tested so the wording is proven; what is unproven is
the form wiring and what mNotify actually delivers.

## Constituency heads may now delete — 2026-08-31

The church asked for heads to create, edit and delete members. Two of the three
already worked: `POST /api/members` and `PATCH /api/members/[id]` have been
`requireRole(['admin', 'leader'])` since Plan 3. What was missing was DELETE,
and three fields the edit refused.

### The line is drawn at the CONSTITUENCY, and per field

Not at "is a head". Every head who can open a member still corrects an ordinary
detail; four writes belong to the head of the member's OWN constituency:

| | any head | constituency head |
|---|---|---|
| name, numbers, address, birthday, carer, photo | yes | yes |
| `status` | no | yes |
| `sms_template_id` | no | yes |
| `bacenta_id` (move) | no | yes, within their own constituency |
| **delete outright** | no | yes |

A basonta head marking somebody `inactive` would remove them from the matcher's
gallery CHURCH-WIDE on the strength of running one serving group. So
`runsTheirConstituency` is a separate test from `inScope` inside
`headEditScope()`, and collapsing the two is the bug this shape exists to
prevent.

### What a head's delete actually costs

The same cascade an admin's is — `biometric_templates`, `meeting_members`,
`basonta_members`, `sms_messages` and **`attendance_records`**, plus
`releaseCharges`. No undo, and nothing afterwards reports the rows existed. The
confirm dialog names all of it and points at Inactive, which is a real
alternative now that the same head can set it.

`headDeleteScope()` takes ONLY `{ constituencies }`. The signature is the
enforcement: the argument cannot express a bacenta head, so no later edit widens
it by accident, and there is a test that says so. An UNASSIGNED member is
refused to every head — nobody heads "unassigned", and an empty field read as a
wildcard is how a record with no owner gets deleted by whoever finds it first.

### Two reads had to open, and exactly two

`GET /api/bacentas` (narrowed server-side to places inside constituencies they
head — a picker offering a neighbour's bacenta is a picker offering a 403) and
`GET /api/sms/templates`. The second is the unavoidable cost of letting a head
choose a birthday message: picking from a list of ids nobody can read is not
picking. **`POST /api/sms/send` still refuses a leader** — `canSendSmsCategory`
has no `leader` entry.

`assignableBacentas` on `headEditScope()` is optional and defaults to NONE, so a
caller that forgets it refuses every move rather than permitting every one.
There is a test for that default specifically, because it is the direction this
has to fail in.

### Verified

- `npx tsc --noEmit` — clean.
- `npx vitest run` — **354 passed**, 4 skipped (was 342): 12 new, covering both
  halves of every newly-opened field, the destination check, the forgotten-
  parameter default, and all five `headDeleteScope` cases.
- `npm run build` — compiles.

### Not verified

**No browser pass, and no live-API proof.** The `elevated` form controls and the
head's Danger zone are type-checked and built, not clicked; `scripts/e2e-groups.mjs`
has no coverage of any of this and cannot run anyway until the stale
`SEED_ADMIN_*` pair is fixed. The enforcement is server-side and unit-tested, so
what is unproven is the wiring, not the rule — but a Delete button is the last
place to assume wiring works.

## Bacenta and Basonta, split — 2026-08-30

`bacentas` was one collection doing two unrelated jobs, and the church could not
use its own vocabulary in its own system as a result.

| what was in there | what it actually is |
|---|---|
| Biazo, Living Waters, Fresh Oil (under Choir), Technical Team, Ushers, Media, Dancing Stars | **basontas** — groups people SERVE in |
| Anloga, Susuankyi, Oforikrom, Bomso, Asokwa | **bacentas** — places people STAY, under a constituency |

Five PRs: basonta (#33), member numbers (#34), BENMP (#35), treasurer (#36),
bacenta repurposed (#37), and the migration.

### The data answered the design question before the code was written

The plan originally said "move all 12 to basonta and start bacenta empty". A
probe of the live project said otherwise, and the split became 7/5:

- **no member was in more than one location bacenta** — 0 of 28. That is what
  made `members.bacenta_id` safe as a FIELD; a join would have been modelling a
  state the church does not have.
- all 28 were in **Alos Constituency**, unanimously, so the five places had an
  obvious home.
- 64 of 157 members have no constituency at all, which caps how much of the
  congregation the new structure covers on day one.

Asking the data first is what stopped this being a migration that lost the
second half of somebody's memberships.

### The asymmetry is the whole design

| | shape | assigning |
|---|---|---|
| constituency | field | MOVES |
| bacenta | field | MOVES |
| basonta | join | ADDS, never removes |

A join for a place would permit two homes; a field for a serving group would
silently drop the second choir. `assignBacenta` and `applyBasontaMembership`
look almost identical and mean opposite things — which is exactly why the church
needed two words for them.

### Members looking after members

`members.care_of_member_id`, refused by a pure `careAssignmentProblem()`: not
self, active only, same bacenta, and **no cycles**. Chains are fine (A under B
under C); a cycle is not a shape anybody can be at the top of.

The carer needs **no account**. Being named grants nothing, which is why this is
a field on a member and not a role.

The cycle walk keeps a `seen` set and it is load-bearing, not defensive: the
stored data may already contain a loop, and without it the walk never terminates
and the request HANGS rather than being refused. There is a test for exactly
that, and it is the one worth keeping if the file is ever trimmed.

### Three bugs the tests and types caught before they shipped

1. **A Remove button that would have added people.** `useAssignBacenta` still
   sent `add`/`remove` while the new route understood `assign`/`unassign` and
   defaulted anything unrecognised to `assign`. Pressing Remove would have added
   everybody named to the bacenta they were being taken out of. The route now
   refuses an unknown mode by name.

2. **A shorthand that fed every category the whole list.** `buildBasontaTree`
   delegated to `buildBacentaTree` and returned `{ category, basontas }` — where
   `basontas` resolved to the *function's own parameter*, not the destructured
   list. It type-checks perfectly; both are the same type. Only asserting that
   Choir contains exactly Biazo and Living Waters found it.

3. **A reservation that raised the floor.** In the member-number allocator,
   counting reserved numbers towards the maximum meant that with `2026005` held
   and nothing issued, the church's FIRST member would have been handed
   `2026006`.

A fourth was caught by the type checker rather than a test: `Record<UserLabel,
string>` on the login page's landing map refused to compile the moment
`treasurer` existed, which is the only reason that map and `proxy.ts` still
agree.

### One self-inflicted scare worth recording

The first splice of `lib/groups/server.ts` used `bacentaDocTo` as its start
marker — which sits in the MAPPERS section near the top, not at the bacenta CRUD
— and swallowed the constituency and category sections with it. 1132 lines
became 827.

Caught by diffing the export list against `HEAD` rather than by trusting that
the edit had done what it said. Restored from git, redone against the section
comments (`// --- bacentas ---` to `// --- basonta categories ---`). **Splice on
section boundaries, not on the first occurrence of an identifier** — the same
name appears in the mapper block and in the section it belongs to.

### The migration — finished

`scripts/migrate-basonta.ts`, run against the live project on 2026-08-30 —
first `--apply --copy-only` for steps 1-4, then `--apply` for the rest once the
copy had been checked by hand. Steps 1-4:

    1  Choir            -> basonta_categories     copied
    2  7 serving groups -> basontas               copied
    3  38 memberships   -> basonta_members        copied
    4  VERIFY                                     all rows resolve

Confirmed independently of the script's own report, by reading Cloud back:

| group | before | after |
|---|---|---|
| Biazo | 8 | 8 |
| Living Waters | 6 | 6 |
| Fresh Oil | 11 | 11 |
| Technical Team | 3 | 3 |
| Ushers | 3 | 3 |
| Media | 2 | 2 |
| Dancing Stars | 5 | 5 |

Not just the counts — the same PEOPLE in the same groups, compared as
(group, member) pairs. 3 categorised, 4 standalone, as expected.

**The old data is untouched**: 12 bacentas, 66 `bacenta_members` rows, 0 members
with a `bacenta_id`, 0 bacentas with a `constituency_id`. Re-running reports
"already there" for every row and copies nothing.

### Steps 5-7, run separately and on purpose

The copy was left to sit while it was checked, and the destructive half run as
its own decision afterwards. That is what `--copy-only` is for, and it is how a
migration against a live congregation ought to go.

    5  filed the 5 places into Alos Constituency
    6  gave 28 members their bacenta_id
    7  removed the 7 copied groups, then all 66 bacenta_members rows

Read back from Cloud afterwards, independently of what the script said about
itself:

| bacenta | constituency | members |
|---|---|---|
| Anloga Bacenta | Alos | 16 |
| Susuankyi Bacenta | Alos | 6 |
| Oforikrom Bacenta | Alos | 5 |
| Bomso Bacenta | Alos | 1 |
| Asokwa Bacenta | Alos | 0 |

| basonta | members |
|---|---|
| Fresh Oil | 11 |
| Biazo | 8 |
| Living Waters | 6 |
| Dancing Stars | 5 |
| Technical Team | 3 |
| Ushers | 3 |
| Media | 2 |

Every count is the one it was before the migration. 28 members carry a
`bacenta_id` and all 28 point at a bacenta that exists; 38 of 38
`basonta_members` rows resolve to a real member and a real group; 0
`bacenta_members` rows remain; 0 bacentas are unfiled.

A second `--apply` reports "already filed" for every place, gives 0 members a
bacenta and removes 0 rows — idempotent after the fact, not merely by design.
`npm run verify:appwrite` passes every check, and now says **"every bacenta is
filed into a constituency"** where two days ago it listed twelve that were not.

### One thing the migration deliberately did NOT do

`bacenta_members` is empty and nothing reads it; `bacenta_categories` still
holds its single "Choir" row and nothing reads that either. **Neither
collection is dropped.** Dropping a collection is not something a migration
should do behind an admin's back, and an empty collection costs nothing.

Removing them — and the `/api/bacenta-categories` routes that still serve the
dead one — is a deliberate follow-up, not a loose end to be tidied by whoever
notices first. CLAUDE.md previously said the migration "retired" both; that
overstated what the script does and has been corrected.

### Not verified

No browser pass on any of the five PRs. The local Chrome profile is signed in to
production, not to a dev server, and passwords are not something this account
types — so `/basontas`, the rebuilt `/bacentas`, the care table, the BENMP tick
box and the treasurer's refusal are type-checked, unit-tested and built, but
have not been clicked. `npm run e2e` is the harness that would close it.
