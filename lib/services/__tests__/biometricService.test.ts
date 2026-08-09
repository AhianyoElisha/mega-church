import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The gallery loaders talk to Appwrite; the point of these tests is the
// ESCALATION LOGIC around them, so they are mocked and the assertions are
// about which galleries get consulted and in what order.
const loadCandidatesForMeeting = vi.fn()
const loadAllCandidateTemplates = vi.fn()

vi.mock('@/lib/biometrics/server', () => ({
  loadCandidatesForMeeting: (...a: unknown[]) => loadCandidatesForMeeting(...a),
  loadAllCandidateTemplates: (...a: unknown[]) => loadAllCandidateTemplates(...a),
}))

const matchWithWasm = vi.fn()
vi.mock('@/lib/biometrics/wasm-matcher', () => ({
  matchWithWasm: (...a: unknown[]) => matchWithWasm(...a),
  isWasmMatcherAvailable: async () => true,
}))

import {
  MatcherUnavailableError,
  StubBiometricService,
  WasmBiometricService,
  getBiometricService,
} from '@/lib/services/biometricService'
import { encodeXytTemplate } from '@/lib/biometrics/codec'

const PROBE = encodeXytTemplate('10 20 30 40\n11 21 31 41\n')
const fakeDb = {} as never

const ROSTER = [{ member_id: 'on-roster', templates: ['xyt:aaa'] }]
const EVERYONE = [
  { member_id: 'on-roster', templates: ['xyt:aaa'] },
  { member_id: 'not-on-roster', templates: ['xyt:bbb'] },
]

beforeEach(() => {
  vi.clearAllMocks()
  loadCandidatesForMeeting.mockResolvedValue(ROSTER)
  loadAllCandidateTemplates.mockResolvedValue(EVERYONE)
  delete process.env.CHURCH_BIOMETRIC_MATCHER_URL
  delete process.env.CHURCH_WASM_MATCHER
})

afterEach(() => {
  delete process.env.CHURCH_BIOMETRIC_MATCHER_URL
  delete process.env.CHURCH_WASM_MATCHER
})

describe('StubBiometricService', () => {
  it('resolves a sim payload to a member id', async () => {
    expect(await new StubBiometricService().match('sim:member-7')).toEqual({
      member_id: 'member-7',
    })
  })

  it('returns null for an unrecognised payload', async () => {
    expect(await new StubBiometricService().match('garbage')).toBeNull()
  })

  it('THROWS rather than returning null for a real template', async () => {
    // This is the distinction that cost SEMP a session: a real fingerprint
    // reaching the stub means the server has no matcher, which is a
    // misconfiguration — NOT "that finger is unknown".
    await expect(new StubBiometricService().match(PROBE)).rejects.toBeInstanceOf(
      MatcherUnavailableError,
    )
  })
})

describe('two-stage identification for a restricted meeting', () => {
  it('stops at the roster when the member is on it', async () => {
    matchWithWasm.mockResolvedValueOnce({ member_id: 'on-roster', score: 90 })
    const svc = new WasmBiometricService(fakeDb, { meeting_id: 'm1', restricted: true })

    expect(await svc.match(PROBE)).toEqual({ member_id: 'on-roster' })
    expect(loadCandidatesForMeeting).toHaveBeenCalledTimes(1)
    // The expensive gallery is never even loaded in the common case.
    expect(loadAllCandidateTemplates).not.toHaveBeenCalled()
  })

  it('escalates to everyone so an UNAUTHORISED member is still identified', async () => {
    // The whole reason this is two-stage. Without the second pass this person
    // gets "fingerprint not recognised" and goes to argue with an usher about
    // a biometric fault that does not exist.
    matchWithWasm
      .mockResolvedValueOnce(null) // not on the roster
      .mockResolvedValueOnce({ member_id: 'not-on-roster', score: 88 })

    const svc = new WasmBiometricService(fakeDb, { meeting_id: 'm1', restricted: true })
    expect(await svc.match(PROBE)).toEqual({ member_id: 'not-on-roster' })
    expect(loadCandidatesForMeeting).toHaveBeenCalledTimes(1)
    expect(loadAllCandidateTemplates).toHaveBeenCalledTimes(1)
  })

  it('returns null only when nobody anywhere matches', async () => {
    matchWithWasm.mockResolvedValue(null)
    const svc = new WasmBiometricService(fakeDb, { meeting_id: 'm1', restricted: true })
    expect(await svc.match(PROBE)).toBeNull()
    expect(matchWithWasm).toHaveBeenCalledTimes(2)
  })

  it('falls through to everyone when the roster is empty', async () => {
    // An empty roster is a configuration problem. Identifying someone and
    // refusing them for a stated reason beats telling a real member their
    // finger is unknown.
    loadCandidatesForMeeting.mockResolvedValue([])
    matchWithWasm.mockResolvedValueOnce({ member_id: 'not-on-roster', score: 70 })

    const svc = new WasmBiometricService(fakeDb, { meeting_id: 'm1', restricted: true })
    expect(await svc.match(PROBE)).toEqual({ member_id: 'not-on-roster' })
    // The empty gallery is skipped, not passed to the matcher.
    expect(matchWithWasm).toHaveBeenCalledTimes(1)
  })
})

describe('single-stage identification for an open service', () => {
  it('never consults a roster', async () => {
    // A service is open to every active member regardless of which one they
    // usually attend (PRD §2.1).
    matchWithWasm.mockResolvedValueOnce({ member_id: 'anyone', score: 75 })
    const svc = new WasmBiometricService(fakeDb, { meeting_id: 'first-service', restricted: false })

    expect(await svc.match(PROBE)).toEqual({ member_id: 'anyone' })
    expect(loadCandidatesForMeeting).not.toHaveBeenCalled()
    expect(loadAllCandidateTemplates).toHaveBeenCalledTimes(1)
  })
})

describe('matcher failures are not non-matches', () => {
  it('turns a wasm failure into MatcherUnavailableError', async () => {
    matchWithWasm.mockRejectedValueOnce(new Error('wasm artifact missing'))
    const svc = new WasmBiometricService(fakeDb, { meeting_id: 'm1', restricted: false })
    await expect(svc.match(PROBE)).rejects.toBeInstanceOf(MatcherUnavailableError)
  })
})

describe('getBiometricService factory', () => {
  it('prefers the local bridge when one is configured', () => {
    process.env.CHURCH_BIOMETRIC_MATCHER_URL = 'http://127.0.0.1:7788'
    const svc = getBiometricService({ databases: fakeDb })
    expect(svc.constructor.name).toBe('LocalMatcherBiometricService')
  })

  it('falls back to the in-process matcher with no bridge', () => {
    const svc = getBiometricService({ databases: fakeDb })
    expect(svc.constructor.name).toBe('WasmBiometricService')
  })

  it('honours the CHURCH_WASM_MATCHER=0 kill switch', () => {
    process.env.CHURCH_WASM_MATCHER = '0'
    const svc = getBiometricService({ databases: fakeDb })
    expect(svc.constructor.name).toBe('StubBiometricService')
  })

  it('returns the stub when there is no Databases handle to load a gallery with', () => {
    expect(getBiometricService({}).constructor.name).toBe('StubBiometricService')
  })
})
