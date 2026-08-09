'use client'

// The mobile drawer's contents. Rendered inside PickLT's `Aside` (copied
// verbatim in components/aside/), which supplies the backdrop, the slide
// transition, and the logo header.

import clsx from 'clsx'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import SwitchDarkMode from '@/shared/SwitchDarkMode'
import Aside, { useAside } from './aside'
import { useAuth } from './auth'
import { navForRole } from './navigation'
import { useDialog } from './dialog'

export default function AsideSidebarNavigation() {
  const pathname = usePathname()
  const { close } = useAside()
  const { user, logout } = useAuth()
  const dialog = useDialog()
  const items = navForRole(user?.label)

  const handleSignOut = async () => {
    const ok = await dialog.confirm({
      title: 'Sign out?',
      message: 'You will need to sign in again to record attendance.',
      confirmText: 'Sign out',
      tone: 'danger',
    })
    if (ok) {
      close()
      await logout()
    }
  }

  return (
    <Aside openFrom="right" type="sidebar-navigation" logoOnHeading contentMaxWidthClassName="max-w-md">
      <div className="flex h-full flex-col">
        <div className="hidden-scrollbar flex-1 overflow-x-hidden overflow-y-auto py-6">
          <nav className="flex flex-col gap-1">
            {items.map((item) => {
              const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href)
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={close}
                  aria-current={active ? 'page' : undefined}
                  className={clsx(
                    'flex items-center gap-3 rounded-xl px-4 py-3 text-base font-medium transition',
                    active
                      ? 'bg-primary-500 text-neutral-950'
                      : 'text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-700',
                  )}
                >
                  <item.icon className="size-5 shrink-0" />
                  {item.name}
                </Link>
              )
            })}
          </nav>
        </div>

        <div className="flex items-center justify-between border-t border-neutral-200 py-4 dark:border-neutral-700">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">
              {user?.name || user?.email}
            </p>
            <button
              onClick={handleSignOut}
              className="cursor-pointer text-sm text-red-600 hover:underline dark:text-red-400"
            >
              Sign out
            </button>
          </div>
          <SwitchDarkMode />
        </div>
      </div>
    </Aside>
  )
}
