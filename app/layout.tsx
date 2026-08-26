import '@/styles/tailwind.css'
import { Metadata, Viewport } from 'next'
import Script from 'next/script'
import { Poppins } from 'next/font/google'
import { AuthProvider } from '@/components/auth'
import { QueryProvider } from '@/components/query-provider'
import { DialogProvider } from '@/components/dialog'
import PwaRegister from '@/components/pwa-register'
import ThemeProvider from './theme-provider'

// PickLT's typeface, same weights. `--font-sans` is exported so the inline
// logo SVG and the kiosk can reference it from CSS.
const poppins = Poppins({
  subsets: ['latin'],
  display: 'swap',
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-sans',
})

/**
 * Catch Chromium's install event before React exists.
 *
 * `beforeinstallprompt` fires once, early — on a returning visitor whose
 * engagement criteria are already met, that is during page load, well before
 * hydration. A listener attached in a component effect simply misses it, and
 * the failure is silent in the worst way: no error, no warning, just an
 * Install button that is never offered and a person concluding the app cannot
 * be installed at all. Which is precisely how this arrived as a bug report.
 *
 * So the event is caught here, at `beforeInteractive`, parked on `window`, and
 * announced. `components/install-prompt.tsx` reads the stash on mount and
 * listens for the announcement, so it cannot lose the race either way round.
 *
 * `preventDefault()` is what suppresses Chrome's own mini-infobar, which is
 * the trade: the invitation appears inside the app, in the app's own language,
 * rather than as browser furniture people swipe away without reading.
 */
const INSTALL_CAPTURE = `
window.__mcInstallEvent = null;
window.addEventListener('beforeinstallprompt', function (e) {
  e.preventDefault();
  window.__mcInstallEvent = e;
  window.dispatchEvent(new Event('mc:installable'));
});
`

export const metadata: Metadata = {
  title: {
    template: '%s · The Mega Church',
    default: 'The Mega Church — Attendance',
  },
  description: 'Biometric attendance for services and meetings.',
  // Next serves `app/manifest.ts` at this path; naming it here is what puts
  // the <link rel="manifest"> in the document head, which is what makes the
  // browser offer to install the app.
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    // iOS ignores the manifest's `display` and reads this instead. Without it
    // an installed icon opens a Safari tab with full browser chrome — and,
    // more importantly, does not count as an installed PWA for push delivery.
    capable: true,
    title: 'Mega Church',
    statusBarStyle: 'default',
  },
}

export const viewport: Viewport = {
  // Tints the browser UI to the brand yellow on Android and in installed apps.
  themeColor: '#F5B301',
  // `viewport-fit=cover` so an installed app draws into the iPhone's safe
  // areas rather than letterboxing itself with white bars.
  viewportFit: 'cover',
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${poppins.className} ${poppins.variable}`}>
      <Script id="install-capture" strategy="beforeInteractive">
        {INSTALL_CAPTURE}
      </Script>
      <body className="bg-white text-neutral-900 dark:bg-neutral-900 dark:text-neutral-100">
        <ThemeProvider>
          <QueryProvider>
            <AuthProvider>
              <DialogProvider>{children}</DialogProvider>
            </AuthProvider>
          </QueryProvider>
        </ThemeProvider>
        {/* Renders nothing. Registers the service worker once, app-wide —
            push delivery depends on the registration, not on any tab. */}
        <PwaRegister />
      </body>
    </html>
  )
}
