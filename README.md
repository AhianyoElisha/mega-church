# The Mega Church — Biometric Attendance

Fingerprint attendance for a church running two Sunday services plus an
open-ended set of smaller meetings.

- `PRD.md` — the domain: data shapes, session lifecycle, module scope.
- `CLAUDE.md` — the rules that hold the codebase together.
- `PROGRESS.md` — what is verified and what is still outstanding.
- `tools/PROVENANCE.md` — where the fingerprint stack came from.

## Where this came from

Two existing codebases, grafted:

| From | What was taken |
|---|---|
| **SEMP** (KNUST exam platform) | the whole biometric + attendance stack: Futronic FS81 capture, NBIS matching, the matcher seam, the kiosk state machine, the offline queue, the Windows provisioning pack |
| **PickLT** (booking platform) | the UI: component library, icon sets, layout language, typography — copied with its APIs intact, then re-themed white / yellow / black |

When a question is about **how something behaves**, the answer traces back to
SEMP. When it is about **how something looks**, it traces back to PickLT.

## Getting started

```bash
npm install
cp .env.local.example .env.local      # fill in endpoint, project id, API key
npm run setup:appwrite                # idempotent; safe to re-run
npm run seed:users                    # creates admin / usher / kiosk accounts
npm run dev
```

The backend is **Appwrite Cloud** (`fra` region), project `mega-church`. A
self-hosted instance works identically — only the endpoint changes.

`APPWRITE_API_KEY` is a project API key, not your CLI login. Create one in the
console under **Overview → Integrations → API keys**, or with
`appwrite project create-key` (the scopes are listed in `.env.local.example`).

## The two rules worth knowing before you change anything

**One session is open at a time, globally.** A service or a meeting, never two
of anything. This is what makes "First Service must be ended before Second
Service can be activated" true, and it is enforced in
`lib/attendance/server.ts::activateOccurrence` — not by the greyed-out button
on the Services page, which is only a courtesy.

**An unauthorised member is still identified.** For a restricted meeting,
identification runs against the roster first and then against every active
member, so somebody who is not on the list is recognised by name and told why
they were refused. "Fingerprint not recognised" there would be both wrong and
the least useful thing the screen can say.

## Constituencies and bacentas

Two ways of grouping members, and they are shaped differently on purpose.

**A constituency is where a member lives.** Exactly one each, so it is a field
on the member. Assigning somebody to a constituency therefore *moves* them out
of the one they were in — the bulk assigner warns before it does.

**A bacenta is the work group a member serves in.** Zero or many each, so it is
a join collection. A chorister can sing in two choirs and run the sound desk at
the same time; adding them to one bacenta takes nothing away from another.

Bacentas come in two shapes and both are first-class:

- a **category** such as *Choir* holding *Biazo*, *Living Waters* and
  *Fresh Oil* — nobody is a member of "Choir", they are a member of one of the
  choirs;
- a **standalone** group such as *Technical Team*, which takes members
  directly. Create one by leaving the category blank. There is no third
  setting to get wrong: having no category **is** being standalone.

Both kinds of group have a bulk assigner — tick many already-registered members
and file them in one action, with a *No constituency yet* filter for working
through the backlog of people registered before any of this existed.

## Group heads

A head signs in and sees **only** their own group's members, read-only: details,
birthdays, and how often each has attended.

Heads use the single `leader` label, never two. The same person frequently
heads a constituency *and* a bacenta, and the label grants nothing by itself —
what they can see is resolved per request from which groups name them as head.
Someone who heads both gets one login and a switch between the two views on
`/my-groups`.

To appoint one: create an account with the `leader` label in the Appwrite
console, then pick them from the **Head** dropdown on the constituency or
bacenta. That dropdown only offers `leader` accounts, and the server refuses
any other — a head who can sign in but is then bounced straight out is worse
than no head at all.

## Birthdays and notifications

The church is told about a birthday **the day before**, not on the day: the
flyer and the shoutout have to be made in advance. The dashboard card, the
`/birthdays` page and the push notification all read one constant
(`BIRTHDAY_LEAD_DAYS`) and one function, so they can never name different
people.

