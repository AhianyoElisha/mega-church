@AGENTS.md

# CLAUDE.md

**The Mega Church Biometric Attendance System** — fingerprint attendance for a
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
- **Backend:** Appwrite **Cloud**, `fra` region, project `mega-church`.
  Databases, Auth (email/password + User Labels), Storage, Realtime.
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

- **This project runs on Appwrite Cloud.** Its sibling SEMP is self-hosted-only
  for KNUST/Oracle reasons; that constraint was carried over here by mistake in
  the first draft and does not apply. If a comment or doc still says
  "self-hosted only", it is stale — fix it.
- **Read `PRD.md` before writing code.** Collection names, attribute shapes,
  the session lifecycle, and each module's success criteria are defined there.
- **Read `node_modules/next/dist/docs/` before writing Next.js code.**
- **`sessions` is never a collection name.** Appwrite reserves "session" for
  auth. The collections are `meetings`, `meeting_occurrences`,
  `meeting_members`, `attendance_records`, `constituencies`,
  `bacenta_categories`, `bacentas`, `bacenta_members`, `push_subscriptions`,
  `notification_runs`, `sms_templates`, `sms_messages`.
- **Constituency is a FIELD; bacenta is a JOIN.** A member lives in exactly one
  constituency (`members.constituency_id`) and serves in zero or many bacentas
  (`bacenta_members`). The asymmetry is the design, not an inconsistency to
  tidy up: a join for constituency would permit two homes, and a field for
  bacenta would silently drop the second choir. PRD §1.7–1.9.
