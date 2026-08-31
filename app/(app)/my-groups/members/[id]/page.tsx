'use client'

// One member, as their group head sees them: correctable, and — for the head of
// their own constituency — deletable.
//
// Under `/my-groups` and not `/members/[id]` on purpose. That page carries the
// four-finger enrolment panel, which no head may touch, and the way to keep it
// that way is not to add `isAdmin` branches to it but to give a head their own
// door. This one works for a member of a constituency, a bacenta OR a basonta
// they head, which is why it hangs off `/my-groups` rather than off any one
// group's page.
//
// ## Two tiers on one page
//
// Every head who can open this can correct an ordinary detail. The head of the
// member's OWN CONSTITUENCY can additionally set their status, move them
// between the places in that constituency, choose their birthday message, and
// DELETE them outright — `elevated` below is that distinction, and it is the
// same one `headEditScope` and `headDeleteScope` enforce server-side.
//
// The gate here is not the enforcement; the API is. It is here so a basonta
// head is not offered a Delete button that answers 403 (CLAUDE.md: a page a
// reader can open must gate its CONTROLS).

import { use, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Banner, Card, LoadingRow, PageHeader, PageWrap } from '@/components/ui'
import { useDialog } from '@/components/dialog'
import { Button } from '@/shared/Button'
import MemberForm, { type MemberFormValues } from '@/components/member-form'
import MemberPhotoUpload from '@/components/member-photo-upload'
import { useDeleteMember, useMember, useUpdateMember } from '@/lib/queries/members'
import { useMyGroups } from '@/lib/queries/groups'
import { fullName, initials } from '@/lib/members/types'

export default function HeadMemberPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()

  const { data, isLoading, error } = useMember(id)
  const myGroups = useMyGroups()
  const update = useUpdateMember()
  const remove = useDeleteMember()
  const dialog = useDialog()

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

  /**
   * Does this head run the constituency this member LIVES in?
   *
   * `myGroups` lists only groups naming them as head, so membership of that
   * list is the whole test. A member with no constituency is never elevated —
   * `null` must not match a head with no constituencies either, which is why
   * the null check is explicit rather than relying on `includes`.
   */
  const headedConstituencies = myGroups.data?.ok ? myGroups.data.constituencies : []
  const elevated =
    member.constituency_id !== null &&
    headedConstituencies.some((c) => c.$id === member.constituency_id)

  const handleDelete = async () => {
    // Name what is destroyed, and name the reversible alternative — which this
    // head now has, so it is a real choice rather than a consolation. The
    // wording is the admin page's, because the consequences are identical and
    // two wordings for one irreversible act is how one of them gets softer.
    const ok = await dialog.confirm({
      title: `Delete ${fullName(member)}?`,
      message:
        'This permanently removes their record, their fingerprints, their place on every ' +
        'meeting roster, and their entire attendance history. It cannot be undone. Setting ' +
        'them to Inactive in the form above keeps the history and stops them being matched — ' +
        'that is usually what you want.',
      confirmText: 'Delete permanently',
      tone: 'danger',
    })
    if (!ok) return
    await remove.mutateAsync({ id })
    router.push('/my-groups')
  }

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
        subtitle={
          elevated
            ? 'Correct their details, move them between your bacentas, or remove them. Fingerprints stay with an administrator.'
            : 'Correct their details. Fingerprints, status and where they live stay with an administrator or their constituency head.'
        }
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
            elevated,
          }}
          submitLabel="Save changes"
          submitting={update.isPending}
          error={saveError}
          onSubmit={handleSubmit}
          onCancel={() => router.push('/my-groups')}
        />
      </Card>

      {/*
        Only for the head of this member's own constituency. A bacenta or
        basonta head reaches the very same page to correct a phone number and is
        not offered this — `headDeleteScope` refuses them anyway, and a button
        that 403s is worse than no button.
      */}
      {elevated && (
        <Card className="mt-6">
          <h2 className="text-base font-semibold text-neutral-950 dark:text-white">Danger zone</h2>
          <p className="mt-1 mb-4 text-sm text-neutral-500 dark:text-neutral-400">
            Deleting removes their attendance history for good, and the church cannot get it
            back. To stop someone being matched without losing the history, set their status to
            Inactive above instead.
          </p>
          <Button color="red" onClick={handleDelete} disabled={remove.isPending}>
            {remove.isPending ? 'Deleting…' : 'Delete this member'}
          </Button>
        </Card>
      )}
    </PageWrap>
  )
}
