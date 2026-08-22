'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/shared/Button'
import { Description, Field, FieldGroup, Fieldset, Label, Legend } from '@/shared/fieldset'
import Input from '@/shared/Input'
import Textarea from '@/shared/Textarea'
import { Banner, Card, PageHeader, PageWrap } from '@/components/ui'
import MemberChecklist from '@/components/member-checklist'
import { useCreateMeeting } from '@/lib/queries/meetings'

export default function NewMeetingPage() {
  const router = useRouter()
  const create = useCreateMeeting()

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!name.trim()) {
      setError('Give the meeting a name.')
      return
    }
    // A meeting with nobody authorised would refuse every single person at the
    // door. Catch it here rather than at 6pm on the night.
    if (selected.size === 0) {
      setError('Tick at least one member. A meeting with nobody authorised cannot take attendance.')
      return
    }

    try {
      const res = await create.mutateAsync({
        name: name.trim(),
        description: description.trim() || null,
        member_ids: [...selected],
      })
      if (!res.ok) {
        setError(res.error)
        return
      }
      router.push('/meetings')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create that meeting.')
    }
  }

  return (
    <PageWrap className="max-w-4xl">
      <PageHeader
        back={{ href: '/meetings', label: 'Meetings' }}
        title="Create a meeting"
        subtitle="Choose who may attend. The list is saved, so reopening this meeting later needs no re-selecting."
      />

      <form onSubmit={handleSubmit}>
        <Card className="mb-6">
          <Fieldset>
            <FieldGroup>
              <Legend>Details</Legend>
              <Field>
                <Label>Name</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Youth Committee"
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
                  placeholder="What this meeting is for."
                />
                <Description>Optional.</Description>
              </Field>
            </FieldGroup>
          </Fieldset>
        </Card>

        <Card className="mb-6">
          <h2 className="mb-1 text-base font-semibold text-neutral-950 dark:text-white">
            Who can attend
          </h2>
          <p className="mb-5 text-sm text-neutral-500 dark:text-neutral-400">
            Tick every member authorised for this meeting. You can change this list at any time.
          </p>
          <MemberChecklist selected={selected} onChange={setSelected} />
        </Card>

        {error && (
          <Banner tone="error" className="mb-6" onDismiss={() => setError(null)}>
            {error}
          </Banner>
        )}

        <div className="flex gap-3">
          <Button type="submit" color="primary" disabled={create.isPending}>
            {create.isPending ? 'Creating…' : `Create meeting (${selected.size} authorised)`}
          </Button>
          <Button type="button" plain onClick={() => router.push('/meetings')}>
            Cancel
          </Button>
        </div>
      </form>
    </PageWrap>
  )
}
