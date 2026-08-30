'use client'

import { use, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/shared/Button'
import { Banner, Card, LoadingRow, PageHeader, PageWrap, StatCard, TabBar } from '@/components/ui'
import GroupMemberAssigner from '@/components/group-member-assigner'
import HeadCard from '@/components/head-card'
import GroupRosterTable from '@/components/group-roster-table'
import CareAssigner from '@/components/care-assigner'
import { useDialog } from '@/components/dialog'
import { useAuth } from '@/components/auth'
import {
  useAssignBacenta,
  useBacenta,
  useDeleteBacenta,
  useUpdateBacenta,
} from '@/lib/queries/groups'
import { useUpdateMember } from '@/lib/queries/members'
import type { BacentaWithCount } from '@/lib/groups/types'

export default function BacentaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const { user } = useAuth()
  const { confirm } = useDialog()

  const { data, isLoading, error } = useBacenta(id)
  const assign = useAssignBacenta()
  const remove = useDeleteBacenta()
  const update = useUpdateBacenta()
  const [tab, setTab] = useState<'members' | 'care' | 'assign'>('members')
  const updateMember = useUpdateMember()

  const isAdmin = user?.label === 'admin'
  const isShepherd = user?.label === 'shepherd'

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
            : ((data as { error?: string })?.error ?? 'Could not load that bacenta.')}
        </Banner>
        <div className="mt-6">
          <Button plain href={isAdmin ? '/bacentas' : '/my-groups'}>
            Back
          </Button>
        </div>
      </PageWrap>
    )
  }

  const group = data.group as BacentaWithCount
  const members = data.members
  const active = members.filter((m) => m.status === 'active').length
  const memberIds = members.map((m) => m.$id)

  const handleDelete = async () => {
    const ok = await confirm({
      title: `Delete ${group.name}?`,
      message: (
        <>
          The {members.length} member{members.length === 1 ? '' : 's'} in it are NOT deleted —
          they stop living anywhere until they are filed again, and anybody looking after them
          is released. Attendance history is untouched.
        </>
      ),
      confirmText: 'Delete bacenta',
      tone: 'danger',
    })
    if (!ok) return
    await remove.mutateAsync({ id })
    router.push('/bacentas')
  }

  return (
    <PageWrap>
      <PageHeader
        back={
          isAdmin
            ? { href: '/bacentas', label: 'All bacentas' }
            : { href: '/my-groups', label: 'My groups' }
        }
        title={group.name}
        subtitle={
          group.description ??
          (group.constituency_name
            ? `A bacenta in ${group.constituency_name}.`
            : 'A bacenta — a place inside a constituency.')
        }
        actions={
          isAdmin && (
            <>
              <Button plain onClick={handleDelete} disabled={remove.isPending}>
                Delete
              </Button>
            </>
          )
        }
      />

      <div className="mb-8 grid gap-4 sm:grid-cols-3">
        <StatCard label="Members" value={members.length} />
        <StatCard label="Active" value={active} />
        <StatCard
          label="Constituency"
          value={
            group.constituency_name ?? (
              <span className="text-base text-neutral-400">Not filed yet</span>
            )
          }
        />
        <StatCard
          label="Head"
          value={
            group.head_name ?? <span className="text-base text-neutral-400">Not appointed</span>
          }
        />
      </div>

      {isAdmin && (
        <HeadCard
          kind="bacenta"
          groupName={group.name}
          headUserId={group.head_user_id}
          headName={group.head_name}
          busy={update.isPending}
          onAppoint={async (headUserId) => {
            const res = await update.mutateAsync({ id, head_user_id: headUserId })
            if (!res.ok) throw new Error(res.error)
          }}
        />
      )}

      {isAdmin && (
        <TabBar
          className="mb-6"
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'members', label: `Members (${members.length})` },
            { value: 'care', label: 'Who looks after whom' },
            { value: 'assign', label: 'Assign members' },
          ]}
        />
      )}

      {tab === 'care' && isAdmin ? (
        <Card>
          <h2 className="mb-1 text-base font-semibold text-neutral-950 dark:text-white">
            Who looks after whom
          </h2>
          <p className="mb-5 text-sm text-neutral-500 dark:text-neutral-400">
            Put members under other members so somebody is checking on everyone. The person
            looking after them does not need an account — this is a record, not a login.
          </p>
          <CareAssigner
            members={data.care ?? []}
            busy={updateMember.isPending}
            onAssign={async (memberId, carerId) => {
              const res = await updateMember.mutateAsync({
                id: memberId,
                care_of_member_id: carerId,
              })
              if (!res.ok) throw new Error(res.error)
            }}
          />
        </Card>
      ) : tab === 'members' || !isAdmin ? (
        <Card padded={false}>
          <GroupRosterTable
            members={members}
            memberHref={(mid) =>
              isAdmin || isShepherd ? `/members/${mid}` : `/my-groups/members/${mid}`
            }
          />
        </Card>
      ) : (
        <Card>
          <h2 className="mb-1 text-base font-semibold text-neutral-950 dark:text-white">
            Add members to {group.name}
          </h2>
          <p className="mb-5 text-sm text-neutral-500 dark:text-neutral-400">
            Tick everyone who lives here. A member belongs to exactly ONE bacenta, so adding
            somebody MOVES them out of whichever one they were in — and clears whoever was
            looking after them there, because a care link belongs to a place.
          </p>
          <GroupMemberAssigner
            kind="bacenta"
            groupName={group.name}
            currentMemberIds={memberIds}
            busy={assign.isPending}
            onAssign={async (ids) => {
              const res = await assign.mutateAsync({ id, member_ids: ids, mode: 'assign' })
              if (!res.ok) throw new Error(res.error)
            }}
            onRemove={async (ids) => {
              const res = await assign.mutateAsync({ id, member_ids: ids, mode: 'unassign' })
              if (!res.ok) throw new Error(res.error)
            }}
          />
        </Card>
      )}

      {isShepherd && (
        <p className="mt-6 text-sm text-neutral-400 dark:text-neutral-500">
          You are signed in as a shepherd, so everything here is read-only.
        </p>
      )}

      {!isAdmin && !isShepherd && (
        <p className="mt-6 text-sm text-neutral-400 dark:text-neutral-500">
          You are signed in as a head. Open any member to correct their details; the group
          itself, and who is in it, is an administrator&rsquo;s to change.{' '}
          <Link href="/my-groups" className="underline">
            Your other groups
          </Link>
        </p>
      )}
    </PageWrap>
  )
}
