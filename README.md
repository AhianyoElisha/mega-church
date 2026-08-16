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
| `npm run seed:users` | create the three role accounts |
| `npm run build:kiosk-pack` | build and publish the kiosk installer |
