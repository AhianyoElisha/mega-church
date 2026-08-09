# Progress

Module status for the Mega Church Biometric Attendance System.
See `.agent/plans/1.foundation.md` for the phase breakdown.

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

## Not yet done

Needs people and hardware, not more code:

1. **End-to-end enrolment on hardware** — capture twelve real prints for one
   member and check them in at the kiosk. The pipeline is the one proven in
   SEMP, but it has not been run on a member of this congregation.
2. **Threshold calibration.** 33 is evidence-backed on a small corpus
   (`lib/biometrics/matching.ts`). Widen the corpus before trusting it against
   a large congregation — false-accept probability grows with gallery size.
