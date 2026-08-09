// Quiet footer, in the spirit of PickLT's `Footer2` — a thin rule, small
// muted type, nothing that competes with the page.

import Logo from '@/shared/Logo'

export default function AppFooter() {
  return (
    <footer className="mt-16 hidden border-t border-neutral-200 py-10 lg:block dark:border-neutral-700">
      <div className="container flex flex-col items-center justify-between gap-4 sm:flex-row">
        <Logo markClassName="size-7" />
        <p className="text-sm text-neutral-400 dark:text-neutral-500">
          Mega Church attendance · biometric check-in
        </p>
      </div>
    </footer>
  )
}
