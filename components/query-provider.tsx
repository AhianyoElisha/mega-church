'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'

// Ported from SEMP. staleTime is aligned with what a cached list endpoint is
// willing to serve, so a fresh mount that hits a warm endpoint keeps the value
// rather than immediately refetching. gcTime holds dormant queries long enough
// that tab-switching feels instant, short enough that an idle tab does not pin
// stale data forever.

export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60_000,
            gcTime: 5 * 60_000,
            refetchOnWindowFocus: 'always',
            refetchOnReconnect: 'always',
            retry: 1,
          },
          mutations: { retry: 0 },
        },
      }),
  )
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
