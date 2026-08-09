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
}

export default nextConfig
