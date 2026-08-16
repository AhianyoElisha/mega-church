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

1. **Wire the scheduler.** `POST /api/notifications/birthday-run` with
   `Authorization: Bearer $NOTIFICATIONS_CRON_SECRET` needs to be called once
   each morning (Accra time). An Appwrite Function on a cron trigger,
   cron-job.org, or a Windows scheduled task with `curl` all work. Until this
   is done the alert only goes out when an admin presses **Send notification
   now**. Calling it more than once a day is harmless.
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
