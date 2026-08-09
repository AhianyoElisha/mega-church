'use client'

// Modelled on PickLT's `HeaderAuthDropdown` — a Headless UI Popover anchored
// bottom-end, white rounded-3xl panel with a shadow and a ring.

import { Popover, PopoverButton, PopoverPanel } from '@headlessui/react'
import { ArrowRightOnRectangleIcon, UserCircleIcon } from '@heroicons/react/24/outline'
import Link from 'next/link'
import Avatar from '@/shared/Avatar'
import { useAuth } from './auth'
import { useDialog } from './dialog'

const ROLE_LABEL: Record<string, string> = {
  admin: 'Administrator',
  usher: 'Usher',
  kiosk: 'Kiosk',
}

export default function AccountDropdown() {
  const { user, logout } = useAuth()
  const dialog = useDialog()

  if (!user) {
    return (
      <Link
        href="/login"
        className="rounded-full bg-primary-500 px-4 py-2 text-sm font-semibold text-neutral-950 hover:bg-primary-600"
      >
        Sign in
      </Link>
    )
  }

  const handleSignOut = async () => {
    const ok = await dialog.confirm({
      title: 'Sign out?',
      message: 'You will need to sign in again to record attendance.',
      confirmText: 'Sign out',
      tone: 'danger',
    })
    if (ok) await logout()
  }

  const initials = (user.name || user.email).slice(0, 2).toUpperCase()

  return (
    <Popover className="relative">
      <PopoverButton className="flex cursor-pointer items-center rounded-full focus-visible:outline-0">
        <Avatar
          initials={initials}
          className="size-10 bg-primary-500 text-neutral-950"
          alt={user.name || user.email}
        />
      </PopoverButton>
      <PopoverPanel
        transition
        anchor={{ to: 'bottom end', gap: 12 }}
        className="z-40 w-72 rounded-3xl bg-white p-6 shadow-lg ring-1 ring-black/5 transition duration-200 data-closed:translate-y-1 data-closed:opacity-0 dark:bg-neutral-800 dark:ring-white/10"
      >
        <div className="flex items-center gap-4">
          <Avatar
            initials={initials}
            className="size-12 bg-primary-500 text-neutral-950"
            alt={user.name || user.email}
          />
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold text-neutral-950 dark:text-white">
              {user.name || 'Account'}
            </p>
            <p className="truncate text-sm text-neutral-500 dark:text-neutral-400">{user.email}</p>
            <p className="mt-1 inline-flex rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300">
              {ROLE_LABEL[user.label] ?? user.label}
            </p>
          </div>
        </div>

        <hr className="my-5" />

        <div className="flex flex-col gap-1">
          {user.label === 'admin' && (
            <Link
              href="/members"
              className="-m-2 flex items-center gap-3 rounded-lg p-2 text-sm text-neutral-700 transition hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-700"
            >
              <UserCircleIcon className="size-5 text-neutral-400" />
              Member registry
            </Link>
          )}
          <button
            onClick={handleSignOut}
            className="-m-2 flex cursor-pointer items-center gap-3 rounded-lg p-2 text-left text-sm text-red-600 transition hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
          >
            <ArrowRightOnRectangleIcon className="size-5" />
            Sign out
          </button>
        </div>
      </PopoverPanel>
    </Popover>
  )
}
