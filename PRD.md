# The Mega Church Biometric Attendance System — PRD

This document is the source of truth for data shapes, collection schema, the
session lifecycle, and every module's scope. Read it before writing code.

Lineage: the biometric stack is extracted wholesale from the SEMP exam
platform (`../semp`); the UI language is an exact copy of PickLT (`../PickLT`)
re-themed to white / yellow / black.

---

## 1. Domain

### 1.1 Members

Anyone registered with the church. There is no membership *tier* that gates
attendance — see §2.1.

| Field | Type | Required | Notes |
|---|---|---|---|
| `first_name` | string(64) | yes | |
| `last_name` | string(64) | yes | |
| `other_names` | string(96) | no | middle / additional names |
| `photo_file_id` | string(64) | no | Appwrite Storage id in `member-photos` |
| `birth_month` | integer 1-12 | no | **no birth year is ever collected** |
| `birth_day` | integer 1-31 | no | |
| `address` | string(256) | no | |
| `call_number` | string(32) | **yes** | the number you ring |
| `whatsapp_number` | string(32) | no | often identical to `call_number`, but stored independently because some members keep them separate |
| `home_service` | enum | yes | `first` \| `second` — informational only, **never** an attendance gate |
| `constituency_id` | string(64) | no | where they LIVE — exactly one (§1.7). Informational only; **never** an attendance gate |
| `status` | enum | yes | `active` \| `inactive` |
| `created_by` | string(128) | no | admin email |

`full_name` is derived, never stored: `first_name [other_names] last_name`.

Bacenta membership is deliberately **not** a field here. A member serves in
zero or many, so it lives in the join collection `bacenta_members` (§1.9). The
asymmetry with `constituency_id` is the whole design — see §1.7.

### 1.2 Biometric templates

Four fingers × three scan variations each = **12 templates per fully-enrolled
member**. Templates only — raw fingerprint images are never persisted.

| Field | Type | Notes |
|---|---|---|
| `member_id` | string(64) | Appwrite `$id` of the member |
| `finger_label` | enum | `right-thumb` \| `left-thumb` \| `right-index` \| `left-index` |
| `variation` | integer 1-3 | which of the three presses this is |
| `template` | string(16384) | wire form `xyt:<base64>` — see `lib/biometrics/codec.ts` |
| `minutiae` | integer | count, for enrolment-quality display |
| `created_by` | string(128) | |

### 1.3 Meetings

A *meeting* is a recurring **definition**, not an occurrence.

| Field | Type | Notes |
|---|---|---|
| `name` | string(96) | "First Service (Psalms Chapel)", "Youth Committee" |
| `description` | string(512) | |
| `kind` | enum | `service` \| `meeting` |
| `service_slot` | enum \| null | `first` \| `second`, only when `kind = service` |
| `restricted` | boolean | true ⇒ attendance limited to the authorised roster |
| `archived` | boolean | hidden from the activate list, history preserved |
| `sort_order` | integer | services first |

Two `service` rows are seeded and are **not deletable**:

- `first-service` — *First Service (Psalms Chapel)*, `restricted = false`
- `second-service` — *Second Service*, `restricted = false`

Every other row is admin-created, `kind = meeting`, `restricted = true`.

### 1.4 Meeting members (the authorised roster)

One document per (meeting, member) pair. Created when an admin ticks a member
during meeting creation, and **persists** — reopening the same meeting later
reuses the roster with no re-selection. Editable at any time.

| Field | Type |
|---|---|
| `meeting_id` | string(64) |
| `member_id` | string(64) |
| `added_by` | string(128) |

A member may be on the roster of any number of meetings simultaneously.
Roster membership has **no bearing whatsoever** on First or Second Service
attendance (§2.1).

### 1.5 Meeting occurrences

One dated run of a meeting. Created when an admin activates, closed when they
end it.

| Field | Type | Notes |
|---|---|---|
| `meeting_id` | string(64) | |
| `occurrence_date` | string(10) | `YYYY-MM-DD` in Africa/Accra |
| `status` | enum | `open` \| `closed` |
| `opened_at` | string(32) | ISO |
| `closed_at` | string(32) \| null | ISO |
| `opened_by` / `closed_by` | string(128) | admin email |
| `present_count` | integer | denormalised tally, written on close |

### 1.6 Attendance records

