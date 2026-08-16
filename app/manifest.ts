import type { MetadataRoute } from 'next'

/**
 * The web app manifest, served by Next at `/manifest.webmanifest`.
 *
 * This is what makes the app installable — and on iOS, installation is not
 * cosmetic: Safari only delivers Web Push to a PWA that has been added to the
 * home screen. Without this file the birthday team's iPhones would never
 * receive a notification, and nothing would explain why.
 *
 * `/manifest.webmanifest` and `/sw.js` are both excluded from the proxy matcher
 * — a browser fetches them out of band, without credentials, and gating them
 * turns a 200 into a redirect to /login that fails silently.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'The Mega Church — Attendance',
    short_name: 'Mega Church',
    description:
      'Biometric attendance, member registry, constituencies and bacentas for The Mega Church.',
    start_url: '/',
    // `standalone` hides the browser chrome, which is what makes the notified
    // person land in the app rather than in a tab they then have to find.
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#ffffff',
    // The brand yellow. Tints the Android status bar and the splash screen.
    theme_color: '#F5B301',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      // A maskable icon lets Android crop the mark to whatever shape the
      // launcher uses without slicing the crosses off the badge.
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'Birthdays', short_name: 'Birthdays', url: '/birthdays' },
      { name: 'Live attendance', short_name: 'Live', url: '/monitor' },
    ],
  }
}
