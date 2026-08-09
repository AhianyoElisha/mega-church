@AGENTS.md

# CLAUDE.md

**Mega Church Biometric Attendance System** — fingerprint attendance for a
church running two Sunday services plus an open-ended set of smaller meetings.

`PRD.md` is the source of truth for data shapes, collection schema, the session
lifecycle, and every module's scope. Read it before writing code.

## Lineage — this project is a graft of two others

| From | What was taken |
|---|---|
| `../semp` (KNUST exam platform) | the **entire biometric + attendance stack**: FS81 capture, NBIS pipeline, matcher seam, kiosk flow, offline queue, provisioning pack |
| `../PickLT` (booking platform) | the **UI**: component library, icon set, layout language, typography — copied, then re-themed |

When a question is about *how something behaves*, the answer is in semp.
When a question is about *how something looks*, the answer is in PickLT.

## Stack

- **Framework:** Next 16 (App Router, Turbopack) + React 19 + TypeScript 5.
  Flat root layout — `app/`, `lib/`, `components/`, `shared/`, `utils/`.
  `@/*` resolves to `./*`.
- **Styling:** Tailwind v4 `@theme`. Poppins via `next/font/google`.
- **UI kit:** `shared/` is PickLT's Catalyst-style library, copied with its
  APIs intact. `@headlessui/react`, `@heroicons/react`, `@hugeicons/react`,
  `clsx`, `framer-motion`.
- **Backend:** Appwrite, **self-hosted**. Databases, Auth (email/password +
  User Labels), Storage, Realtime. Never Appwrite Cloud.
- **SDKs:** `node-appwrite` (server) in Route Handlers and scripts;
  `appwrite` (client) in browser components for Realtime.
- **Data layer:** TanStack Query hooks in `lib/queries/*`.
- **Biometrics:** NBIS (`mindtct` + `bozorth3`), native on a PC kiosk via
  `tools/fingerprint-bridge/`, WebAssembly in the browser and in the Next
  server (`public/nbis/`).

## Colour

White, yellow, black. The `@theme` ramps in `styles/tailwind.css`:

- `--color-primary-*` — the yellow/gold ramp. `primary-500` `#F5B301` is the
  brand yellow; `primary-600` is the hover/pressed step.
- `--color-neutral-*` — a true-black ramp (`neutral-950` is `#000`), not
  Tailwind's blue-tinted default greys.
- Semantic colours (red for refusal, green for success) stay, because
  §2.4 forbids relying on colour alone but does not forbid using it.

Yellow on white fails contrast at small sizes. Yellow is for fills, accents and
large type; body text is black. Never yellow text on white below 18pt.

## Rules

- **Do not use Appwrite Cloud.** Every endpoint targets the self-hosted URL.
- **Read `PRD.md` before writing code.** Collection names, attribute shapes,
  the session lifecycle, and each module's success criteria are defined there.
- **Read `node_modules/next/dist/docs/` before writing Next.js code.**
- **`sessions` is never a collection name.** Appwrite reserves "session" for
  auth. The collections are `meetings`, `meeting_occurrences`,
  `meeting_members`, `attendance_records`.
- **One active occurrence, globally.** Enforced in
  `lib/attendance/server.ts::activateOccurrence`. A second activation while one
  is open is a 409, not a UI-hidden button.
- **Attendance is never gated by `home_service`.** Any active member may be
  marked at either service. Only `restricted` meetings gate, and only via
  `meeting_members`.
- **An unauthorised member must still be identified.** `not_authorised` names
  them; `no_match` does not. Never collapse the two — see PRD §2.3.
- **`null` from `BiometricService.match()` means exactly one thing:** the
  matcher ran and nobody matched. Every other failure throws
  `MatcherUnavailableError` and becomes a 503 the kiosk can explain.
- **Never store raw fingerprint images.** Templates only, `xyt:<base64>`.
- **`flipRows()` in `lib/biometrics/webusb.ts` is load-bearing.** Removing it
  makes every tablet stop recognising everyone. The comment explains why.
- **Bulk writes use `databases.createDocuments()`** (Appwrite bulk API). A loop
  of individual `createDocument` calls for a multi-doc write is a bug — the
  meeting roster save is up to a few thousand rows.
- **No SQL-style joins.** Appwrite has none. Cross-collection queries fetch
  each collection separately and join in-memory in the Route Handler.
  Parallelise with `Promise.all`.
- **Server vs client SDK split:** `node-appwrite` + API key in Route Handlers
  and scripts; `appwrite` client SDK in browser components. The API key must
  never reach a client bundle — no `NEXT_PUBLIC_` prefix on it, ever.
- **Centralise config in `lib/appwrite/config.ts`** — collection ids, bucket
  ids, database id as named exports. No magic strings.
- **RBAC via Appwrite User Labels** (`admin`, `usher`, `kiosk`), exactly one
  per user. Server-side enforcement is mandatory.
- **Cascades are manual.** Deleting a member means deleting their
  `biometric_templates`, `meeting_members` and `attendance_records` first.
- **Idempotent setup:** `scripts/setup-appwrite.ts` is the single source of
  truth for schema and must be safe to re-run. New attributes go there, not
  into the console by hand.
- **`listDocuments(...).total` is capped server-side** by
  `_APP_DATABASE_COUNT_LIMIT` on the Appwrite container. Code that needs an
  accurate total above the cap must paginate. "Are there any?" (≥1) checks may
  use `.total` directly.

## Required env vars

```
APPWRITE_ENDPOINT
APPWRITE_PROJECT_ID
APPWRITE_API_KEY                 # server only — never NEXT_PUBLIC_
NEXT_PUBLIC_APPWRITE_ENDPOINT
NEXT_PUBLIC_APPWRITE_PROJECT_ID
NEXT_PUBLIC_CHURCH_BRIDGE_URL    # optional, default http://127.0.0.1:7788
CHURCH_BIOMETRIC_MATCHER_URL     # optional — set on a PC kiosk running the bridge
CHURCH_BIOMETRIC_THRESHOLD       # optional, default 33
CHURCH_WASM_MATCHER              # optional, "0" disables the in-process matcher
```

The app must boot cleanly when the five required ones are present.

## Planning

- Plans live in `.agent/plans/`, named `{sequence}.{plan-name}.md`.
- Each task in a plan carries at least one validation test.
- Complexity marker at the top: ✅ Simple / ⚠️ Medium / 🔴 Complex.

## Development flow

1. **Plan** → `.agent/plans/`
2. **Build**
3. **Validate** — test and verify; drive the browser where applicable
4. **Iterate**

Check `PROGRESS.md` for module status and update it as you go.
