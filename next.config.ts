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
}

export default nextConfig
