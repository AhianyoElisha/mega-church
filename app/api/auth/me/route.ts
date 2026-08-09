import { NextResponse } from 'next/server'
import { getAuthUser, toAuthUser } from '@/lib/appwrite/server'
import type { MeResponse } from '@/lib/auth/types'

export async function GET() {
  const raw = await getAuthUser()
  if (!raw) return NextResponse.json<MeResponse>({ user: null })
  const user = toAuthUser(raw)
  return NextResponse.json<MeResponse>({ user: user ?? null })
}
