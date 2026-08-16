import '@/styles/tailwind.css'
import { Metadata, Viewport } from 'next'
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
