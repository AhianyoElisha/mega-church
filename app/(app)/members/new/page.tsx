'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, PageHeader, PageWrap } from '@/components/ui'
import MemberForm, { type MemberFormValues } from '@/components/member-form'
import { useCreateMember } from '@/lib/queries/members'

export default function NewMemberPage() {
  const router = useRouter()
  const create = useCreateMember()
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (values: MemberFormValues) => {
    setError(null)
    try {
      const res = await create.mutateAsync(values)
      if (!res.ok) {
        setError(res.error)
        return
      }
      // Straight to the member's page rather than back to the list: the photo
      // and the fingerprint enrolment both live there, and both still need
      // doing before this member can be marked present by a scanner.
      router.push(`/members/${res.member.$id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that member.')
    }
  }

  return (
    <PageWrap className="max-w-3xl">
      <PageHeader
        back={{ href: '/members', label: 'Members' }}
        title="Register a member"
        subtitle="Name and call number are required. The photo and fingerprints come next."
      />
      <Card>
        <MemberForm
          submitLabel="Register member"
          submitting={create.isPending}
          error={error}
          onSubmit={handleSubmit}
          onCancel={() => router.push('/members')}
        />
      </Card>
    </PageWrap>
  )
}
