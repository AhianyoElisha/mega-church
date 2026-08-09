# Provenance of `tools/`

Everything in this directory was extracted from **SEMP**, the KNUST College of
Science exam administration platform, where the fingerprint stack was built and
proven against real hardware over several iterations.

It is here unchanged in behaviour. What was renamed:

| SEMP | Here |
|---|---|
| `semp-scan` / `semp-scan.exe` | `church-scan` / `church-scan.exe` |
| `SEMP_BRIDGE_PORT` | `CHURCH_BRIDGE_PORT` |
| `SEMP_BIOMETRIC_THRESHOLD` | `CHURCH_BIOMETRIC_THRESHOLD` |
| `SEMP_BIOMETRIC_MATCHER_URL` | `CHURCH_BIOMETRIC_MATCHER_URL` |
| `NEXT_PUBLIC_SEMP_BRIDGE_URL` | `NEXT_PUBLIC_CHURCH_BRIDGE_URL` |
| `SEMPFingerprintBridge` (service) | `ChurchFingerprintBridge` |
| `index_number` (candidate key) | `member_id` |

The compiled artifacts — `church-scan.exe`, the NBIS binaries
(`cwsq` / `mindtct` / `bozorth3`), the WHQL Futronic driver, and
`nbis-wasm/dist/nbis.wasm` — are byte-identical to SEMP's. Only their filenames
changed, which a PE/ELF loader does not care about.

## "Plan NN" comments

Many comments in these files open with `Plan 38 —`, `Plan 43 Phase E —` and
similar. Those refer to SEMP's planning documents, which do not exist in this
repository.

They were **deliberately left in place**. Each one is attached to a decision
that cost real debugging to arrive at, and the tag is what lets you find the
original write-up if you ever need the full story. The comment body always
states the reasoning on its own, so nothing here depends on having the plan
document to hand.

The ones worth knowing about:

- **Plan 38** — the bridge itself, and the decision to make `/match` stateless
  (the probe travels *with* its candidate set). That is why swapping the
  matcher is a config change rather than a refactor.
- **Plan 40** — Windows support. The `.exe` suffix handling and the PnP device
  probe in `lib/biometrics/platform.ts` exist because of it.
- **Plan 42** — the tablet path: driving the FS81 from the browser over WebUSB
  and compiling NBIS to WebAssembly, so a device with no Node runtime can still
  produce the identical `xyt:` template.
- **Plan 43** — matcher accuracy. The threshold of 33 and its measured
  provenance; and Phase E, which established that "this server cannot match" is
  not the same thing as "that finger did not match".
- **Plan 44** — the Windows kiosk provisioning pack, so a fresh PC is set up by
  downloading a few MB instead of cloning a repository.
- **Plan 45** — running the matcher *inside* the Next server via WebAssembly,
  which is what lets a hosted deployment identify a fingerprint with no
  kiosk-local bridge and no Appwrite key on every kiosk.

## What did NOT come across

SEMP's exam-specific scoping — halls, exam slots, seat allocations. The
equivalent concept here is the meeting roster, and it lives in
`lib/biometrics/server.ts`, which was rewritten rather than copied.
