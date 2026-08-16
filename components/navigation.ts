import {
  HomeIcon,
  UsersIcon,
  CalendarDaysIcon,
  RectangleGroupIcon,
  SignalIcon,
  ChartBarIcon,
  FingerPrintIcon,
  MapPinIcon,
  UserGroupIcon,
  CakeIcon,
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
  {
    name: 'Constituencies',
    href: '/constituencies',
    icon: MapPinIcon,
    roles: ['admin'],
  },
  { name: 'Bacentas', href: '/bacentas', icon: UserGroupIcon, roles: ['admin'] },
  // A head's landing page. Deliberately NOT shown to an admin, who reaches the
  // same information through the two full lists above — a third entry pointing
  // at "all groups" again would be a duplicate in their sidebar.
  { name: 'My groups', href: '/my-groups', icon: UserGroupIcon, roles: ['leader'], quick: true },
  {
    name: 'Birthdays',
    href: '/birthdays',
    icon: CakeIcon,
    roles: ['admin', 'celebrations'],
    quick: true,
  },
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
