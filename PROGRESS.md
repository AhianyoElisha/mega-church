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

## Not yet done

These need people and hardware, not more code:

1. **`npm run seed:users`** — needs the `SEED_*` email/password pairs filled in
   in `.env.local`. Nothing can be signed into until this runs.
2. **End-to-end enrolment on hardware** — capture twelve real prints for one
   member and check them in at the kiosk. The pipeline is the one proven in
   SEMP, but it has not been run on a member of this congregation.
3. **Publish the kiosk pack.** `npm run build:kiosk-pack` works — it produced a
   4.2 MB zip, and the bundled bridge inside it was run standalone and reported
   `{"ok":true,"device":true,"scanBin":true,"nbis":true}` against the real
   scanner. Publishing it needs the Appwrite bucket to exist, so run it after
   step 1.
4. **Threshold calibration.** 33 is evidence-backed on a small corpus
   (`lib/biometrics/matching.ts`). Widen the corpus before trusting it against
   a large congregation — false-accept probability grows with gallery size.
