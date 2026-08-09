import '@/styles/tailwind.css'
import { Metadata } from 'next'
import { Poppins } from 'next/font/google'
import { AuthProvider } from '@/components/auth'
import { QueryProvider } from '@/components/query-provider'
import { DialogProvider } from '@/components/dialog'
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
    template: '%s · Mega Church',
    default: 'Mega Church — Attendance',
  },
  description: 'Biometric attendance for services and meetings.',
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
      </body>
    </html>
  )
}
