# Mega Church Biometric Attendance System — PRD

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
| `status` | enum | yes | `active` \| `inactive` |
| `created_by` | string(128) | no | admin email |

`full_name` is derived, never stored: `first_name [other_names] last_name`.

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
| `name` | string(96) | "First Service (Sun Chapel)", "Youth Committee" |
| `description` | string(512) | |
| `kind` | enum | `service` \| `meeting` |
| `service_slot` | enum \| null | `first` \| `second`, only when `kind = service` |
| `restricted` | boolean | true ⇒ attendance limited to the authorised roster |
| `archived` | boolean | hidden from the activate list, history preserved |
| `sort_order` | integer | services first |

Two `service` rows are seeded and are **not deletable**:

- `first-service` — *First Service (Sun Chapel)*, `restricted = false`
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
- The member's name renders at **≥ 48pt** on the result screen.
- The member's photo is shown on the result screen for visual confirmation.

### 2.5 Server-side everything

Role checks, roster authorisation, single-active-session, and duplicate
suppression all re-run on the server. The UI hiding a control is not security.

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
| `admin` | everything: members, meetings, rosters, activate/end, reports |
| `usher` | live monitor, manual check-in, read-only member lookup |
| `kiosk` | `/kiosk` only — POST scans, read the active occurrence |

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
