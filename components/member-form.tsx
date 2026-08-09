'use client'

// Registration / edit form. Every field in PRD §1.1, built from PickLT's
// fieldset primitives so it matches the rest of the product exactly.

import { useState } from 'react'
import { Button } from '@/shared/Button'
import { Description, ErrorMessage, Field, FieldGroup, Fieldset, Label, Legend } from '@/shared/fieldset'
import Input from '@/shared/Input'
import Select from '@/shared/Select'
import Textarea from '@/shared/Textarea'
import type { Member, MemberInput } from '@/lib/members/types'

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

/** 29 February is a real birthday — there is no year here to invalidate it. */
const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

export type MemberFormValues = MemberInput

export default function MemberForm({
  initial,
  submitLabel,
  submitting,
  error,
  onSubmit,
  onCancel,
}: {
  initial?: Member
  submitLabel: string
  submitting?: boolean
  error?: string | null
  onSubmit: (values: MemberFormValues) => void
  onCancel?: () => void
}) {
  const [first, setFirst] = useState(initial?.first_name ?? '')
  const [last, setLast] = useState(initial?.last_name ?? '')
  const [other, setOther] = useState(initial?.other_names ?? '')
  const [month, setMonth] = useState(initial?.birth_month ? String(initial.birth_month) : '')
  const [day, setDay] = useState(initial?.birth_day ? String(initial.birth_day) : '')
  const [address, setAddress] = useState(initial?.address ?? '')
  const [call, setCall] = useState(initial?.call_number ?? '')
  const [whatsapp, setWhatsapp] = useState(initial?.whatsapp_number ?? '')
  const [homeService, setHomeService] = useState(initial?.home_service ?? 'second')
  const [status, setStatus] = useState(initial?.status ?? 'active')
  const [localError, setLocalError] = useState<string | null>(null)

  const maxDay = month ? DAYS_IN_MONTH[Number(month) - 1] : 31

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setLocalError(null)

    if (!first.trim() || !last.trim()) {
      setLocalError('First and last name are both required.')
      return
    }
    if (!call.trim()) {
      setLocalError('A call number is required.')
      return
    }
    // Half a birthday is not useful and would render as a broken date.
    if ((month && !day) || (!month && day)) {
      setLocalError('Choose both the birth month and the day, or leave both blank.')
      return
    }

    onSubmit({
      first_name: first.trim(),
      last_name: last.trim(),
      other_names: other.trim() || null,
      birth_month: month ? Number(month) : null,
      birth_day: day ? Number(day) : null,
      address: address.trim() || null,
      call_number: call.trim(),
      whatsapp_number: whatsapp.trim() || null,
      home_service: homeService,
      status,
    })
  }

  const shown = error ?? localError

  return (
    <form onSubmit={handleSubmit}>
      <Fieldset>
        <FieldGroup>
          <Legend>Name</Legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <Label>First name</Label>
              <Input value={first} onChange={(e) => setFirst(e.target.value)} autoFocus required />
            </Field>
            <Field>
              <Label>Last name</Label>
              <Input value={last} onChange={(e) => setLast(e.target.value)} required />
            </Field>
          </div>
          <Field>
            <Label>Other names</Label>
            <Input value={other} onChange={(e) => setOther(e.target.value)} />
            <Description>Middle or additional names, if any.</Description>
          </Field>
        </FieldGroup>

        <FieldGroup>
          <Legend>Contact</Legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <Label>Call number</Label>
              <Input
                type="tel"
                value={call}
                onChange={(e) => setCall(e.target.value)}
                placeholder="024 123 4567"
                required
              />
              <Description>Required. Stored as +233… so lookups work either way.</Description>
            </Field>
            <Field>
              <Label>WhatsApp number</Label>
              <Input
                type="tel"
                value={whatsapp}
                onChange={(e) => setWhatsapp(e.target.value)}
                placeholder="Leave blank if the same"
              />
              <Description>
                Optional, and kept separate from the call number on purpose — plenty of members
                use one number for both, but not everyone does.
              </Description>
            </Field>
          </div>
          <Field>
            <Label>Address</Label>
            <Textarea rows={2} value={address} onChange={(e) => setAddress(e.target.value)} />
          </Field>
        </FieldGroup>

        <FieldGroup>
          <Legend>Birthday</Legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <Label>Month</Label>
              <Select
                value={month}
                onChange={(e) => {
                  setMonth(e.target.value)
                  // Switching from March to February with 30 selected would
                  // otherwise leave an impossible day sitting in the field.
                  const limit = e.target.value ? DAYS_IN_MONTH[Number(e.target.value) - 1] : 31
                  if (day && Number(day) > limit) setDay('')
                }}
              >
                <option value="">—</option>
                {MONTHS.map((m, i) => (
                  <option key={m} value={i + 1}>
                    {m}
                  </option>
                ))}
              </Select>
            </Field>
            <Field>
              <Label>Day</Label>
              <Select value={day} onChange={(e) => setDay(e.target.value)}>
                <option value="">—</option>
                {Array.from({ length: maxDay }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <p className="text-sm text-neutral-500 dark:text-neutral-400">
            The year is deliberately not collected.
          </p>
        </FieldGroup>

        <FieldGroup>
          <Legend>Membership</Legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <Label>Usual service</Label>
              <Select
                value={homeService}
                onChange={(e) => setHomeService(e.target.value as 'first' | 'second')}
              >
                <option value="first">First Service (Psalms Chapel)</option>
                <option value="second">Second Service</option>
              </Select>
              <Description>
                For your records only. Attendance is never restricted by this — anyone may be
                marked present at either service.
              </Description>
            </Field>
            <Field>
              <Label>Status</Label>
              <Select
                value={status}
                onChange={(e) => setStatus(e.target.value as 'active' | 'inactive')}
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </Select>
              <Description>An inactive member cannot be matched by a scanner.</Description>
            </Field>
          </div>
        </FieldGroup>

        {shown && (
          <div className="mt-6">
            <ErrorMessage>{shown}</ErrorMessage>
          </div>
        )}

        <div className="mt-8 flex gap-3">
          <Button type="submit" color="primary" disabled={submitting}>
            {submitting ? 'Saving…' : submitLabel}
          </Button>
          {onCancel && (
            <Button type="button" plain onClick={onCancel} disabled={submitting}>
              Cancel
            </Button>
          )}
        </div>
      </Fieldset>
    </form>
  )
}
