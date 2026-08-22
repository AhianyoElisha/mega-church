import { describe, expect, it, vi } from 'vitest'
import { recordRun } from '@/lib/notifications/server'

const OUTCOME = {
  status: 'nobody_celebrating',
  celebrant_count: 0,
  sent: 0,
  failed: 0,
  skipped: 0,
}

/** A Databases double: `createDocument` behaves as told, the rest records. */
function fakeDb(opts: { createThrows?: { code?: number }; existingId?: string | null } = {}) {
  const calls = {
    created: [] as unknown[],
    updated: [] as { id: string; data: unknown }[],
    listed: 0,
  }
  const db = {
    createDocument: vi.fn(async (_d: string, _c: string, _i: string, data: unknown) => {
      if (opts.createThrows) throw Object.assign(new Error('conflict'), opts.createThrows)
      calls.created.push(data)
      return { $id: 'new' }
    }),
    listDocuments: vi.fn(async () => {
      calls.listed++
      return {
        documents: opts.existingId === null ? [] : [{ $id: opts.existingId ?? 'existing' }],
      }
    }),
    updateDocument: vi.fn(async (_d: string, _c: string, id: string, data: unknown) => {
      calls.updated.push({ id, data })
      return { $id: id }
    }),
  }
  return { db: db as never, calls }
}

describe('recordRun', () => {
  it('writes a row on a day when nothing happened', async () => {
    // The whole point: a firing on a quiet day must be distinguishable from a
    // scheduler that never fired at all.
    const { db, calls } = fakeDb()
    await recordRun(db, '2026-08-22', 'birthday-sms', 'scheduler', OUTCOME)
    expect(calls.created).toHaveLength(1)
    expect(calls.created[0]).toMatchObject({
      run_date: '2026-08-22',
      kind: 'birthday-sms',
      triggered_by: 'scheduler',
      status: 'nobody_celebrating',
    })
  })

  it('UPDATES rather than refusing when today already has a row', async () => {
    // The load-bearing difference from `claimRun`. A second call of the day is
    // normal for this job — the SMS run is idempotent per member so that a run
    // which died at member forty can be re-run for the remaining twenty. If
    // this refused, those twenty would never be texted.
    const { db, calls } = fakeDb({ createThrows: { code: 409 } })
    await recordRun(db, '2026-08-22', 'birthday-sms', 'scheduler', {
      ...OUTCOME,
      status: 'sent',
      celebrant_count: 3,
      sent: 2,
      skipped: 1,
    })
    expect(calls.updated).toHaveLength(1)
    expect(calls.updated[0].id).toBe('existing')
    expect(calls.updated[0].data).toMatchObject({ status: 'sent', sent: 2, skipped: 1 })
  })

  it('never throws when the audit write fails outright', async () => {
    // An audit row that cannot be written must not turn a successful send into
    // a reported failure. This is the property that keeps observability from
    // costing more than it is worth.
    const { db } = fakeDb({ createThrows: { code: 500 } })
    await expect(
      recordRun(db, '2026-08-22', 'birthday-sms', 'scheduler', OUTCOME),
    ).resolves.toBeUndefined()
  })

  it('gives up quietly if the conflicting row cannot be found again', async () => {
    const { db, calls } = fakeDb({ createThrows: { code: 409 }, existingId: null })
    await expect(
      recordRun(db, '2026-08-22', 'birthday-sms', 'scheduler', OUTCOME),
    ).resolves.toBeUndefined()
    expect(calls.updated).toHaveLength(0)
  })

  it('stamps who triggered it, so a cron is tellable from a person', async () => {
    const { db, calls } = fakeDb()
    await recordRun(db, '2026-08-22', 'birthday-sms', 'admin@megachurch.local', OUTCOME)
    expect(calls.created[0]).toMatchObject({ triggered_by: 'admin@megachurch.local' })
  })
})