The `celebrations` account is for the team that makes the flyers. It reaches
`/birthdays` and nothing else.

### Turning push on

1. Generate a key pair once per deployment:

   ```bash
   npx web-push generate-vapid-keys
   ```

   Put them in `.env.local` as `NEXT_PUBLIC_VAPID_PUBLIC_KEY` and
   `VAPID_PRIVATE_KEY`. Rotating them forces every subscribed device to opt in
   again, so keep the pair.

2. Each team member opens `/birthdays` on their own phone and presses
   **Turn on**. Push is per-device: the same person must do it again on the
   office desktop.

   **On iPhone and iPad the app must first be added to the Home Screen** and
   opened from there. Safari does not deliver push to an ordinary tab. The page
   says so before anyone tries.

3. Wire a scheduler to call the run once each morning, Accra time:

   ```bash
   curl -X POST https://your-host/api/notifications/birthday-run \
        -H "Authorization: Bearer $NOTIFICATIONS_CRON_SECRET"
   ```

   An Appwrite Function on a cron trigger, cron-job.org, or a Windows scheduled
   task all work. **Calling it more than once a day is harmless** — the run is
   claimed by a unique row per (date, kind), so a retry returns `already_sent`
   and nobody is notified twice.

Until a scheduler is wired, an admin can press **Send notification now** on
`/birthdays`. That path is the same run and is equally idempotent.

## Fingerprint hardware

A Futronic FS81, driven one of two ways:

- **PC kiosk** — `tools/fingerprint-bridge/`, a loopback service on
  `127.0.0.1:7788` that owns the scanner and the NBIS binaries.
  `npm run bridge` in development; a Windows service in production.
- **Tablet kiosk** — the page drives the scanner itself over WebUSB and
  extracts minutiae with NBIS compiled to WebAssembly. Chrome on Android only;
  Firefox and iOS Safari do not implement WebUSB.

Both produce the identical `xyt:` template, so a print enrolled on a PC
verifies on a tablet and vice versa.

Matching happens on the **server** either way — in-process via
`public/nbis/`, or delegated to a local bridge when
`CHURCH_BIOMETRIC_MATCHER_URL` is set. A kiosk never decides who you are.

### Vendor binaries are not in this repository

`tools/fingerprint-bridge/native/` is gitignored for the compiled scan binary,
Futronic's `ftrScanAPI.dll`, the WHQL driver, and the NBIS executables. They
are licensed vendor artifacts and build outputs, not source. Recreate them
with:

```powershell
tools\fingerprint-bridge\native\setup.ps1     # Windows
```
```bash
tools/fingerprint-bridge/native/setup.sh      # Linux
```

`public/nbis/` **is** committed — that one is built from open-source NBIS by
`tools/nbis-wasm/build.sh`, and the server needs it to match.

## Provisioning a kiosk PC

```bash
npm run build:kiosk-pack     # bundles the bridge + binaries, publishes to Storage
```

An admin then downloads `/api/kiosk-pack` on the kiosk and runs `install.cmd`.
The pack is ~4 MB and carries no repository, no `node_modules`, and no Appwrite
key — the bridge collapses to a single ~15 KB bundle with no dependencies
beyond Node builtins.

## Commands

| | |
|---|---|
| `npm run dev` | development server |
| `npm run build` | production build |
| `npm test` | unit tests (vitest) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run bridge` | run the fingerprint bridge locally |
| `npm run setup:appwrite` | create/update the schema (idempotent) |
| `npm run verify:appwrite` | read the live project back and check what breaks quietly |
| `npm run seed:users` | create the role accounts (blank env pairs are skipped) |
| `npm run e2e` | full smoke — **opens a real session; never during a service** |
| `npm run e2e:groups` | groups / birthdays / push smoke — safe any time |
| `npm run build:brand` | regenerate every logo and PWA icon size |
| `npm run build:kiosk-pack` | build and publish the kiosk installer |
