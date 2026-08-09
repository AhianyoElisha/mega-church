// Page-level furniture assembled from PickLT primitives. Nothing here invents
// a new visual language — it composes `Heading`, `Button`, `Badge` and the
// `rounded-2xl / border-neutral-200 / dark:bg-neutral-800` card idiom that
// runs through PickLT so every page in this app looks like the same product.

import clsx from 'clsx'
import type { ReactNode } from 'react'
import { Heading, Subheading } from '@/shared/Heading'

export function PageWrap({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx('container py-8 sm:py-12', className)}>{children}</div>
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string
  subtitle?: string
  actions?: ReactNode
}) {
  return (
    <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <Heading level={1} className="text-2xl! sm:text-3xl!">
          {title}
        </Heading>
        {subtitle && <Subheading className="mt-1.5 text-base!">{subtitle}</Subheading>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-3">{actions}</div>}
    </div>
  )
}

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
        'rounded-2xl border border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-800/40',
        padded && 'p-5 sm:p-6',
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
        'rounded-2xl border p-5',
        accent
          ? 'border-primary-500 bg-primary-50 dark:border-primary-600 dark:bg-primary-900/20'
          : 'border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-800/40',
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
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-neutral-300 px-6 py-16 text-center dark:border-neutral-700">
      {Icon && <Icon className="mb-4 size-10 text-neutral-300 dark:text-neutral-600" />}
      <p className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">{title}</p>
      {message && (
        <p className="mt-1 max-w-sm text-sm text-neutral-500 dark:text-neutral-400">{message}</p>
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

/** Full-width loading row used inside cards and tables. */
export function LoadingRow({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="px-4 py-10 text-center text-sm text-neutral-400 dark:text-neutral-500">
      {label}
    </div>
  )
}
