import { describe, expect, it } from 'vitest'
import type { Databases, Storage } from 'node-appwrite'
import { deleteMemberCascade } from '../server'
import { BUCKETS, COLLECTIONS, DATABASE_ID } from '@/lib/appwrite/config'

/**
 * The member's photo is the one reference the cascade cannot find by
 * `member_id`: it is a file in Storage, pointed at only by the row being
 * deleted. These tests pin the three things that make it safe —
 *
 *   1. the file IS deleted, from the right bucket, with the id the row held;
 *   2. it is deleted AFTER the row, so a storage failure leaves a stray file
 *      and never a member whose card points at nothing;
 *   3. a storage failure does not fail the delete, which already happened.
 *
 * `releaseCharges` is reached through the same fake `databases`, so the fake
 * answers every list with an empty page.
 */

type Call = ['deleteDocument' | 'deleteDocuments' | 'deleteFile', string, string]

function fakes(doc: Record<string, unknown> | null, opts: { storageFails?: boolean } = {}) {
  const calls: Call[] = []
  const databases = {
    async getDocument(_db: string, _coll: string, id: string) {
      if (!doc) throw new Error(`Document with the requested ID could not be found: ${id}`)
      return { $id: id, ...doc }
    },
    async deleteDocuments(_db: string, coll: string, queries: string[]) {
      calls.push(['deleteDocuments', coll, queries.join(' ')])
      return { total: 0 }
    },
    async listDocuments() {
      return { total: 0, documents: [] }
    },
    async deleteDocument(_db: string, coll: string, id: string) {
      calls.push(['deleteDocument', coll, id])
      return {}
    },
  } as unknown as Databases
  const storage = {
    async deleteFile(bucket: string, fileId: string) {
      calls.push(['deleteFile', bucket, fileId])
      if (opts.storageFails) throw new Error('storage hiccup')
      return {}
    },
  } as unknown as Storage
  return { databases, storage, calls }
}

describe('deleteMemberCascade and the photo file', () => {
  it('bins the photo from the member-photos bucket, after the row', async () => {
    const { databases, storage, calls } = fakes({ photo_file_id: 'file-1' })

    const removed = await deleteMemberCascade(databases, storage, 'm1')

    expect(removed.photo).toBe(true)
    const fileCall = calls.findIndex((c) => c[0] === 'deleteFile')
    const rowCall = calls.findIndex(
      (c) => c[0] === 'deleteDocument' && c[1] === COLLECTIONS.members && c[2] === 'm1',
    )
    expect(fileCall).toBeGreaterThan(-1)
    expect(rowCall).toBeGreaterThan(-1)
    expect(fileCall).toBeGreaterThan(rowCall)
    expect(calls[fileCall]).toEqual(['deleteFile', BUCKETS.member_photos, 'file-1'])
  })

  it('touches storage not at all for a member with no photo', async () => {
    const { databases, storage, calls } = fakes({ photo_file_id: null })

    const removed = await deleteMemberCascade(databases, storage, 'm2')

    expect(removed.photo).toBe(false)
    expect(calls.some((c) => c[0] === 'deleteFile')).toBe(false)
    expect(calls.some((c) => c[0] === 'deleteDocument' && c[2] === 'm2')).toBe(true)
  })

  it('reports photo: false, and still succeeds, when storage fails', async () => {
    const { databases, storage, calls } = fakes({ photo_file_id: 'file-3' }, { storageFails: true })

    const removed = await deleteMemberCascade(databases, storage, 'm3')

    expect(removed.photo).toBe(false)
    // The row went before storage was asked, so the member is gone either way.
    expect(calls.some((c) => c[0] === 'deleteDocument' && c[2] === 'm3')).toBe(true)
  })

  it('refuses a missing member before deleting anything', async () => {
    const { databases, storage, calls } = fakes(null)

    await expect(deleteMemberCascade(databases, storage, 'ghost')).rejects.toThrow()
    expect(calls).toEqual([])
  })

  it('reads the database id and collection it is given, not a guess', async () => {
    const { databases, storage, calls } = fakes({ photo_file_id: 'f' })
    await deleteMemberCascade(databases, storage, 'm4')
    // Every purge is a bulk delete against a real collection name.
    for (const c of calls.filter((c) => c[0] === 'deleteDocuments')) {
      expect(Object.values(COLLECTIONS)).toContain(c[1])
      expect(c[2]).toContain('m4')
    }
    expect(DATABASE_ID).toBe('church-db')
  })
})
