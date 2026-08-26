'use client'

import { use, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/components/auth'
import { Button } from '@/shared/Button'
import { Badge } from '@/shared/Badge'
import { Field, FieldGroup, Fieldset, Label, Legend } from '@/shared/fieldset'
import Input from '@/shared/Input'
import Textarea from '@/shared/Textarea'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/table'
import { Banner, Card, LoadingRow, PageHeader, PageWrap } from '@/components/ui'
import { useDialog } from '@/components/dialog'
import MemberChecklist from '@/components/member-checklist'
import { useMeeting, useUpdateMeeting } from '@/lib/queries/meetings'
import {
  useActivateOccurrence,
  useActiveSession,
  useCloseOccurrence,
  useOccurrences,
} from '@/lib/queries/occurrences'
import { apiFetch } from '@/lib/queries/fetcher'

export default function MeetingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  // A shepherd reads this page — the roster IS data worth reading, "who is
  // authorised for this meeting". Every control on it belongs to an admin.
  const { user } = useAuth()
  const canAct = user?.label === 'admin'
  const dialog = useDialog()

  const { data, isLoading } = useMeeting(id)
  const history = useOccurrences(id)
  const active = useActiveSession()
  const update = useUpdateMeeting()
  const activate = useActivateOccurrence()
  const close = useCloseOccurrence()

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  // Seed the editor from the server once loaded. The roster arrives already
  // populated, which is the point — reopening a meeting requires no
  // re-selection (PRD §1.4).
  useEffect(() => {
    if (!data?.ok) return
    setName(data.meeting.name)
    setDescription(data.meeting.description ?? '')
    setSelected(new Set(data.member_ids))
    setDirty(false)
  }, [data])

  if (isLoading) {
    return (
      <PageWrap>
        <Card padded={false}>
          <LoadingRow />
        </Card>
      </PageWrap>
    )
  }
  if (!data?.ok) {
    return (
      <PageWrap>
        <PageHeader title="Meeting not found" />
        <Button outline href="/meetings">
          Back to meetings
        </Button>
      </PageWrap>
    )
  }

  const meeting = data.meeting
  const isService = meeting.kind === 'service'
  const session = active.data?.ok ? active.data.session : null
  const isOpen = session?.meeting.$id === meeting.$id

  const save = async () => {
    setError(null)
    setSaved(false)
    try {
      const res = await update.mutateAsync({
        id,
        name: name.trim(),
        description: description.trim() || null,
        // Services have no roster; sending one is rejected by the API.
        ...(isService ? {} : { member_ids: [...selected] }),
      })
      if (!res.ok) {
        setError(res.error)
        return
      }
      setDirty(false)
      setSaved(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.')
    }
  }

  const handleActivate = async () => {
    setError(null)
    const res = await activate.mutateAsync({ meeting_id: id }).catch((e: Error) => {
      setError(e.message)
      return null
    })
    if (res && !res.ok) setError(res.error)
  }

  const handleClose = async () => {
    if (!session) return
    const ok = await dialog.confirm({
      title: `End ${meeting.name}?`,
      message: 'Attendance will be frozen and kiosks will stop accepting scans.',
      confirmText: 'End session',
      tone: 'danger',
    })
    if (!ok) return
    await close.mutateAsync({ occurrence_id: session.occurrence.$id })
  }

  const handleDelete = async () => {
    const ok = await dialog.confirm({
      title: `Delete ${meeting.name}?`,
      message:
        'This removes the meeting, its authorised list, and every attendance record ever taken ' +
        'for it. Archiving keeps the history and just hides it from the activate list.',
      confirmText: 'Delete permanently',
      tone: 'danger',
    })
    if (!ok) return
    try {
      await apiFetch(`/api/meetings/${encodeURIComponent(id)}`, { method: 'DELETE' })
      router.push('/meetings')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete.')
    }
  }

  const occurrences = history.data?.ok ? history.data.occurrences : []

  return (
    <PageWrap className="max-w-4xl">
      <PageHeader
        back={{ href: '/meetings', label: 'Meetings' }}
        title={meeting.name}
        subtitle={
          isService
            ? 'A Sunday service — open to every active member.'
            : `${selected.size} member${selected.size === 1 ? '' : 's'} authorised.`
        }
        actions={
          <>
            {!canAct ? null : isOpen ? (
              <Button color="red" onClick={handleClose} disabled={close.isPending}>
                End session
              </Button>
            ) : (
              <Button
                color="primary"
                onClick={handleActivate}
                disabled={!!session || activate.isPending || (!isService && selected.size === 0)}
              >
                Activate
              </Button>
            )}
          </>
        }
      />

      {session && !isOpen && (
        <Banner tone="warning" className="mb-6">
          {session.meeting.name} is open. End it before activating this one — only one session
          runs at a time.
        </Banner>
      )}
      {error && (
        <Banner tone="error" className="mb-6" onDismiss={() => setError(null)}>
          {error}
        </Banner>
      )}
      {saved && (
        <Banner tone="success" className="mb-6" onDismiss={() => setSaved(false)}>
          Saved.
        </Banner>
      )}

      <Card className="mb-6">
        <Fieldset>
          <FieldGroup>
            <Legend>Details</Legend>
            <Field>
              <Label>Name</Label>
              <Input
                value={name}
                onChange={(e) => {
                  setName(e.target.value)
                  setDirty(true)
                }}
              />
            </Field>
            <Field>
              <Label>Description</Label>
              <Textarea
                rows={2}
                value={description}
                onChange={(e) => {
                  setDescription(e.target.value)
                  setDirty(true)
                }}
              />
            </Field>
          </FieldGroup>
        </Fieldset>
      </Card>

      {!isService && (
        <Card className="mb-6">
          <h2 className="mb-1 text-base font-semibold text-neutral-950 dark:text-white">
            Who can attend
          </h2>
          <p className="mb-5 text-sm text-neutral-500 dark:text-neutral-400">
            Edit the list at any time. Changes take effect on the next scan.
          </p>
          <MemberChecklist
            selected={selected}
            readOnly={!canAct}
            onChange={(next) => {
              setSelected(next)
              setDirty(true)
            }}
          />
        </Card>
      )}

      <div className="mb-10 flex gap-3">
        {canAct && (
          <Button color="primary" onClick={save} disabled={!dirty || update.isPending}>
            {update.isPending ? 'Saving…' : 'Save changes'}
          </Button>
        )}
        {dirty && (
          <span className="self-center text-sm text-neutral-500 dark:text-neutral-400">
            Unsaved changes
          </span>
        )}
      </div>

      <h2 className="mb-3 text-sm font-semibold tracking-wide text-neutral-500 uppercase dark:text-neutral-400">
        Past sessions
      </h2>
      {occurrences.length === 0 ? (
        <Card>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            This meeting has not been held yet.
          </p>
        </Card>
      ) : (
        <Table grid striped>
          <TableHead>
            <TableRow>
              <TableHeader>Date</TableHeader>
              <TableHeader>Present</TableHeader>
              <TableHeader>Status</TableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            {occurrences.map((o) => (
              <TableRow key={o.$id}>
                <TableCell className="tabular-nums">{o.occurrence_date}</TableCell>
                <TableCell className="tabular-nums">{o.present_count}</TableCell>
                <TableCell>
                  <Badge color={o.status === 'open' ? 'green' : 'zinc'}>
                    {o.status === 'open' ? 'Open' : 'Closed'}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {!isService && canAct && (
        <Card className="mt-10">
          <h2 className="text-base font-semibold text-neutral-950 dark:text-white">Danger zone</h2>
          <p className="mt-1 mb-4 text-sm text-neutral-500 dark:text-neutral-400">
            Deleting also removes every attendance record for this meeting.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button outline onClick={() => update.mutate({ id, archived: !meeting.archived })}>
              {meeting.archived ? 'Restore' : 'Archive'}
            </Button>
            <Button color="red" onClick={handleDelete}>
              Delete this meeting
            </Button>
          </div>
        </Card>
      )}
    </PageWrap>
  )
}
