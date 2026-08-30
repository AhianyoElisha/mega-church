'use client'

import { use, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/shared/Button'
import { Badge } from '@/shared/Badge'
import { Divider } from '@/shared/divider'
import { DescriptionDetails, DescriptionList, DescriptionTerm } from '@/shared/description-list'
import { Card, LoadingRow, PageHeader, PageWrap } from '@/components/ui'
import { useAuth } from '@/components/auth'
import { useDialog } from '@/components/dialog'
import MemberForm, { type MemberFormValues } from '@/components/member-form'
import MemberPhotoUpload from '@/components/member-photo-upload'
import FingerEnrolment from '@/components/finger-enrolment'
import { useDeleteMember, useMember, useUpdateMember } from '@/lib/queries/members'
import { useMemberHistory } from '@/lib/queries/attendance'
import { useBasontas, useConstituencies } from '@/lib/queries/groups'
import { birthdayLabel, fullName, initials } from '@/lib/members/types'

export default function MemberDetailPage({ params }: { params: Promise<{ id: string }> }) {
  // Next 16: route params are a promise, unwrapped with `use()` in a client
  // component.
  const { id } = use(params)
  const router = useRouter()
  const dialog = useDialog()
  const { user } = useAuth()

  const { data, isLoading } = useMember(id)
  const constituencies = useConstituencies()
  const basontaQuery = useBasontas()
  const history = useMemberHistory(id)
  const update = useUpdateMember()
  const remove = useDeleteMember()

  const [editing, setEditing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isAdmin = user?.label === 'admin'

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
        <PageHeader title="Member not found" subtitle="They may have been removed." />
        <Button outline href="/members">
          Back to members
        </Button>
      </PageWrap>
    )
  }

  const member = data.member
  const name = fullName(member)
  const basontaIds = data.basonta_ids ?? []

  // Resolved from the group lists rather than stored on the member: a renamed
  // constituency has to read correctly here without a migration.
  const constituencyName =
    constituencies.data?.ok
      ? (constituencies.data.constituencies.find((c) => c.$id === member.constituency_id)?.name ??
        null)
      : null
  const memberBasontas = basontaQuery.data?.ok
    ? basontaQuery.data.basontas.filter((b) => basontaIds.includes(b.$id))
    : []

  const handleSave = async (values: MemberFormValues) => {
    setError(null)
    try {
      const res = await update.mutateAsync({ id, ...values })
      if (!res.ok) {
        setError(res.error)
        return
      }
      setEditing(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.')
    }
  }

  const handleDelete = async () => {
    // Deleting destroys attendance history, which is the thing a church is
    // least able to reconstruct. Say so, and offer the reversible option.
    const ok = await dialog.confirm({
      title: `Delete ${name}?`,
      message:
        'This permanently removes their record, their fingerprints, their place on every ' +
        'meeting roster, and their entire attendance history. Marking them inactive keeps the ' +
        'history and stops them being matched — that is usually what you want.',
      confirmText: 'Delete permanently',
      tone: 'danger',
    })
    if (!ok) return
    await remove.mutateAsync({ id })
    router.push('/members')
  }

  const attended = history.data?.ok ? history.data.history.filter((h) => h.record) : []

  return (
    <PageWrap>
      <PageHeader
        back={{ href: '/members', label: 'Members' }}
        title={name}
        subtitle={member.status === 'active' ? 'Active member' : 'Inactive — cannot be matched by a scanner'}
        actions={
          <>
            {isAdmin && !editing && (
              <Button color="primary" onClick={() => setEditing(true)}>
                Edit details
              </Button>
            )}
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-1">
          <Card>
            <MemberPhotoUpload
              memberId={member.$id}
              photoFileId={member.photo_file_id}
              initials={initials(member)}
              name={name}
            />
            <Divider className="my-6" />
            <DescriptionList>
              {/* First, and in tabular figures: this is the number the church
                  reads out and writes on paper, so it has to be the thing the
                  eye lands on rather than something to hunt for. */}
              <DescriptionTerm>Member number</DescriptionTerm>
              <DescriptionDetails className="font-medium tabular-nums">
                {member.member_no ?? (
                  <span className="text-neutral-400">Not assigned</span>
                )}
              </DescriptionDetails>

              <DescriptionTerm>Call number</DescriptionTerm>
              <DescriptionDetails className="tabular-nums">{member.call_number}</DescriptionDetails>

              <DescriptionTerm>WhatsApp</DescriptionTerm>
              <DescriptionDetails className="tabular-nums">
                {member.whatsapp_number ?? <span className="text-neutral-400">Not given</span>}
              </DescriptionDetails>

              <DescriptionTerm>Birthday</DescriptionTerm>
              <DescriptionDetails>
                {birthdayLabel(member) ?? <span className="text-neutral-400">Not given</span>}
              </DescriptionDetails>

              <DescriptionTerm>Address</DescriptionTerm>
              <DescriptionDetails>
                {member.address ?? <span className="text-neutral-400">Not given</span>}
              </DescriptionDetails>

              <DescriptionTerm>Usual service</DescriptionTerm>
              <DescriptionDetails>
                {member.home_service === 'first' ? 'First Service (Psalms Chapel)' : 'Second Service'}
              </DescriptionDetails>

              <DescriptionTerm>Constituency</DescriptionTerm>
              <DescriptionDetails>
                {constituencyName ?? <span className="text-neutral-400">Not recorded</span>}
              </DescriptionDetails>

              <DescriptionTerm>Bacentas</DescriptionTerm>
              <DescriptionDetails>
                {memberBasontas.length === 0 ? (
                  <span className="text-neutral-400">None</span>
                ) : (
                  <span className="flex flex-wrap gap-1.5 wrap-anywhere">
                    {memberBasontas.map((b) => (
                      <Badge key={b.$id} color="yellow">
                        {b.category_name ? `${b.category_name} · ${b.name}` : b.name}
                      </Badge>
                    ))}
                  </span>
                )}
              </DescriptionDetails>
            </DescriptionList>
            <p className="mt-4 text-xs text-neutral-400 dark:text-neutral-500">
              The usual service is a note, not a rule — {member.first_name} can be marked present
              at either service.
            </p>
          </Card>
        </div>

        <div className="flex flex-col gap-6 lg:col-span-2">
          {editing && isAdmin ? (
            <Card>
              <h2 className="mb-5 text-base font-semibold text-neutral-950 dark:text-white">
                Edit details
              </h2>
              <MemberForm
                initial={member}
                initialBasontaIds={basontaIds}
                submitLabel="Save changes"
                submitting={update.isPending}
                error={error}
                onSubmit={handleSave}
                onCancel={() => {
                  setError(null)
                  setEditing(false)
                }}
              />
            </Card>
          ) : (
            isAdmin && <FingerEnrolment memberId={member.$id} memberName={name} />
          )}

          <Card>
            <h2 className="mb-4 text-base font-semibold text-neutral-950 dark:text-white">
              Attendance
            </h2>
            {history.isLoading ? (
              <LoadingRow />
            ) : attended.length === 0 ? (
              <p className="text-sm text-neutral-500 dark:text-neutral-400">
                No recorded attendance yet.
              </p>
            ) : (
              <>
                <p className="mb-4 text-sm text-neutral-500 dark:text-neutral-400">
                  Present at {attended.length} of the last{' '}
                  {history.data?.ok ? history.data.history.length : 0} sessions.
                </p>
                <ul className="flex flex-col gap-2">
                  {(history.data?.ok ? history.data.history : []).slice(0, 12).map((h) => (
                    <li
                      key={h.occurrence.$id}
                      className="flex items-center justify-between gap-3 rounded-xl bg-neutral-50 px-3 py-2.5 text-sm dark:bg-neutral-700/40"
                    >
                      <span className="min-w-0 truncate text-neutral-800 dark:text-neutral-200">
                        {h.meeting_name}
                      </span>
                      <span className="shrink-0 text-neutral-400 tabular-nums">
                        {h.occurrence.occurrence_date}
                      </span>
                      <Badge color={h.record ? 'green' : 'zinc'}>
                        {h.record ? 'Present' : 'Absent'}
                      </Badge>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Card>

          {isAdmin && (
            <Card>
              <h2 className="text-base font-semibold text-neutral-950 dark:text-white">
                Danger zone
              </h2>
              <p className="mt-1 mb-4 text-sm text-neutral-500 dark:text-neutral-400">
                To stop someone being matched without losing their history, set their status to
                inactive in Edit details instead.
              </p>
              <Button color="red" onClick={handleDelete} disabled={remove.isPending}>
                {remove.isPending ? 'Deleting…' : 'Delete this member'}
              </Button>
            </Card>
          )}
        </div>
      </div>
    </PageWrap>
  )
}