| Field | Type | Notes |
|---|---|---|
| `occurrence_id` | string(64) | |
| `meeting_id` | string(64) | denormalised for per-meeting history queries |
| `member_id` | string(64) | |
| `marked_at` | string(32) | ISO |
| `method` | enum | `biometric` \| `manual` |
| `marked_by` | string(128) \| null | usher email for manual marks |
| `note` | string(512) \| null | |

Uniqueness is enforced in application code: one record per
(`occurrence_id`, `member_id`). A second scan returns `already_marked` and
writes nothing.

### 1.7 Constituencies

Where a member **lives**. The church has four today and will add more.

| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | string(96) | yes | unique, case- and whitespace-insensitively |
| `description` | string(512) | no | |
| `head_user_id` | string(64) | no | Appwrite user `$id` of the head. Null until appointed |
| `head_name` | string(128) | no | denormalised for display, rewritten with `head_user_id` |
| `sort_order` | integer | yes | |

**A member belongs to exactly one**, so the link is a field on the member
(`members.constituency_id`) and not a join collection. A join here would permit
a member to have two homes, which is not a state the church has.

Assigning a member to a constituency therefore **moves** them out of whichever
one they were in. The bulk assigner says so before it sends.

### 1.8 Bacentas and bacenta categories

The work group a member **serves** in. Two shapes, both first-class:

- **categorised** — `bacenta_categories` holds a family such as *Choir*, and
  the individual bacentas *Biazo*, *Living Waters* and *Fresh Oil* sit under
  it. Nobody is a member of a category; they are a member of one of the
  bacentas inside it.
- **standalone** — *Technical Team* has no family and takes members directly.

`bacentas.category_id === null` **is** the standalone case. There is
deliberately no `is_standalone` boolean beside it, because two fields encoding
one fact are two fields that can disagree.

| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | string(96) | yes | unique **within its category**, not globally |
| `category_id` | string(64) | no | null ⇒ standalone |
| `description` | string(512) | no | |
| `head_user_id` | string(64) | no | as §1.7 |
| `head_name` | string(128) | no | |
| `sort_order` | integer | yes | |

Name uniqueness is per category on purpose: "Youth" under Choir and "Youth"
under Ushers are two real, different groups, and a global unique index would
refuse the second.

Deleting a category that still holds bacentas is **refused**. Orphaning them
would leave real groups full of real people rendering as "category missing",
and only an admin knows where those bacentas should go instead.

### 1.9 Bacenta members

The many-to-many join. One row per (`bacenta_id`, `member_id`), unique.

A member may sing in two choirs and run the sound desk at the same time. Every
write is expressed as a **diff** (`add` / `remove` / `set`), never as
delete-all-then-insert — a rewrite loses `added_by` and the joined-on
timestamps for people who never moved, and a rewrite that fails halfway leaves
the group empty, which is the one state that makes a head's screen look like
their bacenta was disbanded.

### 1.10 Push subscriptions

One row per **device** that opted into notifications — not per account. The
same person must enable it on their phone and again on the office desktop,
because each browser holds its own subscription.

| Field | Type | Notes |
|---|---|---|
| `user_id` | string(64) | taken from the session, never from the request body |
| `user_label` | string(32) | the role at subscribe time, so a run can target a team without re-reading every account |
| `endpoint` | string(1024) | the push service URL |
| `endpoint_hash` | string(64) | SHA-256 of `endpoint`, **unique** |
| `p256dh` / `auth_key` | string | the encryption keys |
| `device_label` | string(128) | "iPhone", "Windows PC" |

`endpoint_hash` exists because MariaDB cannot index 1024 utf8mb4 characters
(the 3072-byte key limit). Without it, one phone re-subscribing after a browser
update accumulates a second row and its owner is notified twice.

A 404 or 410 from the push service means the subscription is permanently gone.
Those rows are **deleted**, not retried.

### 1.11 Notification runs

One row per (`run_date`, `kind`) of scheduled notification, **unique**.

The run is *claimed* by inserting this row **before** anything is sent. That
insert — not the check in front of it — is what stops a retried or overlapping
cron from notifying the team twice. `run_date` is YYYY-MM-DD in Accra and is
the day the notification was SENT, not the birthday.

---

## 2. Rules

### 2.1 Attendance is never gated by membership type

A regular first-service attendee who turns up at second service is marked
present at second service, and vice versa. `home_service` is descriptive only.
Any `active` member may be marked present at **either service**.

### 2.2 One active session, globally

