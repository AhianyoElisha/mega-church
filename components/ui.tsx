// Page-level furniture assembled from PickLT primitives. Nothing here invents
// a new visual language — it composes `Heading`, `Button`, `Badge` and the
// `rounded-2xl / border-neutral-200 / dark:bg-neutral-800` card idiom that
// runs through PickLT so every page in this app looks like the same product.

import clsx from 'clsx'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { ChevronLeftIcon } from '@heroicons/react/24/outline'
import { Button } from '@/shared/Button'
import { Heading, Subheading } from '@/shared/Heading'

export function PageWrap({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx('container py-8 sm:py-12', className)}>{children}</div>
}

/**
 * The way back, above the title.
 *
 * A LINK, never `router.back()`. Browser history is not the page hierarchy:
 * arriving at a member from the kiosk, from a search, or by pasting a URL all
 * leave different histories, and a back control that lands somewhere different
 * each time is one people stop trusting. A fixed destination always means the
 * same thing.
 *
 * It sits above the heading rather than in `actions` because it is navigation,
 * not an action on this page — and because `actions` is where destructive
 * controls like Delete live, which is not a neighbourhood for the button people
 * click without looking.
 */
export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="group -ml-1 mb-2 inline-flex items-center gap-1.5 rounded-lg px-1 py-0.5 text-sm text-neutral-500 transition hover:text-neutral-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500 dark:text-neutral-400 dark:hover:text-white"
    >
      <ChevronLeftIcon
        className="size-4 transition-transform group-hover:-translate-x-0.5"
        aria-hidden="true"
      />
      {label}
    </Link>
  )
}

export function PageHeader({
  title,
  subtitle,
  actions,
  back,
}: {
  title: string
  subtitle?: string
  actions?: ReactNode
  /** Where "up" is. Omitted on the destinations that ARE the top level. */
  back?: { href: string; label: string }
}) {
  return (
    <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      {/*
        `wrap-anywhere`, and `min-w-0` is not enough on its own.

        Every detail page passes a name straight from the database as `title`
        — a bacenta, a constituency, a meeting, a member. A name with no space
        in it long enough to beat the screen sets this heading's min-content,
        the heading refuses to be narrower than that, and the whole PAGE
        scrolls sideways rather than the heading wrapping. Measured at 390px
        with a 96-character name, which is what the schema allows: the document
        went 1497px wide.

        `overflow-wrap: anywhere` is the one that fixes it. `break-words`
        (`overflow-wrap: break-word`) measured 1497px too — it permits the break
        but does NOT reduce min-content, which is the same trap the /sms fix
        hit one level up. `break-all` also works but breaks ordinary words
        mid-letter; `anywhere` only breaks when there is no other option, so a
        normal name is untouched.
      */}
      <div className="min-w-0">
        {back && <BackLink href={back.href} label={back.label} />}
        <Heading level={1} className="text-2xl! wrap-anywhere sm:text-3xl!">
          {title}
        </Heading>
        {subtitle && (
          <Subheading className="mt-1.5 text-base! wrap-anywhere">{subtitle}</Subheading>
        )}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-3">{actions}</div>}
    </div>
  )
}

/**
 * PickLT's panel card: `rounded-2xl`, solid surface, a soft shadow, and NO
 * border (see `(account)/account/page.tsx` there — `rounded-2xl p-6 shadow-sm`
 * throughout).
 *
 * This previously carried a hard 1px `border-neutral-200` and no shadow, which
 * is SEMP's flat administrative look rather than PickLT's. The two are easy to
 * confuse in isolation and obvious side by side: the border version reads as a
 * dense data tool, the shadow version as a consumer app.
 */
export function Card({
  children,
  className,
  padded = true,
}: {
  children: ReactNode
  className?: string
  padded?: boolean
}) {
  return (
    <div
      className={clsx(
        'rounded-2xl bg-white shadow-sm ring-1 ring-neutral-900/5 dark:bg-neutral-800 dark:ring-white/10',
        padded && 'p-6',
        className,
      )}
    >
      {children}
    </div>
  )
}

