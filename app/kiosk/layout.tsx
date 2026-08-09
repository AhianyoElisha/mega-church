// The kiosk lives OUTSIDE the (app) route group on purpose: no header, no
// sidebar, no bottom bar. It is an appliance, and every pixel of app chrome is
// a pixel someone can tap by accident.

export default function KioskLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
