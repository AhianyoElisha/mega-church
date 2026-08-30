'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { MapPinIcon } from '@heroicons/react/24/outline'
import { Button } from '@/shared/Button'
import { Badge } from '@/shared/Badge'
import Input from '@/shared/Input'
import Select from '@/shared/Select'
import Textarea from '@/shared/Textarea'
import { Description, Field, Label } from '@/shared/fieldset'
import { Banner, Card, EmptyState, LoadingRow, PageHeader, PageWrap } from '@/components/ui'
import { useAuth } from '@/components/auth'
import { useBacentas, useCreateBacenta, useLeaderAccounts } from '@/lib/queries/groups'
import { buildBacentaTree } from '@/lib/groups/tree'
import type { BacentaWithCount } from '@/lib/groups/types'

/**
 * Bacentas — the PLACES members live in, grouped by constituency.
 *
 * This page used to list the serving groups (choir, technical team) under their
 * categories. Those are `/basontas` now. A bacenta is Anloga, Susuankyi,
 * Oforikrom: a part of a constituency, and a member belongs to exactly one —
 * which is why there is no tick-list here and why assigning MOVES somebody.
 */
export default function BacentasPage() {
  const router = useRouter()
  const { user, ready } = useAuth()
  const isAdmin = user?.label === 'admin'
  const isShepherd = user?.label === 'shepherd'

  useEffect(() => {
    if (ready && user && !isAdmin && !isShepherd) router.replace('/my-groups')
  }, [ready, user, isAdmin, isShepherd, router])

  const { data, isLoading } = useBacentas()
  const createBacenta = useCreateBacenta()
  const leaders = useLeaderAccounts()

  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [constituencyId, setConstituencyId] = useState('')
  const [description, setDescription] = useState('')
  const [head, setHead] = useState('')
  const [error, setError] = useState<string | null>(null)

  const tree = useMemo(() => {
    if (!data?.ok) return null
    return buildBacentaTree(data.constituencies, data.bacentas)
  }, [data])

  const reset = () => {
    setName('')
    setConstituencyId('')
    setDescription('')
    setHead('')
    setError(null)
    setShowForm(false)
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    try {
      const res = await createBacenta.mutateAsync({
        name,
        constituency_id: constituencyId || null,
        description: description.trim() || null,
        head_user_id: head || null,
      })
      if (!res.ok) {
        setError(res.error)
        return
      }
      reset()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create that bacenta.')
    }
  }

  const isEmpty =
    tree !== null && tree.constituencies.every((c) => c.bacentas.length === 0) && tree.unfiled.length === 0

  return (
    <PageWrap>
      <PageHeader
        title="Bacentas"
        subtitle="The places members live, inside their constituency. Everyone belongs to one."
        actions={
          <Button color="primary" onClick={() => setShowForm((v) => !v)}>
            New bacenta
          </Button>
        }
      />

      {showForm && (
        <Card className="mb-6">
          <form onSubmit={submit} className="grid gap-4">
            <h2 className="text-base font-semibold text-neutral-950 dark:text-white">
              New bacenta
            </h2>
            <Field>
              <Label>Name</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Anloga Bacenta"
                autoFocus
                required
              />
            </Field>
            <Field>
              <Label>Constituency</Label>
              <Select
                value={constituencyId}
                onChange={(e) => setConstituencyId(e.target.value)}
              >
                <option value="">— not decided yet —</option>
                {(data?.ok ? data.constituencies : []).map((c) => (
                  <option key={c.$id} value={c.$id}>
                    {c.name}
                  </option>
                ))}
              </Select>
              <Description>
                A bacenta is a part of one constituency. Names only have to be unique within
                it — two constituencies may each have a place the congregation calls the same
                thing.
              </Description>
            </Field>
            <Field>
              <Label>Description</Label>
              <Textarea
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </Field>
            <Field>
              <Label>Head</Label>
              <Select value={head} onChange={(e) => setHead(e.target.value)}>
                <option value="">— no head yet —</option>
                {(leaders.data?.ok ? leaders.data.leaders : []).map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                    {l.heads.length > 0 &&
                      ` — already heads ${l.heads.map((h) => h.name).join(', ')}`}
                  </option>
                ))}
              </Select>
            </Field>
            {error && <Banner tone="error">{error}</Banner>}
            <div className="flex gap-3">
              <Button type="submit" color="primary" disabled={createBacenta.isPending}>
                {createBacenta.isPending ? 'Creating…' : 'Create bacenta'}
              </Button>
              <Button type="button" plain onClick={reset}>
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      )}

      {isLoading ? (
        <Card padded={false}>
          <LoadingRow label="Loading bacentas…" />
        </Card>
      ) : isEmpty ? (
        <EmptyState
          icon={MapPinIcon}
          title="No bacentas yet"
          message="A bacenta is a place inside a constituency — Anloga, Susuankyi. Create one and file members into it."
          action={
            <Button color="primary" onClick={() => setShowForm(true)}>
              New bacenta
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-8">
          {tree!.constituencies.map(({ constituency, bacentas }) => (
            <section key={constituency.$id}>
              <div className="mb-3 flex items-baseline gap-3">
                <h2 className="text-sm font-semibold tracking-wide text-neutral-500 uppercase dark:text-neutral-400">
                  {constituency.name}
                </h2>
                <span className="text-xs text-neutral-400">
                  {bacentas.length} bacenta{bacentas.length === 1 ? '' : 's'}
                </span>
              </div>
              {bacentas.length === 0 ? (
                <Card>
                  <p className="text-sm text-neutral-500 dark:text-neutral-400">
                    No places in <strong>{constituency.name}</strong> yet.
                  </p>
                </Card>
              ) : (
                <BacentaGrid bacentas={bacentas} />
              )}
            </section>
          ))}

          {/*
            Shown, never hidden. A bacenta with no constituency is either one the
            migration has not reached or one whose constituency was deleted — and
            a place full of real people that vanishes from every screen is the
            failure this bucket exists to prevent.
          */}
          {tree!.unfiled.length > 0 && (
            <section>
              <Banner tone="warning" className="mb-3">
                These bacentas are not in a constituency yet. Open each one and choose which
                constituency it belongs to.
              </Banner>
              <BacentaGrid bacentas={tree!.unfiled} />
            </section>
          )}
        </div>
      )}
    </PageWrap>
  )
}

