'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { MapPinIcon } from '@heroicons/react/24/outline'
import { Button } from '@/shared/Button'
import { Badge } from '@/shared/Badge'
import Input from '@/shared/Input'
import Select from '@/shared/Select'
import Textarea from '@/shared/Textarea'
import { Description, Field, Label } from '@/shared/fieldset'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/table'
import { Banner, Card, EmptyState, LoadingRow, PageHeader, PageWrap } from '@/components/ui'
import { useAuth } from '@/components/auth'
import { useConstituencies, useCreateConstituency, useLeaderAccounts } from '@/lib/queries/groups'

/**
 * Constituencies — where members LIVE.
 *
 * The list is deliberately plain: four rows, a count each, and a way in. The
 * work happens on the detail page, where members are assigned in bulk.
 */
export default function ConstituenciesPage() {
  const router = useRouter()
  const { user, ready } = useAuth()
  const isAdmin = user?.label === 'admin'

  // The proxy lets a head reach `/constituencies/*` so they can open the group
  // they head. This list is not theirs to browse — `/api/constituencies`
  // already refuses them a 403, so this is only about landing them somewhere
  // useful instead of on an error.
  useEffect(() => {
    if (ready && user && !isAdmin) router.replace('/my-groups')
  }, [ready, user, isAdmin, router])

  const { data, isLoading } = useConstituencies()
  const create = useCreateConstituency()
  const leaders = useLeaderAccounts()

  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [head, setHead] = useState('')
  const [error, setError] = useState<string | null>(null)

  const rows = data?.ok ? data.constituencies : []
  const unassignedHint = rows.length > 0

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    try {
      const res = await create.mutateAsync({
        name,
        description: description.trim() || null,
        head_user_id: head || null,
      })
      if (!res.ok) {
        setError(res.error)
        return
      }
      setName('')
      setDescription('')
      setHead('')
      setShowForm(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create that constituency.')
    }
  }

  return (
    <PageWrap>
      <PageHeader
        title="Constituencies"
        subtitle="Where members live. Everyone belongs to exactly one."
        actions={
          <Button color="primary" onClick={() => setShowForm((v) => !v)}>
            {showForm ? 'Cancel' : 'New constituency'}
          </Button>
        }
      />

      {showForm && (
        <Card className="mb-6">
          <form onSubmit={submit} className="grid gap-4">
            <Field>
              <Label>Name</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ahodwo"
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
                placeholder="Which areas this covers, if it helps."
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
                Only leader accounts appear here. The head signs in and sees this constituency&rsquo;s
                members — and nothing else. The same person can head a bacenta too, on the same
                login.
              </Description>
            </Field>

            {error && <Banner tone="error">{error}</Banner>}

            <div className="flex gap-3">
              <Button type="submit" color="primary" disabled={create.isPending}>
                {create.isPending ? 'Creating…' : 'Create constituency'}
              </Button>
              <Button type="button" plain onClick={() => setShowForm(false)}>
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      )}

      {isLoading ? (
        <Card padded={false}>
          <LoadingRow label="Loading constituencies…" />
        </Card>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={MapPinIcon}
          title="No constituencies yet"
          message="Create the first one, then assign members to it in bulk from its page."
          action={
            <Button color="primary" onClick={() => setShowForm(true)}>
              New constituency
            </Button>
          }
        />
      ) : (
        <>
          <Table grid striped>
            <TableHead>
              <TableRow>
                <TableHeader>Constituency</TableHeader>
                <TableHeader>Head</TableHeader>
                <TableHeader>Members</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((c) => (
                <TableRow key={c.$id} href={`/constituencies/${c.$id}`}>
                  <TableCell>
                    <span className="block font-medium text-neutral-950 dark:text-white">
                      {c.name}
                    </span>
                    {c.description && (
                      <span className="block truncate text-xs text-neutral-500 dark:text-neutral-400">
                        {c.description}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    {c.head_name ? (
                      c.head_name
                    ) : (
                      // Colour and a word, never colour alone (PRD §2.4).
                      <Badge color="zinc">No head yet</Badge>
                    )}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {c.member_count === 0 ? (
                      <span className="text-neutral-400">Nobody yet</span>
                    ) : (
                      `${c.member_count} member${c.member_count === 1 ? '' : 's'}`
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {unassignedHint && (
            <p className="mt-4 text-sm text-neutral-500 dark:text-neutral-400">
              Members registered before constituencies existed have none yet. Open a
              constituency and use <strong>No constituency yet</strong> in its filter to find
              and assign them in one go.
            </p>
          )}
        </>
      )}
    </PageWrap>
  )
}
