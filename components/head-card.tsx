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
import { KeyIcon, UserPlusIcon } from '@heroicons/react/24/outline'
import { Button } from '@/shared/Button'
import Input from '@/shared/Input'
import Select from '@/shared/Select'
import { Description, Field, Label } from '@/shared/fieldset'
import { Banner, Card } from '@/components/ui'
import { useDialog } from '@/components/dialog'
import type { GroupKind } from '@/lib/groups/types'
import { useCreateLeader, useLeaderAccounts, useSetLeaderPassword } from '@/lib/queries/groups'

export type HeadCardProps = {
  kind: GroupKind
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
  const setPassword = useSetLeaderPassword()
  const { confirm } = useDialog()

  const [selected, setSelected] = useState(headUserId ?? '')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // The inline "create a login" form.
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [chosenPassword, setChosenPassword] = useState('')
  const [newPassword, setNewPassword] = useState<{ email: string; password: string } | null>(null)

  // The inline "change this head's password" form.
  const [changing, setChanging] = useState(false)
  const [replacement, setReplacement] = useState('')

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
    const res = await createLeader.mutateAsync({
      name,
      email,
      // Blank means "generate a readable one for me", which is what most
      // admins want and what the field's own hint says.
      ...(chosenPassword.trim() ? { password: chosenPassword.trim() } : {}),
    })
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
    setChosenPassword('')
  }

  const submitPasswordChange = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!headUserId) return
    const res = await setPassword.mutateAsync({
      id: headUserId,
      ...(replacement.trim() ? { password: replacement.trim() } : {}),
    })
    if (!res.ok) {
      setError(res.error)
      return
    }
    setNewPassword({ email: res.email, password: res.password })
    setChanging(false)
    setReplacement('')
    setNotice(`${res.name} has a new password. Copy it before closing this page.`)
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
            It is not stored anywhere. If it is lost, use{' '}
            <strong>Change password</strong> here to set another — no need for the Appwrite
            console.
          </p>
        </Banner>
      )}

      {changing ? (
        <form onSubmit={submitPasswordChange} className="mt-5 grid gap-4 sm:max-w-md">
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            Setting a new password for <strong>{headName}</strong>. They are signed out of nothing —
            existing sessions keep working until they end — so tell them before they next need to
            sign in.
          </p>
          <Field>
            <Label>New password</Label>
            <Input
              value={replacement}
              onChange={(e) => setReplacement(e.target.value)}
              placeholder="Leave blank to generate one"
              autoComplete="new-password"
            />
            <Description>
              At least 8 characters. Blank generates a readable one. It is shown once and is not
              stored, so copy it before closing.
            </Description>
          </Field>
          {error && <Banner tone="error">{error}</Banner>}
          <div className="flex gap-3">
            <Button type="submit" color="primary" disabled={setPassword.isPending}>
              {setPassword.isPending ? 'Changing…' : 'Set new password'}
            </Button>
            <Button
              type="button"
              plain
              onClick={() => {
                setChanging(false)
                setReplacement('')
                setError(null)
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : creating ? (
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
              The email is only a username — the app never sends anything to it.
            </Description>
          </Field>
          <Field>
            <Label>Password</Label>
            <Input
              value={chosenPassword}
              onChange={(e) => setChosenPassword(e.target.value)}
              placeholder="Leave blank to generate one"
              autoComplete="new-password"
            />
            <Description>
              Blank generates a readable one — no look-alike characters, because this gets read
              down a phone line. Either way it is shown once and can be changed later.
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
            {headUserId && (
              <Button plain onClick={() => setChanging(true)}>
                <KeyIcon data-slot="icon" />
                Change password
              </Button>
            )}
          </div>
        </div>
      )}
    </Card>
  )
}
