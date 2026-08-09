import {
  HomeIcon,
  UsersIcon,
  CalendarDaysIcon,
  RectangleGroupIcon,
  SignalIcon,
  ChartBarIcon,
  FingerPrintIcon,
} from '@heroicons/react/24/outline'
import type { UserLabel } from '@/lib/auth/types'

export type NavItem = {
  name: string
  href: string
  icon: typeof HomeIcon
  /** Labels allowed to see this item. Mirrors `proxy.ts`; the proxy is the
   *  enforcement, this is only what gets drawn. */
  roles: UserLabel[]
  /** Shown in the mobile bottom bar as well as the sidebar. */
  quick?: boolean
}

export const NAVIGATION: NavItem[] = [
  { name: 'Overview', href: '/', icon: HomeIcon, roles: ['admin'], quick: true },
  { name: 'Members', href: '/members', icon: UsersIcon, roles: ['admin', 'usher'], quick: true },
  { name: 'Services', href: '/services', icon: CalendarDaysIcon, roles: ['admin'], quick: true },
  { name: 'Meetings', href: '/meetings', icon: RectangleGroupIcon, roles: ['admin'] },
  { name: 'Live', href: '/monitor', icon: SignalIcon, roles: ['admin', 'usher'], quick: true },
  { name: 'Reports', href: '/reports', icon: ChartBarIcon, roles: ['admin'] },
  { name: 'Kiosk', href: '/kiosk', icon: FingerPrintIcon, roles: ['admin', 'kiosk'] },
]

export function navForRole(label: UserLabel | undefined): NavItem[] {
  if (!label) return []
  return NAVIGATION.filter((i) => i.roles.includes(label))
}