function BacentaGrid({ bacentas }: { bacentas: BacentaWithCount[] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {bacentas.map((b) => (
        <Link
          key={b.$id}
          href={`/bacentas/${b.$id}`}
          className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-neutral-900/5 transition hover:ring-primary-500/50 dark:bg-neutral-800 dark:ring-white/10"
        >
          {/* `wrap-anywhere` on both: a name is free text up to 96 characters
              and a description is free text with URLs in it. Either one,
              unbroken, took the whole page sideways on a phone — measured
              1043px in a 390px viewport. */}
          <p className="wrap-anywhere font-semibold text-neutral-950 dark:text-white">{b.name}</p>
          {b.description && (
            <p className="mt-1 line-clamp-2 wrap-anywhere text-sm text-neutral-500 dark:text-neutral-400">
              {b.description}
            </p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Badge color={b.member_count > 0 ? 'green' : 'zinc'}>
              {b.member_count === 0
                ? 'Nobody yet'
                : `${b.member_count} member${b.member_count === 1 ? '' : 's'}`}
            </Badge>
            {b.head_name ? (
              <span className="text-xs text-neutral-500 dark:text-neutral-400">
                Head: {b.head_name}
              </span>
            ) : (
              <span className="text-xs text-neutral-400">No head yet</span>
            )}
          </div>
        </Link>
      ))}
    </div>
  )
}
