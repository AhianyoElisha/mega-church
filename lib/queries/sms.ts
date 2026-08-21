'use client'

// TanStack hooks for SMS.
//
// Every mutation invalidates the whole `sms` prefix. Creating a template
// changes which options the tithe screen offers AND which message the
// automatic birthday run would reach for; sending changes the log. Invalidating
// each key by hand is how one of them ends up showing a template that was
// deleted two clicks ago.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from './fetcher'
import { queryKeys } from './keys'
import type { SmsCategory } from '@/lib/appwrite/config'
import type {
  ListSmsLogResponse,
  ListTemplatesResponse,
  SendSmsResponse,
  SmsTemplateInput,
  TemplateResponse,
} from '@/lib/sms/types'

const SMS = ['sms']

function useSmsMutation<TData, TVars>(fn: (vars: TVars) => Promise<TData>) {
  const qc = useQueryClient()
  return useMutation<TData, Error, TVars>({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: SMS })
    },
  })
}

export function useSmsTemplates(category?: SmsCategory) {
  return useQuery<ListTemplatesResponse>({
    queryKey: queryKeys.smsTemplates(category),
    queryFn: () =>
      apiFetch(`/api/sms/templates${category ? `?category=${category}` : ''}`),
  })
}

export function useCreateTemplate() {
  return useSmsMutation<TemplateResponse, SmsTemplateInput>((vars) =>
    apiFetch('/api/sms/templates', { method: 'POST', body: JSON.stringify(vars) }),
  )
}

export function useUpdateTemplate() {
  return useSmsMutation<
    TemplateResponse,
    { id: string; name?: string; body?: string; is_default?: boolean }
  >(({ id, ...fields }) =>
    apiFetch(`/api/sms/templates/${id}`, { method: 'PATCH', body: JSON.stringify(fields) }),
  )
}

export function useDeleteTemplate() {
  return useSmsMutation<{ ok: boolean; error?: string }, { id: string }>(({ id }) =>
    apiFetch(`/api/sms/templates/${id}`, { method: 'DELETE' }),
  )
}

export function useSendSms() {
  return useSmsMutation<
    SendSmsResponse,
    { member_ids: string[]; template_id: string; category: SmsCategory }
  >((vars) => apiFetch('/api/sms/send', { method: 'POST', body: JSON.stringify(vars) }))
}

export function useSmsLog(category?: SmsCategory) {
  return useQuery<ListSmsLogResponse>({
    queryKey: queryKeys.smsLog(category),
    queryFn: () => apiFetch(`/api/sms/log${category ? `?category=${category}` : ''}`),
  })
}
