'use client'

// Browser SDK. Used for Realtime subscriptions and for building Storage
// preview URLs; every other browser→data read goes through a Route Handler.

import { Account, Client, Databases, Storage } from 'appwrite'

const client = new Client()
  .setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT!)
  .setProject(process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID!)

export const databases = new Databases(client)
export const account = new Account(client)
export const storage = new Storage(client)
export { client }
