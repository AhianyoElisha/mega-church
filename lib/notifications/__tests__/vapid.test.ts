import { describe, expect, it } from 'vitest'
import { vapidSubjectProblem } from '@/lib/notifications/vapid'

/**
 * The three cases at the top are the ones that were measured against the
 * church's own devices on 2026-08-27. Everything else generalises from them.
 */
describe('vapidSubjectProblem — the subjects that were actually tried', () => {
  it('refuses the placeholder that Apple answered 403 BadJwtToken to', () => {
    const problem = vapidSubjectProblem('mailto:admin@megachurch.local')
    expect(problem).not.toBeNull()
    // Named, not merely refused: whoever reads this has to know which variable.
    expect(problem).toContain('VAPID_SUBJECT')
    expect(problem).toContain('.local')
  })

  it('accepts the https subject Apple answered 201 to', () => {
    expect(vapidSubjectProblem('https://mega-church.vercel.app')).toBeNull()
  })

  it('accepts a mailto: on a routable domain, which Apple also answered 201 to', () => {
    expect(vapidSubjectProblem('mailto:admin@mega-church.vercel.app')).toBeNull()
  })
})

describe('vapidSubjectProblem — absent', () => {
  it.each([undefined, null, '', '   '])('refuses %o rather than defaulting', (raw) => {
    const problem = vapidSubjectProblem(raw)
    expect(problem).not.toBeNull()
    expect(problem).toContain('VAPID_SUBJECT is not set')
  })

  it('does not invent a fallback address in the message', () => {
    // The bug was a plausible-looking default. The refusal must not smuggle one
    // back in by suggesting a specific placeholder to paste.
    expect(vapidSubjectProblem(undefined)).not.toContain('megachurch.local')
  })
})

describe('vapidSubjectProblem — reserved names that reach nobody', () => {
  it.each([
    'mailto:admin@church.local',
    'mailto:admin@host.localhost',
    'mailto:admin@church.test',
    'mailto:admin@church.invalid',
    'mailto:admin@church.internal',
    'https://church.local',
    'https://intranet.internal/contact',
  ])('refuses %s', (subject) => {
    expect(vapidSubjectProblem(subject)).not.toBeNull()
  })

  it.each(['mailto:admin@example.com', 'https://example.org', 'https://example.net'])(
    'refuses the RFC 2606 documentation domain %s',
    (subject) => {
      expect(vapidSubjectProblem(subject)).not.toBeNull()
    },
  )

  it('is not fooled by case', () => {
    expect(vapidSubjectProblem('mailto:Admin@Church.LOCAL')).not.toBeNull()
  })

  it('is not fooled by a trailing dot on a fully-qualified host', () => {
    expect(vapidSubjectProblem('mailto:admin@church.local.')).not.toBeNull()
  })

  it('does not refuse a real domain that merely CONTAINS a reserved word', () => {
    // "local" as a label, not as the TLD. Refusing this would be a false
    // positive that turns push off for a church with an ordinary domain.
    expect(vapidSubjectProblem('mailto:admin@local.church.org')).toBeNull()
    expect(vapidSubjectProblem('https://localhost.example-church.com')).toBeNull()
  })
})

describe('vapidSubjectProblem — malformed', () => {
  it.each([
    'admin@church.org', // no scheme
    'http://church.org', // RFC 8292 names mailto: and https: only
    'tel:+233200000000',
    'mailto:admin', // no domain at all
    'mailto:@church.org', // no local part
    'mailto:admin@', // no host
    'https://', // no host
  ])('refuses %s', (subject) => {
    expect(vapidSubjectProblem(subject)).not.toBeNull()
  })

  it('says what the subject must be, so the message is actionable', () => {
    expect(vapidSubjectProblem('http://church.org')).toContain('mailto:')
  })

  it('tolerates surrounding whitespace on an otherwise good subject', () => {
    // A value pasted into a dashboard field very often arrives with a newline.
    expect(vapidSubjectProblem('  https://mega-church.vercel.app  ')).toBeNull()
  })
})
