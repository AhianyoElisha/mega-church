import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },
  // Member photos are uploaded through /api/members/[id]/photo as multipart.
  // Appwrite Storage is the destination; the route only ever holds one image
  // (capped at 5 MB before compression) so the default 10 MB proxy buffer is
  // ample. Raised a little for headroom on the multipart envelope.
  experimental: {
    proxyClientMaxBodySize: '16mb',
  },

  /**
   * Force the NBIS WebAssembly into the serverless bundle.
   *
   * `lib/biometrics/wasm-matcher.ts` finds its artifact with `existsSync` on a
   * runtime-computed path and loads it through a `webpackIgnore`d dynamic
   * import — deliberately, so no bundler tries to inline an Emscripten module
   * that resolves its own `.wasm` sibling. The cost is that Next's file tracer
   * cannot see the dependency, and `public/` is served by the static layer
   * rather than being part of a function's filesystem.
   *
   * On a hosted deployment the result is a server that silently cannot match
   * ANY fingerprint. It does not error — `probeBiometricMatcher()` reports
   * "no matcher available" and the kiosk shows a banner — but fingerprint
   * check-in is simply gone until these files ship.
   *
   * Listed per route rather than globally: only these three touch the matcher.
   */
  outputFileTracingIncludes: {
    '/api/attendance/scan': ['./public/nbis/**'],
    '/api/attendance/manual': ['./public/nbis/**'],
    '/api/biometrics/matcher-health': ['./public/nbis/**'],
  },

  async headers() {
    return [
      {
        /**
         * The service worker must never be cached.
         *
         * A worker is replaced only when the browser refetches its script and
         * finds it byte-different. Serve it with ordinary static caching and a
         * fix to the push handler stays unreachable on the team's phones for
         * as long as that cache lives — with no error, and no way for them to
         * force it short of clearing site data.
         */
        source: '/sw.js',
        headers: [
          { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          // The worker loads nothing external, so say so — a compromised
          // dependency cannot pull a script into the one context that survives
          // the page being closed.
          { key: 'Content-Security-Policy', value: "default-src 'self'; script-src 'self'" },
        ],
      },
    ]
  },
}

export default nextConfig
