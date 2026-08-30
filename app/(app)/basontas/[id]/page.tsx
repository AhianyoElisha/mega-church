'use client'

import { use, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/shared/Button'
import { Banner, Card, LoadingRow, PageHeader, PageWrap, StatCard, TabBar } from '@/components/ui'
import GroupMemberAssigner from '@/components/group-member-assigner'
import HeadCard from '@/components/head-card'
import GroupRosterTable from '@/components/group-roster-table'
import { useDialog } from '@/components/dialog'
import { useAuth } from '@/components/auth'
import {
  useAssignBasonta,
  useBasonta,
  useDeleteBasonta,
  useUpdateBasonta,
} from '@/lib/queries/groups'
import type { Basonta } from '@/lib/groups/types'

export default function BasontaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const { user } = useAuth()
  const { confirm } = useDialog()

  const { data, isLoading, error } = useBasonta(id)
  const assign = useAssignBasonta()
  const remove = useDeleteBasonta()
  const update = useUpdateBasonta()
  const [tab, setTab] = useState<'members' | 'assign'>('members')

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
            : ((data as { error?: string })?.error ?? 'Could not load that basonta.')}
        </Banner>
        <div className="mt-6">
          <Button plain href={isAdmin ? '/basontas' : '/my-groups'}>
            Back
          </Button>
        </div>
      </PageWrap>
    )
  }

  const group = data.group as Basonta
  const members = data.members
  const active = members.filter((m) => m.status === 'active').length
  const memberIds = members.map((m) => m.$id)

  const handleDelete = async () => {
    const ok = await confirm({
      title: `Delete ${group.name}?`,
      message: (
        <>
          The {members.length} member{members.length === 1 ? '' : 's'} in it are NOT deleted —
          they stop serving in this group and keep every other basonta they are in. Attendance
          history is untouched.
        </>
      ),
      confirmText: 'Delete basonta',
      tone: 'danger',
    })
    if (!ok) return
    await remove.mutateAsync({ id })
    router.push('/basontas')
  }

  return (
    <PageWrap>
      <PageHeader
        back={
          isAdmin
            ? { href: '/basontas', label: 'All basontas' }
            : { href: '/my-groups', label: 'My groups' }
        }
        title={group.name}
        subtitle={group.description ?? 'A basonta — a work group members serve in.'}
        actions={
          isAdmin && (
            <Button plain onClick={handleDelete} disabled={remove.isPending}>
              Delete
            </Button>
          )
        }
      />

      <div className="mb-8 grid gap-4 sm:grid-cols-3">
        <StatCard label="Members" value={members.length} />
        <StatCard label="Active" value={active} />
        <StatCard
          label="Head"
          value={
            group.head_name ?? <span className="text-base text-neutral-400">Not appointed</span>
          }
        />
      </div>

      {isAdmin && (
        <HeadCard
          kind="basonta"
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
            { value: 'assign', label: 'Assign members' },
          ]}
        />
      )}

      {tab === 'members' || !isAdmin ? (
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
            Tick everyone who serves here. Adding somebody to this basonta does not take them out
            of any other — a chorister can run the sound desk too.
          </p>
          <GroupMemberAssigner
            kind="basonta"
            groupName={group.name}
            currentMemberIds={memberIds}
            busy={assign.isPending}
            onAssign={async (ids) => {
              const res = await assign.mutateAsync({ id, member_ids: ids, mode: 'add' })
              if (!res.ok) throw new Error(res.error)
            }}
            onRemove={async (ids) => {
              const res = await assign.mutateAsync({ id, member_ids: ids, mode: 'remove' })
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
