'use client'

// Appointing the head of a constituency or a bacenta.
//
// This is the half of the feature that was missing. The create dialogs on both
// list pages already had a Head dropdown and both PATCH routes already accepted
// `head_user_id` — but there was nowhere to CHANGE a head after the group
// existed, and no way at all to create the `leader` account the dropdown lists.
// A church that had never opened the Appwrite console therefore saw an empty
// dropdown and reasonably concluded heads were not implemented.
//
// So both live here, in one flow: pick an existing leader, or create the login
// and appoint them in the same breath.

import { useState } from 'react'
import { UserPlusIcon } from '@heroicons/react/24/outline'
import { Button } from '@/shared/Button'
import Input from '@/shared/Input'
import Select from '@/shared/Select'
import { Description, Field, Label } from '@/shared/fieldset'
import { Banner, Card } from '@/components/ui'
import { useDialog } from '@/components/dialog'
import { useCreateLeader, useLeaderAccounts } from '@/lib/queries/groups'

export type HeadCardProps = {
  kind: 'constituency' | 'bacenta'
  groupName: string
  headUserId: string | null
  headName: string | null
  busy?: boolean
  /** `null` removes the head. The caller PATCHes and both `head_user_id` and
   *  `head_name` are rewritten together by the route — writing one without the
   *  other leaves the page naming the wrong person. */
  onAppoint: (headUserId: string | null) => Promise<void>
}

export default function HeadCard({
  kind,
  groupName,
  headUserId,
  headName,
  busy,
  onAppoint,
}: HeadCardProps) {
  const leaders = useLeaderAccounts()
  const createLeader = useCreateLeader()
  const { confirm } = useDialog()

  const [selected, setSelected] = useState(headUserId ?? '')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // The inline "create a login" form.
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [newPassword, setNewPassword] = useState<{ email: string; password: string } | null>(null)

  const accounts = leaders.data?.ok ? leaders.data.leaders : []
  const dirty = (selected || null) !== (headUserId ?? null)

  const save = async () => {
    setError(null)
    setNotice(null)
    try {
      await onAppoint(selected || null)
      setNotice(
        selected
          ? `${accounts.find((a) => a.id === selected)?.name ?? 'That account'} now heads ${groupName}.`
          : `${groupName} has no head.`,
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save that.')
    }
  }

  const removeHead = async () => {
    const ok = await confirm({
      title: `Remove ${headName ?? 'the head'}?`,
      message: (
        <>
          Their account is <strong>not</strong> deleted — they simply stop seeing {groupName}. If
          they head nothing else, their My groups page will be empty, which is a normal state and
          not an error.
        </>
      ),
      confirmText: 'Remove head',
      tone: 'danger',
    })
    if (!ok) return
    setSelected('')
    setError(null)
    try {
      await onAppoint(null)
      setNotice(`${groupName} has no head.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove the head.')
    }
  }

  const submitNewLeader = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    const res = await createLeader.mutateAsync({ name, email })
    if (!res.ok) {
      setError(res.error)
      return
    }
    // Shown ONCE. There is no forgot-password flow in this app, so this is the
    // only time this string exists anywhere outside the account itself.
    setNewPassword({ email: res.leader.email, password: res.password })
    setSelected(res.leader.id)
    setCreating(false)
    setName('')
    setEmail('')
  }

  return (
    <Card className="mb-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-neutral-950 dark:text-white">Head</h2>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            {headName ? (
              <>
                <strong className="text-neutral-950 dark:text-white">{headName}</strong> heads this{' '}
                {kind}. They see these members read-only — details, birthdays and attendance.
              </>
            ) : (
              <>
                Nobody heads this {kind} yet. A head signs in and sees only their own members,
                read-only.
              </>
            )}
          </p>
        </div>
        {headUserId && (
          <Button plain onClick={removeHead} disabled={busy}>
            Remove head
          </Button>
        )}
      </div>

      {newPassword && (
        <Banner tone="warning" className="mt-4" onDismiss={() => setNewPassword(null)}>
          <p className="font-semibold">Copy this password now — it is not shown again.</p>
          <p className="mt-1">
            <span className="font-mono">{newPassword.email}</span>
            {' · '}
            <span className="font-mono text-base">{newPassword.password}</span>
          </p>
          <p className="mt-1 text-xs">
            There is no password reset in this app. If it is lost, set a new one for this account
            in the Appwrite console.
          </p>
        </Banner>
      )}

      {creating ? (
        <form onSubmit={submitNewLeader} className="mt-5 grid gap-4 sm:max-w-md">
          <Field>
            <Label>Their name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} required />
          </Field>
          <Field>
            <Label>Email to sign in with</Label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <Description>
              A password is generated for you and shown once. The email is only a username — the
              app never sends to it.
            </Description>
          </Field>
          {error && <Banner tone="error">{error}</Banner>}
          <div className="flex gap-3">
            <Button type="submit" color="primary" disabled={createLeader.isPending}>
              {createLeader.isPending ? 'Creating…' : 'Create the login'}
            </Button>
            <Button
              type="button"
              plain
              onClick={() => {
                setCreating(false)
                setError(null)
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div className="mt-5 grid gap-4 sm:max-w-md">
          <Field>
            <Label>Appoint a head</Label>
            <Select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              disabled={leaders.isLoading}
            >
              <option value="">— no head —</option>
              {accounts.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                  {l.heads.length > 0 &&
                    ` — already heads ${l.heads.map((h) => h.name).join(', ')}`}
                </option>
              ))}
            </Select>
            <Description>
              {accounts.length === 0 ? (
                <>
                  There are no leader accounts yet. Create one below — that is all a head needs to
                  sign in.
                </>
              ) : (
                <>
                  Only leader accounts appear here. Somebody who heads a constituency{' '}
                  <em>and</em> a bacenta uses the same login for both.
                </>
              )}
            </Description>
          </Field>

          {error && <Banner tone="error">{error}</Banner>}
          {notice && (
            <Banner tone="success" onDismiss={() => setNotice(null)}>
              {notice}
            </Banner>
          )}

          <div className="flex flex-wrap gap-3">
            <Button color="primary" onClick={save} disabled={!dirty || busy}>
              {busy ? 'Saving…' : 'Save head'}
            </Button>
            <Button outline onClick={() => setCreating(true)}>
              <UserPlusIcon data-slot="icon" />
              New leader account
            </Button>
          </div>
        </div>
      )}
    </Card>
  )
}
