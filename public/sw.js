/*
 * Service worker for The Mega Church.
 *
 * Deliberately minimal: it exists to receive push notifications and to make
 * the app installable. There is NO offline caching of app shell or API
 * responses, and that is a decision rather than an omission — this app's whole
 * job is telling you the live state of an attendance session, and a cached
 * "nobody is here yet" served after the network dropped is worse than an
 * honest error. The kiosk has its own offline queue for the one flow that
 * genuinely needs one.
 *
 * Not built by a bundler. Plain JS, served from /public as-is.
 */

// Take over as soon as an updated worker is installed, rather than waiting for
// every tab to close. Otherwise a fix to the push handler does not reach the
// phone until the team member manually kills the app.
self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

/**
 * A push arrived.
 *
 * `userVisibleOnly: true` was used to subscribe, so the browser REQUIRES a
 * notification to be shown for every push received — a handler that returns
 * without calling showNotification eventually gets the subscription revoked by
 * the browser. Hence the fallback: if the payload is missing or unparseable,
 * still show something rather than silently swallowing it.
 */
self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = {}
  }

  const title = data.title || 'The Mega Church'
  const options = {
    body: data.body || 'Open the app for details.',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    // A short buzz. Long patterns are ignored on most platforms anyway.
    vibrate: [100, 50, 100],
    // Same tag replaces rather than stacks, so a re-delivered notification
    // does not leave two identical entries in the shade.
    tag: data.tag || 'megachurch',
    renotify: false,
    data: { url: data.url || '/' },
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

/**
 * The notification was tapped.
 *
 * Focus an already-open tab on the same origin instead of opening a second
 * one — the team member almost certainly has the app installed and running,
 * and a duplicate window is one more thing for them to close.
 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = (event.notification.data && event.notification.data.url) || '/'

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        // Same-origin check: `client.url` is absolute, the target is a path.
        if (new URL(client.url).origin === self.location.origin && 'focus' in client) {
          client.navigate(target).catch(() => {})
          return client.focus()
        }
      }
      return self.clients.openWindow(target)
    }),
  )
})
