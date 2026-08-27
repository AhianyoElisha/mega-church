'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { UserGroupIcon } from '@heroicons/react/24/outline'
import { Button } from '@/shared/Button'
import { Badge } from '@/shared/Badge'
import Input from '@/shared/Input'
import Select from '@/shared/Select'
import Textarea from '@/shared/Textarea'
import { Description, Field, Label } from '@/shared/fieldset'
import { Banner, Card, EmptyState, LoadingRow, PageHeader, PageWrap } from '@/components/ui'
import { useAuth } from '@/components/auth'
import {
  useBacentas,
  useCreateBacenta,
  useCreateBacentaCategory,
  useLeaderAccounts,
} from '@/lib/queries/groups'
import { buildBacentaTree } from '@/lib/groups/tree'
import type { BacentaWithCount } from '@/lib/groups/types'

/**
 * Bacentas — the work groups members serve in.
 *
 * Two shapes, both first-class:
 *
 *   categorised   "Choir" holding Biazo, Living Waters and Fresh Oil. The
 *                 category is a family, not a group — nobody is a member of
 *                 "Choir", they are a member of one of the choirs.
 *   standalone    "Technical Team" — no family, members directly under it.
 *
 * Creating either is the same form; leaving the category blank is what makes
 * it standalone.
 */