- **`bacentas.category_id === null` IS the standalone bacenta** ("Technical
  Team"). Never add an `is_standalone` boolean beside it — two fields encoding
  one fact are two fields that can disagree.
- **Bacenta names are unique per CATEGORY, not globally.** "Youth" under Choir
  and "Youth" under Ushers are two real groups. Enforced in
  `lib/groups/server.ts::bacentaNameTaken`, deliberately not by an index.
- **Group membership writes are DIFFS** (`add` / `remove` / `set`), never
  delete-all-then-insert — same reason as the meeting roster. `add` is what the
  bulk assigner sends; a `set` from a filtered view would remove everyone who
  happened to be off screen.
- **A PATCH that omits `bacenta_ids` must leave them alone.** `undefined` means
  "don't touch", `[]` means "clear". Collapsing the two removes somebody from
  their choir every time an admin corrects a phone number.
- **`leader` is ONE label covering both kinds of head.** The same person often
  heads a constituency and a bacenta, and two labels would mean two logins.
  The label grants nothing; scope comes from `leaderScope()` per request, and
  every group read goes through `canReadGroup()`.
- **A head writes in exactly FOUR places, and every one is inside their own
  group.** The exceptions are enumerated rather than described, because "mostly
  read-only" is not a rule anyone can check code against:

  1. claiming an UNASSIGNED member into their constituency
     (`POST /api/constituencies/[id]/members`, `onlyUnassigned`)
  2. registering a NEW member into it (`POST /api/members`)
  3. correcting an existing member's details (`PATCH /api/members/[id]`)
  4. setting a member's photo (`POST /api/members/[id]/photo`)

  Everything else — moving anyone between groups, marking anyone inactive,
  creating or deleting groups, deleting a member, and **all biometric
  enrolment** — stays admin-only. A head registers and corrects the person; an
  admin enrols the fingerprints, on the machine the scanner is plugged into.
- **REGISTERING is constituency-scoped; EDITING is group-scoped.** The two
  scopes differ on purpose. A bacenta head has no basis for saying where
  somebody LIVES, so `headRegistrationScope()` demands a constituency they
  head. Editing a member who already exists is different: `headEditScope()`
  admits anyone in a constituency **or** a bacenta they head — the same set
  their group page already shows them in full.
- **A head's bacenta ticks are MERGED, never written verbatim
  (`headBacentaMerge`).** A head is only ever shown the bacentas they head, so
  saving that list as the member's complete answer would remove them from every
  other one — a constituency head correcting a phone number would silently take
  somebody out of the choir. It is the `undefined`/`[]` hazard one level deeper,
  and the same bug wearing a different hat.
- **A head's refused field is refused BY NAME, never silently dropped.** A
  `PATCH` carrying `status` or `sms_template_id` is a 403 that says which one
  and why. Stripping it would return 200 and leave the head believing the edit
  landed. The one exception is `constituency_id` resent UNCHANGED: the shared
  form always sends it, and resending what is already stored is not a move.
- **A head's registration is narrowed by `headRegistrationScope()`, not by the
  form.** It is pure and unit-tested, and the route forces `status: 'active'`
  and `sms_template_id: null` afterwards rather than reading them from the
  request. `inactive` is what hides a member from the matcher, and the template
  picks which text the church pays to send — neither is a registration-desk
  decision, and a hidden form field is not what stops one being made.
- **A head who omits `constituency_id` on a registration is REFUSED, never
  defaulted to their first group** — the same rule as `/api/reports/export`,
  for the same reason. A guessed constituency is invisible afterwards: the
  member just appears in the wrong roster and nobody knows to look.
- **A leader with no groups is not an error.** Empty lists, with an
  explanation. A 403 there reads as a broken login.
- **Birthdays are shown the DAY BEFORE** — `BIRTHDAY_LEAD_DAYS`. The dashboard,
  the birthdays page and the push notification all read that constant and
  `celebrantsForNotification()`, so they cannot name different people. It is an
  exact-day filter, never a window. PRD §2.7.
- **There are TWO birthday jobs and they run on DIFFERENT days.**
  `birthday-run` pushes to the celebrations TEAM the day *before*
  (`BIRTHDAY_LEAD_DAYS`), because they have a flyer to make. `birthday-sms`
  texts the CELEBRANT *on* the day, because a birthday message that arrives a
  day early is wrong. Both call `celebrantsForNotification(members, today,
  leadDays)` with lead 1 and 0, so the 29 February observance and the
  December→January wrap cannot drift apart between them. Neither substitutes
  for the other; point the scheduler at both.
- **An SMS is CLAIMED by an INSERT, not by a check** — same rule as
  `notification_runs`. The unique index on `sms_messages.dedupe_key` is what
  stops a retried cron texting a member twice on their birthday. Automatic
  sends key on `birthday:<member_id>:<run_date>`; manual sends key on
  `manual:<random>:<member_id>` and therefore never collide, because thanking
  somebody for tithe twice in one day is legitimate. The key is `required` and
  never nullable: MariaDB permits many NULLs in a unique index, so a null key
  would guard nothing.
- **mNotify wants `233…`, our storage holds `+233…`.** `normalisePhone()` is
  right for storage; `toProviderNumber()` strips the `+` on the wire. mNotify's
  own validator accepts 9–12 characters and a correct Ghanaian number with a
  `+` is 13 — it is not an error, the number is just silently rejected inside a
  batch that otherwise succeeded.
- **A blank `MNOTIFY_SENDER_ID` is "not configured", never a default.** An
  unapproved sender ID is *accepted* by mNotify and then never delivered.
  Filling in a plausible default would turn a loud misconfiguration into
  messages that report success and never arrive.
- **An unknown `{{placeholder}}` REFUSES the send and names the token.**
  Substituting an empty string mails "Happy birthday !" to the congregation, at
  cost, with no recall. The placeholder set is closed (`PLACEHOLDERS` in
  `lib/sms/render.ts`) so a template cannot reference an arbitrary member field.
- **Exactly one default template per category**, enforced on write. Two
  defaults is a coin toss over which message the congregation receives, decided
  by whichever row Appwrite returns first.
- **A `leader` may hit `/api/reports/export`, scoped.** A download is a read, so
  this does not break the read-only rule (PRD §5.2). What makes it safe:
  `canReadGroup()` runs before any row loads, and a head who OMITS
  `constituency_id` is refused rather than defaulted to the whole church.
- **Sheet names are capped at 31 characters by the xlsx format.** Two long
  constituency names truncate to the same string and ExcelJS *throws* on the
  duplicate — so the workbook a church with long group names asks for is
  exactly the one that fails. `safeSheetName()` de-duplicates; use it.
- **A Vercel Cron invokes its path with `GET`, not `POST`.** Both
  notification routes export a `GET` that delegates to `POST` for exactly
  this reason. They shipped POST-only and every scheduled firing answered
  **405** before the handler ran — no row, no text, no error anywhere, looking
  precisely like a church where nobody had a birthday. It survived every check
  because each manual proof was a `curl -X POST`, which works. The
  scheduler's request and the tested request differed in the one dimension
  nobody compared. **Verify a cron the way the cron calls it** — user agent
  `vercel-cron/1.0`, method GET — not the way it is convenient to call by
  hand. Never add `dynamic = 'force-static'` to these: a cached 200 would
  report success forever while sending nothing.
- **`/api/notifications/*` is exempt from the proxy's session gate** because a
  cron has no cookie jar. It is not unauthenticated — the route requires a
  constant-time-compared bearer token or an admin session. Gating it in
  `proxy.ts` makes the scheduler 401 before the route ever sees its token.
- **The daily run is claimed by an INSERT, not a check.** The unique index on
  `notification_runs(run_date, kind)` is what stops a retried cron notifying the
  team twice; the check in front of it is only for a friendly message.
- **`/sw.js` and `/manifest.webmanifest` must stay out of the proxy matcher.**
  Browsers fetch both out of band without credentials; gating either turns a
  200 into a redirect to `/login` and push silently stops working — on iOS
  entirely, since Safari only delivers push to an installed PWA.
- **One active occurrence, globally.** Enforced in
  `lib/attendance/server.ts::activateOccurrence`. A second activation while one
  is open is a 409, not a UI-hidden button.
- **`paused` means exactly "not `open`", and that is the entire feature.**
  Every liveness check already filters on `open`, so a paused session stops the
  kiosk AND frees the single-active slot for another activity — both
  consequences of the one status value. Never add a `filter(s => s !== 'paused')`
  anywhere: the day someone writes one, pausing starts blocking activation
  again and the reason it existed is gone.
- **Pausing freezes NOTHING.** `present_count` is still computed from the rows
  at close, so marks either side of a pause land in the SAME occurrence and are
  counted once. Closing and re-activating instead gives the church two
  half-counts of one service and no way to add them up. This is the whole
  difference between pause and close, and it is why pause is not "close with a
  nicer button".
- **A paused session may be CLOSED directly, but resumed only when nothing else
  is open.** Closing does not require a resume first — a service that was
  paused and then finished is the ordinary case, and re-arming the scanner for
  a moment to satisfy a state machine is not. Resuming while something else is
  open is a 409 naming the blocker, because it would put two sessions on the
  scanner.
- **A paused session is invisible to every liveness check, so the UI must name
  it.** The Services page lists it, the header pill says "Paused · First
  Service" instead of "No session open", and the kiosk says the service is
  paused rather than that none is open. Somebody told "no session is open"
  during a paused service walks away; somebody told it is paused waits. The
  hazard the wording guards against is a service nobody remembers they are
  still in the middle of.
- **Attendance is never gated by `home_service`.** Any active member may be
  marked at either service. Only `restricted` meetings gate, and only via
  `meeting_members`.
- **An unauthorised member must still be identified.** `not_authorised` names
  them; `no_match` does not. Never collapse the two — see PRD §2.3.
- **`null` from `BiometricService.match()` means exactly one thing:** the
  matcher ran and nobody matched. Every other failure throws
  `MatcherUnavailableError` and becomes a 503 the kiosk can explain.
- **Identification stops early on a DECISIVE score, and only then.** Scoring
  every template and taking the argmax cost **2,799 ms per scan** on the live
  gallery (99 members, 1,188 templates) — measured, not estimated. A score at
  or above `decisiveScore(threshold)` (2x the threshold) ends the search;
  anything less still falls through to the full argmax and is decided exactly
  as before. Failing to be decisive costs TIME, never accuracy — that is the
  direction this must fail in. `CHURCH_BIOMETRIC_DECISIVE=9999` disables it and
  restores exact argmax, which is the escape hatch if a false accept is ever
  traced here.
- **`orderByLikelihood` ORDERS the gallery, it never filters it.** Members
  already marked at this occurrence go last, because the next person at the
  sensor is almost never one of them. They must stay in the gallery: somebody
  who scans twice has to be identified so the kiosk can say "already checked
  in" BY NAME rather than "not recognised" (PRD §4). Ordering only pays off
  together with the early exit — argmax looks at everything regardless.
- **`already_marked` on the matcher scope is a HINT and may be stale or empty.**
  It lives in process memory, so a fresh serverless instance knows nobody and
  simply gets no speed-up. Never read it to decide anything; `existingRecord`
  asks the database and is the source of truth.
- **The candidate cache serves STALE on expiry and DROPS on invalidation**, and
  the asymmetry is deliberate. Fetching the live gallery takes **5.7 seconds**;
  at the old 60s TTL that bill landed on one member a minute, who stood there
  for eight seconds with nothing on screen to explain it. Expiry now serves the
  stale copy and refreshes underneath. An explicit `invalidateCandidateCache()`
  still drops the entry, because enrol-then-immediately-test is a real flow and
  a member just enrolled must match on the very next press.
- **`warmCandidateCache()` runs on activate and on resume.** Without it the
  FIRST member of the service pays the whole gallery fetch, at the worst
  possible moment and the one everybody notices.
- **Never store raw fingerprint images.** Templates only, `xyt:<base64>`.
- **1:N identification uses `set_probe` + `match_prepared`, NEVER
  `match_templates` in a loop.** `match_templates` is a 1:1 VERIFICATION call
  that parses both templates and rebuilds the probe's O(n²) comparison Web on
  every invocation — so a 1,236-template gallery rebuilt the same Web 1,236
  times to produce 1,236 identical intermediate results. Measured cost of that
  mistake: **2,799 ms** per scan, against 935 ms for the same full scan through
  the split API. `bozorth_main` IS `bozorth_probe_init` + `bozorth_to_gallery`;
  NBIS ships the split for exactly this case and `bz_drvrs.c` says so.
- **The probe Web lives in NBIS globals, so `set_probe` is per-SCAN and the
  matcher is not thread-safe.** That is what makes reuse possible at all. One
  scan at a time per process; `match_prepared` returns -1 if no probe was set,
  rather than scoring against whatever was left behind.
- **Prepared gallery templates are cached by WIRE STRING, not by member.** The
  same template re-fetched after a gallery refresh is the same string, so a
  cache tick does not re-parse 1,236 templates. `invalidateCandidateCache()`
  frees them — skipping that leaks wasm memory on every enrolment and keeps a
  deleted member's fingerprints resident.
- **`matchWithWasm` falls back to `match_templates` when the artifact is old.**
  `public/nbis/` is committed, and server code can be deployed against a wasm
  build that has not been refreshed. The fallback is correct and slow; without
  it, the deploy would crash on `M._set_probe is not a function`.
- **`tools/nbis-wasm/build.sh` publishes to `public/nbis/` itself.** There is
  ONE artifact on purpose — the browser fetches it and the Next server loads the
  same file, so they cannot drift into disagreeing about scores. A rebuild that
  forgot the copy would leave the deployed matcher stale, and the symptom is
  nothing at all: the old build works, just slowly.
- **A member photo can be TAKEN as well as uploaded, and upload never goes
  away.** `navigator.mediaDevices` is undefined outside a secure context, which
  is exactly how a kiosk PC on a church LAN is reached over plain http — so
  `cameraAvailable()` is checked in an effect and the camera button is simply
  not offered there. Both doors write through the same upload mutation, so a
  photo behaves identically whichever way it arrived.
- **The camera stream is stopped on close, on unmount, and before switching
  cameras.** A `MediaStream` nobody stopped keeps the lens live and the
  indicator light on after the dialog is gone, which reads to the person being
  photographed as being recorded. The capture path also stops it the moment
  there is a photo to review, rather than holding it open while somebody
  decides.
- **`playsInline` and `muted` on the capture `<video>` are load-bearing.**
  Without both, iOS Safari takes the video fullscreen and the shutter button is
  no longer on screen to press. Nothing errors; the feature is just unusable on
  the phones most likely to be used for it.
- **The captured photo is never mirrored.** The operator is photographing
  somebody across a desk, not taking a selfie, so the self-view convention does
  not apply — and a face stored mirrored is a face an usher compares against
  backwards on the kiosk card.
- **`flipRows()` in `lib/biometrics/webusb.ts` is load-bearing.** Removing it
  makes every tablet stop recognising everyone. The comment explains why.
- **The FS81's IN endpoint outlives the page.** A frame is 300 packets; a
  reload mid-capture leaves the tail queued, and the next `E0` read returns
  pixels where the geometry should be ("implausible geometry NxN" on a working
  scanner). `open()` repairs it by DRAINING — send `E0`, discard packets until
  one parses as geometry. **`USBDevice.reset()` is not the fix:** it rejects
  with "Unable to reset the device" on Windows. It is attempted anyway, but
  never relied on.
- **Never `await` the `E0` write in the resync.** With a backlog queued the
  device may not accept a command until the backlog is read, so awaiting the
  write deadlocks in exactly the case being repaired. Fire it, then read.
- **Every public method on `Fs81Device` is serialised behind one lock.** Two
  command sequences on one bulk pipe desync it until the device is replugged.
  Aborts are checked BETWEEN frames only; abandoning a half-read frame causes
  the very fault.
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
- **RBAC via Appwrite User Labels** (`admin`, `usher`, `kiosk`, `leader`,
  `celebrations`, `shepherd`), exactly one per user. Server-side enforcement is
  mandatory.
- **`shepherd` is enforced by ABSENCE, never by a deny-list.** It appears on GET
  handlers only, so every mutating route refuses it without naming it and a new
  POST is shepherd-proof the moment it is written. Never add `shepherd` to a
  handler that writes — the whole guarantee is that the default is refusal.
- **`shepherd` and `leader` are not variants of each other.** A leader sees only
  the groups naming them as head and may write inside them; a shepherd sees the
  whole church and writes nothing. Wider read, zero write — neither is a subset
  of the other, which is why it is a fifth label and not a flag on the fourth.
- **`!isAdmin` no longer means "a head".** It stopped meaning that the moment a
  read-only role could open a group page. Pages that offer writes to a head now
  test `canWrite` (admin OR leader) and keep `isAdmin` for admin-only controls;
  reusing `!isAdmin` for head-only UI hands a shepherd a button that 403s.
- **A page a reader can open must gate its CONTROLS, not rely on the API.** The
  API refusing is the enforcement; the gate is so nobody is offered a button
  that answers 403. `/services`, `/meetings` and `/meetings/[id]` each carry a
  `canAct` test for this reason, and `MemberChecklist` takes `readOnly` — a
  checkbox that still ticks with no Save button is a lie, because it looks like
  an edit and is discarded on navigation.
- **`/meetings/new` redirects a non-admin to `/meetings`.** A proxy prefix
  cannot express "this path but not that child", so the one page that has no
  read-only meaning bounces in the page itself. `POST /api/meetings` is what
  actually refuses them.
- **Cascades are manual.** Deleting a member means deleting their
  `biometric_templates`, `meeting_members`, `bacenta_members` and
  `attendance_records` first. Deleting a constituency means clearing
  `constituency_id` off its members BEFORE the row goes, or they are left
  pointing at a home that no longer exists.
- **Idempotent setup:** `scripts/setup-appwrite.ts` is the single source of
  truth for schema and must be safe to re-run. New attributes go there, not
  into the console by hand. `npm run verify:appwrite` reads the live project
  back through the app's own code and checks the things that break attendance
  quietly — run it after any schema change.
- **An attribute is never both `required` and defaulted.** Appwrite rejects it
  (`attribute_default_unsupported`), and the helpers in the setup script now
  throw before the API can. Every writer supplies these values explicitly;
  `meetings.restricted` in particular must never acquire a default, because a
  defaulted `false` silently opens a private meeting to everyone.
- **A `tsx` script that imports any `lib/**/server.ts` needs
  `--conditions=react-server`,** or `server-only` throws
  "cannot be imported from a Client Component". `setup:appwrite` avoids it by
  importing nothing that pulls `server-only`; `verify:appwrite` passes the flag.
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
CHURCH_BIOMETRIC_DECISIVE        # optional, default threshold x2 - see below
CHURCH_WASM_MATCHER              # optional, "0" disables the in-process matcher

NEXT_PUBLIC_VAPID_PUBLIC_KEY     # optional — without it, push is off and says so
VAPID_PRIVATE_KEY                # server only, never NEXT_PUBLIC_
VAPID_SUBJECT                    # optional, mailto: the push service can contact
NOTIFICATIONS_CRON_SECRET        # optional — without it only an admin can run it

MNOTIFY_API_KEY                  # server only, never NEXT_PUBLIC_
MNOTIFY_SENDER_ID                # must be APPROVED by mNotify; blank ⇒ SMS is off
SMS_STUB                         # optional, "1" swaps in a stub that sends nothing
```

The app must boot cleanly when the five required ones are present. The push
and SMS vars are genuinely optional: with them absent the birthdays page
reports "notifications are not set up" and `/sms` reports "SMS is not set up",
rather than offering buttons that fail.

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
