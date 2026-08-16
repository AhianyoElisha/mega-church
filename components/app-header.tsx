'use client'

// Desktop header. Same skeleton as PickLT's `Header.tsx` — h-20 inside
// `.container`, logo left with a vertical rule, actions right — with PickLT's
// currency/language/notification dropdowns replaced by what this app actually
// has: the primary nav, a live-session pill, dark mode, and the account menu.

import clsx from 'clsx'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Popover, PopoverButton, PopoverPanel } from '@headlessui/react'
import { ChevronDownIcon } from '@heroicons/react/24/outline'
import Logo from '@/shared/Logo'
import SwitchDarkMode from '@/shared/SwitchDarkMode'
import { useAuth } from './auth'
import { groupedNavForRole, isActiveHref, type NavEntry, type NavItem } from './navigation'
import HamburgerBtnMenu from './hamburger-btn-menu'
import ActiveSessionPill from './active-session-pill'
import AccountDropdown from './account-dropdown'

interface HeaderProps {
  hasBorderBottom?: boolean
  className?: string
}

/** One pill in the bar — the shape a top-level link and an open menu share. */
const PILL =
  'flex items-center gap-x-1 rounded-full px-3.5 py-2 text-sm font-medium whitespace-nowrap transition'
const PILL_ACTIVE = 'bg-primary-500 text-neutral-950'
const PILL_IDLE =
  'text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800'

function NavLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const active = isActiveHref(pathname, item.href)
  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      className={clsx(PILL, active ? PILL_ACTIVE : PILL_IDLE)}
    >
      {item.name}
    </Link>
  )
}

/**
 * A header menu. The button carries the ACTIVE styling when the page being
 * shown is one of its children, so "where am I" survives the collapse — a
 * grouped bar that stopped highlighting anything would be a worse bar than the
 * one that overflowed.
 */
function NavGroupMenu({
  entry,
  pathname,
}: {
  entry: Extract<NavEntry, { kind: 'group' }>
  pathname: string
}) {
  const active = entry.items.some((i) => isActiveHref(pathname, i.href))

  return (
    <Popover className="relative">
      <PopoverButton
        className={clsx(PILL, 'group cursor-pointer focus-visible:outline-0', active ? PILL_ACTIVE : PILL_IDLE)}
      >
        {entry.name}
        <ChevronDownIcon aria-hidden className="size-4 transition duration-200 group-data-open:rotate-180" />
      </PopoverButton>
      <PopoverPanel
        transition
        anchor={{ to: 'bottom start', gap: 8 }}
        className="z-40 w-60 rounded-3xl bg-white p-2 shadow-lg ring-1 ring-black/5 transition duration-200 data-closed:translate-y-1 data-closed:opacity-0 dark:bg-neutral-800 dark:ring-white/10"
      >
        {({ close }) => (
          <div className="flex flex-col gap-0.5">
            {entry.items.map((item) => {
              const itemActive = isActiveHref(pathname, item.href)
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  // Next keeps this component mounted across a navigation, so
                  // the panel has to be told to close; it would otherwise stay
                  // open over the page it just moved to.
                  onClick={() => close()}
                  aria-current={itemActive ? 'page' : undefined}
                  className={clsx(
                    'flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-medium transition',
                    itemActive
                      ? 'bg-primary-500 text-neutral-950'
                      : 'text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-700',
                  )}
                >
                  <item.icon className="size-5 shrink-0" />
                  {item.name}
                </Link>
              )
            })}
          </div>
        )}
      </PopoverPanel>
    </Popover>
  )
}

export default function AppHeader({ hasBorderBottom = true, className }: HeaderProps) {
  const pathname = usePathname()
  const { user } = useAuth()
  const entries = groupedNavForRole(user?.label)

  return (
    <div className={clsx('relative', className)}>
      <div className="container">
        <div
          className={clsx(
            'flex h-20 justify-between gap-x-2.5 border-neutral-200 dark:border-neutral-700',
            hasBorderBottom && 'border-b',
          )}
        >
          {/* The gap narrows again at lg: that is the band where the nav first
              appears and the row is at its tightest, and 32px of dead space
              between the logo and the first menu is the cheapest thing in the
              header to give up. */}
          <div className="flex min-w-0 items-center justify-center gap-x-3 sm:gap-x-8 lg:gap-x-4 xl:gap-x-8">
            <Logo />
            <div className="hidden h-7 border-l border-neutral-200 md:block dark:border-neutral-700" />
            <nav className="hidden items-center gap-x-1 lg:flex">
              {entries.map((entry) =>
                entry.kind === 'link' ? (
                  <NavLink key={entry.item.href} item={entry.item} pathname={pathname} />
                ) : (
                  <NavGroupMenu key={entry.id} entry={entry} pathname={pathname} />
                ),
              )}
            </nav>
          </div>

          {/* `shrink-0`: the account menu is how you sign out, so it is the one
              thing that must never be the element pushed off the right edge —
              which is exactly what happened when the flat bar outgrew the
              header. */}
          <div className="flex flex-1 shrink-0 items-center justify-end gap-x-2.5 sm:gap-x-4">
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