export default function BacentasPage() {
  const router = useRouter()
  const { user, ready } = useAuth()
  const isAdmin = user?.label === 'admin'
  const isShepherd = user?.label === 'shepherd'

  useEffect(() => {
    // A shepherd belongs here: these lists ARE the people's groups tab, and
    // reading them is the role. Only a leader is redirected, because for them
    // the full list is admin data their API refuses.
    if (ready && user && !isAdmin && !isShepherd) router.replace('/my-groups')
  }, [ready, user, isAdmin, isShepherd, router])

  const { data, isLoading } = useBacentas()
  const createBacenta = useCreateBacenta()
  const createCategory = useCreateBacentaCategory()
  const leaders = useLeaderAccounts()

  const [form, setForm] = useState<'none' | 'bacenta' | 'category'>('none')
  const [name, setName] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [description, setDescription] = useState('')
  const [head, setHead] = useState('')
  const [error, setError] = useState<string | null>(null)

  const tree = useMemo(() => {
    if (!data?.ok) return null
    return buildBacentaTree(data.categories, data.bacentas)
  }, [data])

  const reset = () => {
    setName('')
    setCategoryId('')
    setDescription('')
    setHead('')
    setError(null)
    setForm('none')
  }

  const submitBacenta = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    try {
      const res = await createBacenta.mutateAsync({
        name,
        category_id: categoryId || null,
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

  const submitCategory = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    try {
      const res = await createCategory.mutateAsync({
        name,
        description: description.trim() || null,
      })
      if (!res.ok) {
        setError(res.error)
        return
      }
      reset()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create that category.')
    }
  }

  const isEmpty =
    tree !== null &&
    tree.categories.length === 0 &&
    tree.standalone.length === 0 &&
    tree.orphans.length === 0

  return (
    <PageWrap>
      <PageHeader
        title="Bacentas"
        subtitle="The work groups members serve in. Someone can be in several at once."
        actions={
          <>
            <Button plain onClick={() => setForm(form === 'category' ? 'none' : 'category')}>
              New category
            </Button>
            <Button
              color="primary"
              onClick={() => setForm(form === 'bacenta' ? 'none' : 'bacenta')}
            >
              New bacenta
            </Button>
          </>
        }
      />

      {form === 'category' && (
        <Card className="mb-6">
          <form onSubmit={submitCategory} className="grid gap-4">
            <h2 className="text-base font-semibold text-neutral-950 dark:text-white">
              New category
            </h2>
            <p className="-mt-2 text-sm text-neutral-500 dark:text-neutral-400">
              A family of bacentas, like <strong>Choir</strong> over Biazo, Living Waters and
              Fresh Oil. Nobody is a member of a category — they join one of the bacentas inside
              it. If the group has no sub-groups, skip this and create a bacenta on its own.
            </p>
            <Field>
              <Label>Name</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Choir"
                autoFocus
                required
              />
            </Field>
            <Field>
              <Label>Description</Label>
              <Textarea
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </Field>
            {error && <Banner tone="error">{error}</Banner>}
            <div className="flex gap-3">
              <Button type="submit" color="primary" disabled={createCategory.isPending}>
                {createCategory.isPending ? 'Creating…' : 'Create category'}
              </Button>
              <Button type="button" plain onClick={reset}>
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      )}

      {form === 'bacenta' && (
        <Card className="mb-6">
          <form onSubmit={submitBacenta} className="grid gap-4">
            <h2 className="text-base font-semibold text-neutral-950 dark:text-white">
              New bacenta
            </h2>
            <Field>
              <Label>Name</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Living Waters"
                autoFocus
                required
              />
            </Field>
            <Field>
              <Label>Category</Label>
              <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                <option value="">— none, this is a group on its own —</option>
                {(data?.ok ? data.categories : []).map((c) => (
                  <option key={c.$id} value={c.$id}>
                    {c.name}
                  </option>
                ))}
              </Select>
              <Description>
                Leave this blank for a group like the Technical Team, which has members directly
                under it. Choose a category for one of several — Biazo under Choir.
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
                    {l.heads.length > 0 && ` — already heads ${l.heads.map((h) => h.name).join(', ')}`}
                  </option>
                ))}
              </Select>
              <Description>
                Only leader accounts appear here. A head who also runs a constituency uses the
                same login for both.
              </Description>
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
          icon={UserGroupIcon}
          title="No bacentas yet"
          message="Create a category like Choir and put the individual choirs inside it, or create a standalone group like the Technical Team."
          action={
            <Button color="primary" onClick={() => setForm('bacenta')}>
              New bacenta
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-8">
          {tree!.categories.map(({ category, bacentas }) => (
            <section key={category.$id}>
              <div className="mb-3 flex items-baseline gap-3">
                <h2 className="text-sm font-semibold tracking-wide text-neutral-500 uppercase dark:text-neutral-400">
                  {category.name}
                </h2>
                <span className="text-xs text-neutral-400">
                  {bacentas.length} bacenta{bacentas.length === 1 ? '' : 's'}
                </span>
              </div>
              {category.description && (
                <p className="mb-3 wrap-anywhere text-sm text-neutral-500 dark:text-neutral-400">
                  {category.description}
                </p>
              )}
              {bacentas.length === 0 ? (
                <Card>
                  <p className="text-sm text-neutral-500 dark:text-neutral-400">
                    Nothing in this category yet. Create a bacenta and choose{' '}
                    <strong>{category.name}</strong> as its category.
                  </p>
                </Card>
              ) : (
                <BacentaGrid bacentas={bacentas} />
              )}
            </section>
          ))}

          {tree!.standalone.length > 0 && (
            <section>
              <h2 className="mb-3 text-sm font-semibold tracking-wide text-neutral-500 uppercase dark:text-neutral-400">
                Groups on their own
              </h2>
              <BacentaGrid bacentas={tree!.standalone} />
            </section>
          )}

          {/*
            An orphan is a bacenta whose category was deleted out from under it.
            It is shown rather than hidden — it still holds real members, and a
            group that silently disappears from every screen is the failure this
            bucket exists to prevent.
          */}
          {tree!.orphans.length > 0 && (
            <section>
              <Banner tone="warning" className="mb-3">
                These bacentas point at a category that no longer exists. Edit each one and give
                it a category, or leave it standalone.
              </Banner>
              <BacentaGrid bacentas={tree!.orphans} />
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
          {/* `wrap-anywhere` on both: a bacenta name is free text up to 96
              characters and a description is free text with URLs in it. Either
              one, unbroken, was taking the whole page sideways on a phone
              rather than wrapping inside the card — measured 1043px in a 390px
              viewport. `line-clamp` does not help: it caps the HEIGHT, and the
              width floor is set before it applies. */}
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
