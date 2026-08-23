'use client'

// Registering a member INTO one constituency.
//
// This is the constituency head's own front desk, and it is deliberately not
// `/members/new`. That page is the whole registry: it can file somebody into
// any constituency, mark them inactive, choose their birthday wording, and it
// hands off to a member page carrying Delete and the fingerprint enrolment
// panel. A head has business with none of that. Giving them a narrower door
// costs one page and means the wide one never has to grow a set of "is this
// person an admin" branches.
//
// Biometric enrolment is NOT here and is not reachable from here. A head
// registers the person and their details; an admin enrols the fingerprints on
// the machine with the scanner attached.

import { use, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/shared/Button'
import { Banner, Card, LoadingRow, PageHeader, PageWrap } from '@/components/ui'
import MemberForm, { type MemberFormValues } from '@/components/member-form'
import MemberPhotoUpload from '@/components/member-photo-upload'
import { useAuth } from '@/components/auth'
import { useCreateMember } from '@/lib/queries/members'
import { useConstituency, useMyGroups } from '@/lib/queries/groups'
import { fullName, initials, type Member } from '@/lib/members/types'

// Next 16: page params are a promise.
export default function RegisterIntoConstituencyPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)
  const router = useRouter()
  const { user } = useAuth()
  const isAdmin = user?.label === 'admin'

  // The authorisation check, and the group's name, in one request. A head who
  // types another constituency's id into the URL gets the same 403 the detail
  // page gives them, from `canReadGroup` on the server.
  const { data, isLoading, error } = useConstituency(id)
  // For a head this is the bacentas they run; for an admin it is all of them.
  const myGroups = useMyGroups()
  const create = useCreateMember()

  const [saveError, setSaveError] = useState<string | null>(null)
  const [registered, setRegistered] = useState<Member | null>(null)

  if (isLoading) {
    return (
      <PageWrap>
        <Card padded={false}>
          <LoadingRow />
        </Card>
      </PageWrap>
    )
  }

  if (error || !data?.ok) {
    return (
      <PageWrap>
        <Banner tone="error">
          {error instanceof Error
            ? error.message
            : ((data as { error?: string })?.error ?? 'Could not load that constituency.')}
        </Banner>
        <div className="mt-6">
          <Button plain href={isAdmin ? '/constituencies' : '/my-groups'}>
            Back
          </Button>
        </div>
      </PageWrap>
    )
  }

  const group = data.group
  const bacentas = myGroups.data?.ok ? myGroups.data.bacentas : []

  const handleSubmit = async (values: MemberFormValues) => {
    setSaveError(null)
    try {
      const res = await create.mutateAsync(values)
      if (!res.ok) {
        setSaveError(res.error)
        return
      }
      // Deliberately NOT a redirect to `/members/[id]`: a head cannot open that
      // page. The photo — the one remaining detail — is collected right here
      // instead, on the panel below.
      setRegistered(res.member)
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Could not save that member.')
    }
  }

  if (registered) {
    return (
      <PageWrap className="max-w-3xl">
        <PageHeader
          back={{ href: `/constituencies/${id}`, label: group.name }}
          title={`${fullName(registered)} is registered`}
          subtitle={`Filed into ${group.name}. Add their photo now if you have one.`}
        />
        <Card>
          <div className="flex flex-col items-center gap-6">
            <MemberPhotoUpload
              memberId={registered.$id}
              photoFileId={registered.photo_file_id}
              initials={initials(registered)}
              name={fullName(registered)}
            />
            <p className="max-w-md text-center text-sm text-neutral-500 dark:text-neutral-400">
              Fingerprints are enrolled separately, by an administrator at the machine with the
              scanner attached. Until that is done this member can still be marked present by
              hand, but not by the kiosk.
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              <Button
                color="primary"
                onClick={() => {
                  setRegistered(null)
                  setSaveError(null)
                }}
              >
                Register another
              </Button>
              <Button plain href={`/constituencies/${id}`}>
                Back to {group.name}
              </Button>
            </div>
          </div>
        </Card>
      </PageWrap>
    )
  }

  return (
    <PageWrap className="max-w-3xl">
      <PageHeader
        back={{ href: `/constituencies/${id}`, label: group.name }}
        title={`Register a member into ${group.name}`}
        subtitle="Name and call number are required. The photo comes next, on the following screen."
      />
      <Card>
        <MemberForm
          restrict={{
            constituency: { id: group.$id, name: group.name },
            bacentas,
          }}
          submitLabel="Register member"
          submitting={create.isPending}
          error={saveError}
          onSubmit={handleSubmit}
          onCancel={() => router.push(`/constituencies/${id}`)}
        />
      </Card>
      {isAdmin && (
        <p className="mt-6 text-sm text-neutral-400 dark:text-neutral-500">
          This is the form a group head sees, and it always files into {group.name}. To register
          somebody into a different constituency, or to set their status or birthday message, use{' '}
          <a href="/members/new" className="underline">
            the full registration form
          </a>
          .
        </p>
      )}
    </PageWrap>
  )
}
