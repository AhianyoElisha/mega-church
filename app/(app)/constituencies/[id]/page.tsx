'use client'

import { use, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/shared/Button'
import { Badge } from '@/shared/Badge'
import { Banner, Card, LoadingRow, PageHeader, PageWrap, StatCard, TabBar } from '@/components/ui'
import GroupMemberAssigner from '@/components/group-member-assigner'
import HeadCard from '@/components/head-card'
import DayExport from '@/components/day-export'
import HeadMemberClaim from '@/components/head-member-claim'
import GroupRosterTable from '@/components/group-roster-table'
import { useDialog } from '@/components/dialog'
import { useAuth } from '@/components/auth'
import {
  useAssignConstituency,
  useConstituency,
  useDeleteConstituency,
  useUpdateConstituency,
} from '@/lib/queries/groups'

// Next 16: page params are a promise.
export default function ConstituencyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const { user } = useAuth()
  const { confirm } = useDialog()

  const { data, isLoading, error } = useConstituency(id)
  const assign = useAssignConstituency()
  const remove = useDeleteConstituency()
  const update = useUpdateConstituency()
  const [tab, setTab] = useState<'members' | 'assign'>('members')

  const isAdmin = user?.label === 'admin'
  // A head may write here (register, claim); a shepherd may not write anywhere.
  // `!isAdmin` used to be a synonym for "head", and it stopped being one the
  // moment a read-only role could open this page.
  const canWrite = isAdmin || user?.label === 'leader'

  if (isLoading) {
    return (
      <PageWrap>
        <Card padded={false}>
          <LoadingRow />
        </Card>
      </PageWrap>
    )
  }

  // A 403 lands here for a head who followed a link to a group they do not
  // head. The message from the server already says so; showing it verbatim
  // beats a generic "something went wrong".
  if (error || !data?.ok) {
    return (
      <PageWrap>
        <Banner tone="error">
          {error instanceof Error ? error.message : (data as { error?: string })?.error ?? 'Could not load that constituency.'}
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
  const members = data.members
  const active = members.filter((m) => m.status === 'active').length
  const memberIds = members.map((m) => m.$id)

  const handleDelete = async () => {
    const ok = await confirm({
      title: `Delete ${group.name}?`,
      message: (
        <>
          The {members.length} member{members.length === 1 ? '' : 's'} in it will NOT be
          deleted — they simply stop having a constituency, and can be assigned to another one.
          Attendance history is untouched.
        </>
      ),
      confirmText: 'Delete constituency',
      tone: 'danger',
    })
    if (!ok) return
    await remove.mutateAsync({ id })
    router.push('/constituencies')
  }

  return (
    <PageWrap>
      <PageHeader
        back={
          isAdmin
            ? { href: '/constituencies', label: 'All constituencies' }
            : { href: '/my-groups', label: 'My groups' }
        }
        title={group.name}
        subtitle={group.description ?? 'A constituency — where these members live.'}
        actions={
          <>
            {/* A head gets this too. Registering somebody into the constituency
                they run is the second write the read-only rule makes room for,
                alongside claiming an unassigned member below — see PRD 5.2. */}
            {canWrite && (
              <Button color="primary" href={`/constituencies/${id}/register`}>
                Register a member
              </Button>
            )}
            {isAdmin && (
              <Button plain onClick={handleDelete} disabled={remove.isPending}>
                Delete
              </Button>
            )}
          </>
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

      {/* Rendered for a head as well as an admin. A download IS a read, and a
          head being able to pull their own constituency's first / second /
          absent lists is the point of the feature — `canReadGroup` on the
          server is what makes it safe, not the absence of a button. */}
      <DayExport constituency={{ id: group.$id, name: group.name }} />

      {isAdmin && (
        <HeadCard
          kind="constituency"
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

      {/* A head gets a tab bar too now. Their "assign" tab is a different,
          much narrower screen — see HeadMemberClaim — but the navigation is
          the same shape, so the page does not become two different pages
          depending on who opens it. */}
      {/* No Assign tab for a reader — every control on it is a write. */}
      {canWrite && (
        <TabBar
          className="mb-6"
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'members', label: `Members (${members.length})` },
            { value: 'assign', label: isAdmin ? 'Assign members' : 'Add members' },
          ]}
        />
      )}

      {tab === 'members' || !canWrite ? (
        <Card padded={false}>
          <GroupRosterTable
            members={members}
            memberHref={(mid) =>
              isAdmin || user?.label === 'shepherd'
                ? `/members/${mid}`
                : `/my-groups/members/${mid}`
            }
          />
        </Card>
      ) : !isAdmin ? (
        <Card>
          <h2 className="mb-1 text-base font-semibold text-neutral-950 dark:text-white">
            Add members to {group.name}
          </h2>
          <p className="mb-5 text-sm text-neutral-500 dark:text-neutral-400">
            You can add members who have <strong>no constituency yet</strong>. Somebody already
            placed in another constituency has to be moved by an administrator — that keeps two
            heads from pulling the same member back and forth.
          </p>
          <HeadMemberClaim
            constituencyId={id}
            groupName={group.name}
            busy={assign.isPending}
            onClaim={async (ids) => {
              const res = await assign.mutateAsync({ id, member_ids: ids, mode: 'add' })
              if (!res.ok) throw new Error(res.error)
              return { added: res.added, skipped: res.skipped ?? 0 }
            }}
          />
        </Card>
      ) : (
        <Card>
          <h2 className="mb-1 text-base font-semibold text-neutral-950 dark:text-white">
            Add members to {group.name}
          </h2>
          <p className="mb-5 text-sm text-neutral-500 dark:text-neutral-400">
            Tick everyone who lives here and add them in one go. Filter by{' '}
            <strong>No constituency yet</strong> to work through the members registered before
            constituencies existed.
          </p>
          <GroupMemberAssigner
            kind="constituency"
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

      {!canWrite && (
        <p className="mt-6 text-sm text-neutral-400 dark:text-neutral-500">
          You are signed in as a shepherd, so everything here is read-only.
        </p>
      )}

      {!isAdmin && canWrite && (
        <p className="mt-6 text-sm text-neutral-400 dark:text-neutral-500">
          You are signed in as a head. You can register new members into this constituency, add
          unassigned ones to it, and open any member to correct their details. Moving somebody
          between constituencies, and enrolling fingerprints, is an administrator&rsquo;s.{' '}
          <Link href="/my-groups" className="underline">
            Your other groups
          </Link>
        </p>
      )}
    </PageWrap>
  )
}
