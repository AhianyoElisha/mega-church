import { describe, expect, it } from 'vitest'
import {
  PLACEHOLDERS,
  countParts,
  render,
  toProviderNumber,
  unknownPlaceholders,
} from '@/lib/sms/render'

const ama = { first_name: 'Ama', last_name: 'Serwaa', other_names: null }
const kofi = { first_name: 'Kofi', last_name: 'Mensah', other_names: 'Kwabena' }

describe('render', () => {
  it('fills the placeholders a template actually uses', () => {
    const r = render('Happy birthday {{first_name}}! — {{church}}', ama)
    expect(r).toEqual({ ok: true, text: 'Happy birthday Ama! — The Mega Church' })
  })

  it('accepts spaces inside the braces', () => {
    // An admin typing `{{ first_name }}` has not made a mistake worth a
    // refusal, and refusing it would look like the placeholder is unsupported.
    const r = render('Hello {{ first_name }}', ama)
    expect(r).toEqual({ ok: true, text: 'Hello Ama' })
  })

  it('builds full_name from all three name parts', () => {
    const r = render('{{full_name}}', kofi)
    expect(r).toEqual({ ok: true, text: 'Kofi Kwabena Mensah' })
  })

  it('does not leave a double space where other_names is blank', () => {
    // Cosmetic, but it is exactly the kind of thing a congregation notices and
    // the church then has to explain.
    const r = render('Dear {{first_name}} {{other_names}} {{last_name}},', ama)
    expect(r).toEqual({ ok: true, text: 'Dear Ama Serwaa,' })
  })

  it('REFUSES an unknown placeholder instead of substituting a blank', () => {
    // The failure being prevented, concretely: `{{name}}` is a plausible guess
    // and not one of ours. Substituting an empty string mails
    // "Happy birthday !" to the whole congregation, at cost, with no recall.
    const r = render('Happy birthday {{name}}!', ama)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toContain('{{name}}')
      // The fix has to be in the message, or the admin is left guessing.
      expect(r.error).toContain('{{first_name}}')
    }
  })

  it('names every unknown placeholder, not just the first', () => {
    const r = render('{{name}} and {{nickname}}', ama)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toContain('{{name}}')
      expect(r.error).toContain('{{nickname}}')
    }
  })

  it('renders a template with no placeholders at all', () => {
    const r = render('God bless you for your tithe.', ama)
    expect(r).toEqual({ ok: true, text: 'God bless you for your tithe.' })
  })

  it('every advertised placeholder actually resolves', () => {
    // Guards the drift between the list shown in the editor and the set the
    // renderer knows: a placeholder offered by the UI that then refuses to
    // send is worse than one that was never offered.
    for (const p of PLACEHOLDERS) {
      expect(render(`x {{${p}}} y`, kofi).ok).toBe(true)
    }
  })
})

describe('unknownPlaceholders', () => {
  it('finds nothing in a clean template', () => {
    expect(unknownPlaceholders('Hi {{first_name}} from {{church}}')).toEqual([])
  })
  it('reports each unknown token once', () => {
    expect(unknownPlaceholders('{{oops}} {{oops}}')).toEqual(['oops'])
  })
})

describe('countParts', () => {
  it('counts a short GSM-7 message as one part', () => {
    const c = countParts('Happy birthday!')
    expect(c.parts).toBe(1)
    expect(c.unicode).toBe(false)
  })

  it('is still one part at exactly 160 characters', () => {
    expect(countParts('a'.repeat(160)).parts).toBe(1)
  })

  it('spills into two parts at 161 — the character that doubles the bill', () => {
    // Past a single part the message is CONCATENATED, and each part carries
    // 153 rather than 160 because the joining header costs 7 bits. This is the
    // number the editor shows, and it is why it is shown: a template that
    // quietly grew past 160 costs twice what the church approved.
    expect(countParts('a'.repeat(161)).parts).toBe(2)
    expect(countParts('a'.repeat(306)).parts).toBe(2)
    expect(countParts('a'.repeat(307)).parts).toBe(3)
  })

  it('drops to 70 characters a part once a message needs UCS-2', () => {
    // One emoji in a birthday message is a plausible thing to want and it
    // more than halves the capacity. Better to say so in the editor than to
    // discover it on the bill.
    const c = countParts('Happy birthday 🎉')
    expect(c.unicode).toBe(true)
    expect(c.parts).toBe(1)
    expect(countParts('a'.repeat(71) + '🎉').parts).toBe(2)
  })

  it('treats a pasted curly quote as unicode', () => {
    // Word and WhatsApp both substitute these silently, so a template that
    // was 160 plain characters becomes a two-part message on paste with
    // nothing visibly different about it.
    expect(countParts('God’s blessing').unicode).toBe(true)
  })

  it('reports an empty message as zero parts, not one', () => {
    expect(countParts('').parts).toBe(0)
  })
})

describe('toProviderNumber', () => {
  it('strips the + that our storage format adds', () => {
    // `normalisePhone` stores +233…, which is right for storage and wrong on
    // this wire: mNotify's own validator accepts 9-12 characters and a correct
    // Ghanaian number with a + is 13. It is not an error — the number is just
    // silently rejected, one row at a time, inside a batch that succeeded.
    expect(toProviderNumber('+233241234567')).toBe('233241234567')
  })

  it('strips spaces and dashes a human typed', () => {
    expect(toProviderNumber('+233 24 123 4567')).toBe('233241234567')
    expect(toProviderNumber('024-123-4567')).toBe('0241234567')
  })

  it('refuses something that is not a phone number', () => {
    expect(toProviderNumber('')).toBeNull()
    expect(toProviderNumber('12345')).toBeNull()
    expect(toProviderNumber('not a number')).toBeNull()
  })

  it('refuses a number too long to be one', () => {
    expect(toProviderNumber('+2332412345678901')).toBeNull()
  })
})
