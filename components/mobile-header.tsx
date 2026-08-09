'use client'

// Mobile header. PickLT shows a compact bar with the logo and a hamburger;
// the same here, plus the live-session pill because on a phone the person
// holding it is usually the one who needs to know whether a session is open.

import Logo from '@/shared/Logo'
import HamburgerBtnMenu from './hamburger-btn-menu'
import ActiveSessionPill from './active-session-pill'

export default function MobileHeader() {
  return (
    <div className="nc-header-bg sticky top-0 z-40 border-b border-neutral-200 lg:hidden dark:border-neutral-700">
      <div className="flex h-16 items-center justify-between gap-2 px-4">
        <Logo className="w-24" />
        <div className="flex items-center gap-2">
          <ActiveSessionPill />
          <HamburgerBtnMenu />
        </div>
      </div>
    </div>
  )
}
