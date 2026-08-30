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
  ChatBubbleLeftRightIcon,
} from '@heroicons/react/24/outline'
import type { UserLabel } from '@/lib/auth/types'

export type NavGroupId = 'people' | 'gatherings'

export type NavItem = {
  name: string
  href: string
  icon: typeof HomeIcon
  /** Labels allowed to see this item. Mirrors `proxy.ts`; the proxy is the
   *  enforcement, this is only what gets drawn. */
  roles: UserLabel[]
  /** Shown in the mobile bottom bar as well as the sidebar. */
  quick?: boolean
  /**
   * Which header menu this item sits under. Omitted ⇒ it is a destination in
   * its own right and stays at the top level.
   */
  group?: NavGroupId
}

/**
 * The two menus the header collapses items into.
 *
 * An admin sees ten destinations. Laid out flat they measured 927px, and with
 * the logo and the right-hand actions the header needed 1336px — 1447px while
 * First Service is open, because the session pill carries the meeting's name.
 * That overflowed every common laptop: the nav could not shrink, so the account
 * menu was pushed off the right edge and the whole page scrolled sideways.
 *
 * Grouped, the same ten come to roughly 487px and fit from 1024px up.
 *
 * The split is the PRD's own, not a bucket of leftovers: `people` is the
 * registry (§1.1, §1.7–1.9) and `gatherings` is the attendance operation
 * (§1.3–1.6). A new module joins one of them rather than adding an eleventh
 * top-level item, which is what made this break in the first place.
 */
export const NAV_GROUPS: { id: NavGroupId; name: string; icon: typeof HomeIcon }[] = [
  { id: 'people', name: 'People', icon: UsersIcon },
  { id: 'gatherings', name: 'Gatherings', icon: CalendarDaysIcon },
]

export const NAVIGATION: NavItem[] = [
  { name: 'Overview', href: '/', icon: HomeIcon, roles: ['admin'], quick: true },
  {
    name: 'Members',
    href: '/members',
    icon: UsersIcon,
    roles: ['admin', 'usher', 'shepherd'],
    quick: true,
    group: 'people',
  },
  {
    name: 'Constituencies',
    href: '/constituencies',
    icon: MapPinIcon,
    roles: ['admin', 'shepherd'],
    group: 'people',
  },
  {
    name: 'Bacentas',
    href: '/bacentas',
    icon: UserGroupIcon,
    roles: ['admin', 'shepherd'],
    group: 'people',
  },
  {
    name: 'Basontas',
    href: '/basontas',
    icon: UserGroupIcon,
    roles: ['admin', 'shepherd'],
    group: 'people',
  },
  // A head's landing page. Deliberately NOT shown to an admin, who reaches the
  // same information through the two full lists above — a third entry pointing
  // at "all groups" again would be a duplicate in their sidebar.
  //
  // Ungrouped: it is the only thing a leader has, and burying one item under a
  // menu costs a click to reach the page they signed in for.
  { name: 'My groups', href: '/my-groups', icon: UserGroupIcon, roles: ['leader'], quick: true },
  {
    name: 'Birthdays',
    href: '/birthdays',
    icon: CakeIcon,
    roles: ['admin', 'celebrations', 'shepherd'],
    quick: true,
  },
  // Under `people` rather than as an eleventh top-level item — which is the
  // rule this menu structure exists to enforce (see NAV_GROUPS above). Messages
  // are addressed to the registry, so `people` is where they belong.
  {
    name: 'Messages',
    href: '/sms',
    icon: ChatBubbleLeftRightIcon,
    roles: ['admin'],
    group: 'people',
  },
  {
    name: 'Services',
    href: '/services',
    icon: CalendarDaysIcon,
    roles: ['admin', 'shepherd'],
    quick: true,
    group: 'gatherings',
  },
  {
    name: 'Meetings',
    href: '/meetings',
    icon: RectangleGroupIcon,
    roles: ['admin', 'shepherd'],
    group: 'gatherings',
  },
  {
    name: 'Live',
    href: '/monitor',
    icon: SignalIcon,
    roles: ['admin', 'usher', 'shepherd'],
    quick: true,
    group: 'gatherings',
  },
  { name: 'Reports', href: '/reports', icon: ChartBarIcon, roles: ['admin', 'shepherd'] },
  {
    name: 'Kiosk',
    href: '/kiosk',
    icon: FingerPrintIcon,
    roles: ['admin', 'kiosk'],
    group: 'gatherings',
  },
]

export function navForRole(label: UserLabel | undefined): NavItem[] {
  if (!label) return []
  return NAVIGATION.filter((i) => i.roles.includes(label))
}

export type NavEntry =
  | { kind: 'link'; item: NavItem }
  | { kind: 'group'; id: NavGroupId; name: string; icon: typeof HomeIcon; items: NavItem[] }

/**
 * The same items, arranged for a horizontal bar.
 *
 * A group holding ONE visible item renders as a plain link instead. An usher
 * sees only Members and Live, and putting each alone under its own menu would
 * add a click and a disclosure arrow to a bar with two entries in it. So the
 * menus appear for the role that needs them — the admin — and nobody else pays
 * for the fix.
 *
 * Each group takes the position of its first visible item, so the reading order
 * an admin already knows is preserved.
 */
export function groupedNavForRole(label: UserLabel | undefined): NavEntry[] {
  const items = navForRole(label)
  const entries: NavEntry[] = []
  const groupIndex = new Map<NavGroupId, number>()

  for (const item of items) {
    if (!item.group) {
      entries.push({ kind: 'link', item })
      continue
    }

    const at = groupIndex.get(item.group)
    if (at === undefined) {
      const meta = NAV_GROUPS.find((g) => g.id === item.group)!
      groupIndex.set(item.group, entries.length)
      entries.push({ kind: 'group', id: meta.id, name: meta.name, icon: meta.icon, items: [item] })
      continue
    }

    const existing = entries[at]
    if (existing.kind === 'group') existing.items.push(item)
  }

  return entries.map((entry) =>
    entry.kind === 'group' && entry.items.length === 1
      ? { kind: 'link', item: entry.items[0] }
      : entry,
  )
}

/** True when `href` is the page being shown. `/` matches only itself. */
export function isActiveHref(pathname: string, href: string): boolean {
  return href === '/' ? pathname === '/' : pathname.startsWith(href)
}
