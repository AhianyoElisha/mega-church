'use client'

// One member, as their group head sees them: correctable.
//
// Under `/my-groups` and not `/members/[id]` on purpose. That page carries
// Delete, the status control and the four-finger enrolment panel, none of which
// a head may touch — and the way to keep it that way is not to add three
// `isAdmin` branches to it, it is to give a head their own door. This one works
// for a member of a constituency they head OR a bacenta they head, which is why
// it hangs off `/my-groups` rather than off either group's page.

import { use, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Banner, Card, LoadingRow, PageHeader, PageWrap } from '@/components/ui'
import { Button } from '@/shared/Button'
import MemberForm, { type MemberFormValues } from '@/components/member-form'
import MemberPhotoUpload from '@/components/member-photo-upload'
import { useMember, useUpdateMember } from '@/lib/queries/members'
import { useMyGroups } from '@/lib/queries/groups'
import { fullName, initials } from '@/lib/members/types'

export default function HeadMemberPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()

  const { data, isLoading, error } = useMember(id)
  const myGroups = useMyGroups()
  const update = useUpdateMember()

  const [saveError, setSaveError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  if (isLoading) {
    return (
      <PageWrap>
        <Card padded={false}>
          <LoadingRow />
        </Card>
      </PageWrap>
    )
  }

  // A head who follows a link to somebody outside their groups lands here. The
  // server's own wording says why; repeating it beats a generic failure.
  if (error || !data?.ok) {
    return (
      <PageWrap>
        <Banner tone="error">
          {error instanceof Error
            ? error.message
            : ((data as { error?: string })?.error ?? 'Could not load that member.')}
        </Banner>
        <div className="mt-6">
          <Button plain href="/my-groups">
            Back to my groups
          </Button>
        </div>
      </PageWrap>
    )
  }

  const member = data.member
  // The head's tick-list is their BASONTAS — the serving groups. A bacenta is
  // a place and is one per member, set by an administrator, so it is not a
  // list to tick here at all.
  const basontas = myGroups.data?.ok ? myGroups.data.basontas : []

  const handleSubmit = async (values: MemberFormValues) => {
    setSaveError(null)
    setSaved(false)
    try {
      const res = await update.mutateAsync({ id, ...values })
      if (!res.ok) {
        setSaveError(res.error)
        return
      }
      setSaved(true)
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Could not save those changes.')
    }
  }

  return (
    <PageWrap className="max-w-3xl">
      <PageHeader
        back={{ href: '/my-groups', label: 'My groups' }}
        title={fullName(member)}
        subtitle="Correct their details. Fingerprints and membership status stay with an administrator."
      />

      {saved && (
        <div className="mb-6">
          <Banner tone="success">Saved.</Banner>
        </div>
      )}

      <Card className="mb-6">
        <div className="flex flex-col items-center gap-4">
          <MemberPhotoUpload
            memberId={member.$id}
            photoFileId={member.photo_file_id}
            initials={initials(member)}
            name={fullName(member)}
          />
        </div>
      </Card>

      <Card>
        <MemberForm
          initial={member}
          initialBasontaIds={data.basonta_ids ?? []}
          restrict={{
            constituency: {
              // '' when they belong to no constituency — a bacenta head's
              // member may well not have one. The form sends it straight back
              // as `null`, which equals what is already stored, so it reads as
              // "unchanged" rather than as an attempted move.
              id: member.constituency_id ?? '',
              name: data.constituency_name ?? 'Not recorded',
            },
            basontas,
          }}
          submitLabel="Save changes"
          submitting={update.isPending}
          error={saveError}
          onSubmit={handleSubmit}
          onCancel={() => router.push('/my-groups')}
        />
      </Card>
    </PageWrap>
  )
}