At most one occurrence is `open` at any moment — a service or a meeting, never
two of anything. Enforced server-side in
`lib/attendance/server.ts::activateOccurrence`, not by the UI hiding a button.

Consequences:

- First Service must be **ended** before Second Service can be activated.
- The two services can never run concurrently.
- The kiosk never has to ask *which* session it is marking.

### 2.3 Restricted meetings

For a meeting with `restricted = true`, a scan is only accepted from a member
on that meeting's authorised roster.

An unauthorised member who scans is still **identified** — the system tells
them, by name, that they do not have access to this meeting and cannot mark
attendance for it. Reporting "fingerprint not recognised" here would be both
wrong and the least helpful thing the screen can say. This is the direct
analogue of SEMP's wrong-hall redirect, and it is why identification runs in
two stages (§3.3).

### 2.4 Kiosk accessibility

- Pass/fail is signalled by **colour and a text label**, never colour alone.
- The member's photo is shown on the result screen for visual confirmation.
- The member's name is the largest element on the result screen, and is sized
  for the distance a **counter** kiosk is read from — roughly 28-44px
  (`kiosk-name` in `styles/tailwind.css`).

  This inherited a "≥ 48pt" rule from SEMP, whose kiosk faced a queue across an
  exam hall. Applied to a machine someone is standing directly in front of, it
  produced a ~90px name that overflowed its card. If a kiosk is ever mounted
  where people read it from a distance, raise the clamp rather than the
  minimum — the constraint is legibility at the actual viewing distance, not a
  number.

### 2.5 Server-side everything

Role checks, roster authorisation, single-active-session, group scoping, and
duplicate suppression all re-run on the server. The UI hiding a control is not
security.

### 2.6 Groups never gate attendance

A constituency and a bacenta are both **descriptive**, exactly like
`home_service`. A member with no constituency and no bacenta is marked present
by a scanner like anybody else. Only `restricted` meetings gate, and only via
`meeting_members` (§2.3).

This matters because the two systems look similar and are not: a bacenta is
*who somebody is*, a meeting roster is *who may be counted at this event*.

### 2.7 The church hears about a birthday the DAY BEFORE

`BIRTHDAY_LEAD_DAYS = 1` in `lib/appwrite/config.ts`.

The flyer and the shoutout have to be made before the day, so showing a
birthday on the morning of it is showing it too late. The dashboard card, the
birthdays page and the push notification all read the same constant and the
same `celebrantsForNotification`, so they can never disagree about who is
celebrating.

It is an **exact-day** filter, not a window. A window would re-announce the
same person every morning until their birthday arrived, and a team that gets
the same alert four times stops reading them.

Two calendar cases are load-bearing and unit-tested: the December→January wrap
(on 31 December, a 1 January birthday is *tomorrow*), and 29 February — a real
birthday, observed on 28 February in a common year so the team is never told to
prepare for a day that will not arrive.

---

## 3. Biometric pipeline

Ported verbatim from SEMP unless noted. Do not re-derive any of it.

### 3.1 Capture

Two sources produce the identical `xyt:<base64>` wire template:

1. **PC kiosk** → `tools/fingerprint-bridge/` — a loopback HTTP service on
   `127.0.0.1:7788` that owns the Futronic FS81 (via `semp-scan` + vendor
   `ftrScanAPI.dll`) and the NBIS binaries (`cwsq`, `mindtct`, `bozorth3`).
2. **Tablet kiosk** → `lib/biometrics/webusb.ts` drives the FS81 directly over
   WebUSB and extracts minutiae with NBIS compiled to WebAssembly
   (`lib/biometrics/nbis-wasm.ts`, artifact at `public/nbis/`).

Raw images exist only as a temp file for the seconds between capture and
extraction, then the temp dir is removed. Nothing downstream of the capture
knows which source produced the template.

`flipRows()` in `webusb.ts` is load-bearing: the vendor library returns rows
reversed relative to the wire, and bozorth3 is not reflection-invariant. Remove
it and every tablet silently stops recognising everyone.

### 3.2 Matching

`bozorth3` similarity score, threshold **33** (`DEFAULT_MATCH_THRESHOLD`,
overridable with `CHURCH_BIOMETRIC_THRESHOLD`). Provenance of that number is
recorded in `lib/biometrics/matching.ts` — read it before changing it.

Three implementations behind one `match()` seam, in factory priority:

