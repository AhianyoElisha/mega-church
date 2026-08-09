'use client'

// Same composition as PickLT's `(account)/application-layout.tsx`: an
// `Aside.Provider` wrapping a desktop header, a mobile header, the page, the
// fixed mobile bottom bar, and the slide-out drawer.

import React, { ReactNode } from 'react'
import Aside from '@/components/aside'
import AppHeader from '@/components/app-header'
import MobileHeader from '@/components/mobile-header'
import FooterQuickNavigation from '@/components/footer-quick-navigation'
import AsideSidebarNavigation from '@/components/sidebar-navigation'
import AppFooter from '@/components/app-footer'

export function ApplicationLayout({ children }: { children: ReactNode }) {
  return (
    <Aside.Provider>
      <div className="hidden lg:block">
        <AppHeader />
      </div>
      <MobileHeader />

      {/* pb-24 clears the fixed bottom bar on mobile; lg has no bar. */}
      <main className="min-h-[70vh] pb-24 lg:pb-0">{children}</main>

      <FooterQuickNavigation />
      <AppFooter />
      <AsideSidebarNavigation />
    </Aside.Provider>
  )
}

export default ApplicationLayout
