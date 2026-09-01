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


/*
 * Titles.
 *
 * The whole point of composing the title with a name, rather than offering a
 * bare {{title}}, is that the UNTITLED case cannot produce a fragment. Most of
 * the congregation has no title, so the untitled assertions below are the ones
 * that actually protect a broadcast — a stranded comma or a leading space here
 * goes to hundreds of people at the church's expense and cannot be recalled.
 */
describe('titles in a message', () => {
  const reverend = {
    first_name: 'Ama',
    last_name: 'Serwaa',
    other_names: null,
    title: 'reverend',
  }
  const plain = { first_name: 'Kwame', last_name: 'Mensah', other_names: null, title: null }

  it('addresses a titled member by title and surname', () => {
    const out = render('Dear {{salutation}}, welcome.', reverend)
    expect(out).toEqual({ ok: true, text: 'Dear Reverend Serwaa, welcome.' })
  })

  it('addresses an untitled member by first name, with no gap and no stranded comma', () => {
    const out = render('Dear {{salutation}}, welcome.', plain)
    expect(out).toEqual({ ok: true, text: 'Dear Kwame, welcome.' })
  })

  it('title_first_name gives the warmer form, and still falls back cleanly', () => {
    expect(render('Hello {{title_first_name}}!', reverend)).toEqual({
      ok: true,
      text: 'Hello Reverend Ama!',
    })
    expect(render('Hello {{title_first_name}}!', plain)).toEqual({
      ok: true,
      text: 'Hello Kwame!',
    })
  })

  it('titled_full_name prefixes the whole name, or leaves it alone', () => {
    expect(render('{{titled_full_name}}', reverend)).toEqual({ ok: true, text: 'Reverend Ama Serwaa' })
    expect(render('{{titled_full_name}}', plain)).toEqual({ ok: true, text: 'Kwame Mensah' })
  })

  it('never emits a leading space for an untitled member at the START of a message', () => {
    // The double-space collapse would hide this mid-sentence; at position 0
    // there is nothing to collapse against, so only `.trim()` or a correct
    // join saves it. Worth its own test for that reason.
    const out = render('{{title_first_name}} — your envelope is ready.', plain)
    expect(out.ok && out.text.startsWith('Kwame')).toBe(true)
  })

  it('an unknown title code renders as no title rather than raw', () => {
    // A code hand-edited in the console, or left behind by a title since
    // removed. It must not reach a member's phone as the word "overseer".
    const out = render('Dear {{salutation}},', { ...plain, title: 'overseer' })
    expect(out).toEqual({ ok: true, text: 'Dear Kwame,' })
  })

  it('leaves the existing name placeholders title-BLIND', () => {
    // Making these title-aware would rewrite every template already written
    // without anybody editing one.
    expect(render('{{first_name}} {{last_name}} {{full_name}}', reverend)).toEqual({
      ok: true,
      text: 'Ama Serwaa Ama Serwaa',
    })
  })

  it('still refuses a bare {{title}} — it is not a placeholder', () => {
    // The refusal is the feature: "Dear {{title}}," would render "Dear ," for
    // most of the congregation.
    const out = render('Dear {{title}},', reverend)
    expect(out.ok).toBe(false)
    if (out.ok) throw new Error('expected a refusal')
    expect(out.error).toMatch(/\{\{title\}\}/)
  })
})

describe('what a title costs', () => {
  it('a long title can push the same template into a second part', () => {
    // The church is billed per part. This is why the editor prices the worst
    // case rather than the previewed sample.
    const body = `${'x'.repeat(140)} {{salutation}}`
    const short = render(body, { first_name: 'Ama', last_name: 'Serwaa', title: null })
    const long = render(body, {
      first_name: 'Ama',
      last_name: 'Serwaa',
      title: 'lady_reverend',
    })
    if (!short.ok || !long.ok) throw new Error('render failed')
    expect(countParts(short.text).parts).toBe(1)
    expect(countParts(long.text).parts).toBe(2)
  })
})