1. `LocalMatcherBiometricService` — POSTs probe + candidate set to the bridge's
   `/match`. Selected by `CHURCH_BIOMETRIC_MATCHER_URL`.
2. `WasmBiometricService` — runs NBIS-as-wasm **inside the Next server**, so a
   hosted deployment can identify a fingerprint with no kiosk-local bridge and
   no Appwrite server key on every kiosk. The server still decides who you are,
   so a tampered kiosk cannot assert an identity.
3. `StubBiometricService` — `sim:<member_id>` passthrough for testing.

"This server cannot match" is **not** "that finger did not match".
`MatcherUnavailableError` → HTTP 503 with an explanation; `null` means one
thing only: the matcher ran and nobody matched.

### 3.3 Two-stage identification

For the open occurrence:

| Stage | Gallery | Purpose |
|---|---|---|
| 1 | authorised roster of the meeting | small, fast, the overwhelmingly common case |
| 2 | all `active` members | so an unauthorised person is still *identified* and can be told why they were refused |

For an unrestricted service, stage 1 is skipped — the gallery is all active
members, because the service is open to everyone.

Escalation happens on **no match**, not on an empty gallery. If every scoped
stage was empty the scope was wrong, and the matcher degrades to the full set
rather than telling a real member their finger is unknown.

Gallery size matters for accuracy, not just speed: false-accept probability
grows with the number of comparisons.

---

## 4. Scan outcomes

`ScanResult` is a discriminated union; the kiosk renders one panel per `kind`.

| kind | Meaning | Writes? |
|---|---|---|
| `marked` | identified, authorised, newly present | yes |
| `already_marked` | identified, already present in this occurrence | **no** |
| `not_authorised` | identified, but not on this restricted meeting's roster | no |
| `inactive_member` | identified, but `status = inactive` | no |
| `no_match` | the matcher ran and nobody matched | no |

---

## 5. Roles

Appwrite User Labels, exactly one per user.

| Label | Can |
|---|---|
| `admin` | everything: members, meetings, rosters, groups, activate/end, reports |
| `usher` | live monitor, manual check-in, read-only member lookup |
| `kiosk` | `/kiosk` only — POST scans, read the active occurrence |
| `leader` | a constituency head, a bacenta head, or **both**. Read-only, and only the groups that name them as head |
| `celebrations` | the birthday team: the celebrant list and push notifications, nothing else |

### 5.1 Why `leader` is one label and not two

The same person frequently heads a constituency *and* a bacenta. Two labels
would mean two logins to see the two halves of their own work, which is exactly
what the church asked to avoid.

So the label grants nothing by itself. A leader's **scope** is resolved
per-request from which groups name them as head
(`lib/groups/server.ts::leaderScope`), and `/my-groups` offers a switch between
the two kinds when they head both. A `leader` account nobody has appointed sees
empty lists — a normal state on the day someone is given the job, not an error,
and never a 403 that would read as a broken login.

### 5.2 What a head can and cannot do

**Read-only.** Their members' details, birthdays, and how often each has
attended. They cannot register members, edit them, create groups, or move
anyone between groups.

Enforcement is server-side and absolute: `canReadGroup` is consulted on every
group read, and the group id is never taken from anything the client sent when
listing. A head putting somebody else's bacenta id in a URL gets a 403.

---

## 6. Modules

1. **Auth & RBAC** — Appwrite email/password sessions, cookie transport, labels.
2. **Member registry** — CRUD, photo upload, search.
3. **Biometric enrolment** — 4 fingers × 3 variations, quality feedback.
4. **Meetings** — create with member checklist, persistent editable roster.
5. **Session lifecycle** — activate / end, single-active enforcement.
6. **Kiosk** — capture loop, offline queue, manual fallback, result panels.
7. **Live monitor** — Appwrite Realtime over `attendance_records`.
8. **Reports** — per-occurrence and per-member history, Excel export.
9. **Constituencies** — CRUD, head appointment, and a bulk assigner that files
   many already-registered members in one action.
10. **Bacentas** — categories and standalone groups, many-to-many membership,
    the same bulk assigner.
11. **Head accounts** — one `leader` label, per-request scoping, `/my-groups`
    with a constituency/bacenta switch for someone who heads both.
12. **Birthdays** — the day-before list, the celebrations account, and a
    manual "send now".
13. **PWA + push** — installable app, service worker, per-device
    subscriptions, and an idempotent daily run a scheduler calls.
