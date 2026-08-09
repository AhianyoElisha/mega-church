'use client'

// The fixed mobile bottom bar. Same construction as PickLT's
// `FooterQuickNavigation` — backdrop-blurred bar, `lg:hidden`, icon over a
// 12px label — minus its scroll-to-hide behaviour, which depended on
// `react-use` and cost more than it bought on a five-item bar.

import { Bars3Icon } from '@heroicons/react/24/outline'
import clsx from 'clsx'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useAside } from './aside'
import { useAuth } from './auth'
import { navForRole } from './navigation'

export default function FooterQuickNavigation() {
  const pathname = usePathname()
  const { open: openAside } = useAside()
  const { user } = useAuth()

  const items = navForRole(user?.label).filter((i) => i.quick)
  if (items.length === 0) return null

  return (
    <div className="fixed inset-x-0 bottom-0 z-30 flex items-center gap-6 bg-white/90 px-2.5 py-3 shadow ring-1 shadow-neutral-200/80 ring-neutral-900/5 backdrop-blur-sm lg:hidden dark:bg-neutral-950/90 dark:ring-white/10">
      <div className="mx-auto flex w-full max-w-lg justify-around text-center">
        {items.map((item) => {
          const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              role="menuitem"
              aria-label={`Go to ${item.name}`}
              aria-current={active ? 'page' : undefined}
              className={clsx(
                '-mx-2 flex flex-col items-center justify-between px-2',
                active
                  ? 'text-primary-600 dark:text-primary-400'
                  : 'text-neutral-500 dark:text-neutral-300',
              )}
            >
              <item.icon className="size-6" />
              <p className="text-xs/6">{item.name}</p>
            </Link>
          )
        })}
        <button
          onClick={() => openAside('sidebar-navigation')}
          aria-label="Open menu"
          className="-mx-2 flex cursor-pointer flex-col items-center justify-between px-2 text-neutral-500 dark:text-neutral-300"
        >
          <Bars3Icon className="size-6" />
          <p className="text-xs/6">Menu</p>
        </button>
      </div>
    </div>
  )
}