export function StatCard({
  label,
  value,
  hint,
  accent = false,
}: {
  label: string
  value: ReactNode
  hint?: string
  accent?: boolean
}) {
  return (
    <div
      className={clsx(
        'rounded-2xl p-5 shadow-sm',
        accent
          ? 'bg-primary-50 ring-1 ring-primary-500/40 dark:bg-primary-900/20 dark:ring-primary-500/30'
          : 'bg-white ring-1 ring-neutral-900/5 dark:bg-neutral-800 dark:ring-white/10',
      )}
    >
      <p className="text-sm font-medium text-neutral-500 dark:text-neutral-400">{label}</p>
      <p className="mt-1 text-3xl font-bold text-neutral-950 tabular-nums dark:text-white">
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-neutral-400 dark:text-neutral-500">{hint}</p>}
    </div>
  )
}

export function EmptyState({
  title,
  message,
  action,
  icon: Icon,
}: {
  title: string
  message?: string
  action?: ReactNode
  icon?: React.ComponentType<{ className?: string }>
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl bg-neutral-50 px-6 py-16 text-center ring-1 ring-neutral-900/5 dark:bg-neutral-800/60 dark:ring-white/10">
      {Icon && <Icon className="mb-4 size-10 text-neutral-300 dark:text-neutral-600" />}
      {/* Same reason as PageHeader: several callers put a group name in here. */}
      <p className="wrap-anywhere text-lg font-semibold text-neutral-900 dark:text-neutral-100">
        {title}
      </p>
      {message && (
        <p className="mt-1 max-w-sm wrap-anywhere text-sm text-neutral-500 dark:text-neutral-400">
          {message}
        </p>
      )}
      {action && <div className="mt-6">{action}</div>}
    </div>
  )
}

const BANNER_TONE = {
  success:
    'border-green-300 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-900/20 dark:text-green-300',
  error:
    'border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400',
  warning:
    'border-primary-400 bg-primary-50 text-primary-900 dark:border-primary-700 dark:bg-primary-900/20 dark:text-primary-200',
  info: 'border-neutral-300 bg-neutral-50 text-neutral-700 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300',
} as const

export type BannerTone = keyof typeof BANNER_TONE

export function Banner({
  tone = 'info',
  children,
  onDismiss,
  className,
}: {
  tone?: BannerTone
  children: ReactNode
  onDismiss?: () => void
  className?: string
}) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={clsx(
        'flex items-start justify-between gap-4 rounded-xl border px-4 py-3 text-sm',
        BANNER_TONE[tone],
        className,
      )}
    >
      <div className="min-w-0 flex-1">{children}</div>
      {onDismiss && (
        <button
          onClick={onDismiss}
          aria-label="Dismiss"
          className="-m-1 shrink-0 cursor-pointer rounded p-1 text-lg leading-none opacity-60 hover:opacity-100"
        >
          ×
        </button>
      )}
    </div>
  )
}

/**
 * A row of tabs built out of PickLT's Button, so the selected tab is a filled
 * primary button and the rest are plain.
 *
 * A component rather than the same conditional spread in four pages: `Button`
 * types `plain` as literal `true`, so `plain={!selected}` does not compile and
 * the workaround is easy to get subtly different each time it is written out.
 */
export function TabBar<T extends string>({
  tabs,
  value,
  onChange,
  className,
}: {
  tabs: { value: T; label: string }[]
  value: T
  onChange: (value: T) => void
  className?: string
}) {
  return (
    <div className={clsx('flex flex-wrap gap-2', className)} role="tablist">
      {tabs.map((tab) =>
        tab.value === value ? (
          <Button
            key={tab.value}
            color="primary"
            role="tab"
            aria-selected
            onClick={() => onChange(tab.value)}
          >
            {tab.label}
          </Button>
        ) : (
          <Button
            key={tab.value}
            plain
            role="tab"
            aria-selected={false}
            onClick={() => onChange(tab.value)}
          >
            {tab.label}
          </Button>
        ),
      )}
    </div>
  )
}

/** Full-width loading row used inside cards and tables. */
export function LoadingRow({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="px-4 py-10 text-center text-sm text-neutral-400 dark:text-neutral-500">
      {label}
    </div>
  )
}
