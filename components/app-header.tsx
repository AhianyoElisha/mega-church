'use client'

// Desktop header. Same skeleton as PickLT's `Header.tsx` — h-20 inside
// `.container`, logo left with a vertical rule, actions right — with PickLT's
// currency/language/notification dropdowns replaced by what this app actually
// has: the primary nav, a live-session pill, dark mode, and the account menu.

import clsx from 'clsx'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import Logo from '@/shared/Logo'
import SwitchDarkMode from '@/shared/SwitchDarkMode'
import { useAuth } from './auth'
import { navForRole } from './navigation'
import HamburgerBtnMenu from './hamburger-btn-menu'
import ActiveSessionPill from './active-session-pill'
import AccountDropdown from './account-dropdown'

interface HeaderProps {
  hasBorderBottom?: boolean
  className?: string
}

export default function AppHeader({ hasBorderBottom = true, className }: HeaderProps) {
  const pathname = usePathname()
  const { user } = useAuth()
  const items = navForRole(user?.label)

  return (
    <div className={clsx('relative', className)}>
      <div className="container">
        <div
          className={clsx(
            'flex h-20 justify-between gap-x-2.5 border-neutral-200 dark:border-neutral-700',
            hasBorderBottom && 'border-b',
          )}
        >
          <div className="flex items-center justify-center gap-x-3 sm:gap-x-8">
            <Logo />
            <div className="hidden h-7 border-l border-neutral-200 md:block dark:border-neutral-700" />
            <nav className="hidden items-center gap-x-1 lg:flex">
              {items.map((item) => {
                const active =
                  item.href === '/' ? pathname === '/' : pathname.startsWith(item.href)
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={clsx(
                      'rounded-full px-3.5 py-2 text-sm font-medium transition',
                      active
                        ? 'bg-primary-500 text-neutral-950'
                        : 'text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800',
                    )}
                  >
                    {item.name}
                  </Link>
                )
              })}
            </nav>
          </div>

          <div className="flex flex-1 items-center justify-end gap-x-2.5 sm:gap-x-4">
            <ActiveSessionPill className="hidden sm:flex" />
            <div className="block lg:hidden">
              <HamburgerBtnMenu />
            </div>
            <SwitchDarkMode className="hidden size-10! md:flex" />
            <div className="hidden md:block">
              <AccountDropdown />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
