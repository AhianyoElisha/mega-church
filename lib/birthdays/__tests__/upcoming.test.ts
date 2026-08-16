import { describe, expect, it } from 'vitest'
import {
  addDaysISO,
  birthdayNotificationText,
  celebrantsForNotification,
  daysAwayLabel,
  isLeapYear,
  monthDayLabel,
  nextOccurrence,
  upcomingCelebrants,
} from '../upcoming'

type M = Parameters<typeof upcomingCelebrants>[0][number]

const member = (over: Partial<M> & { $id: string }): M => ({
  first_name: 'Ama',
  other_names: null,
  last_name: 'Serwaa',
  photo_file_id: null,
  call_number: '+233241234567',
  whatsapp_number: null,
  birth_month: null,
  birth_day: null,
  status: 'active',
  ...over,
})

describe('nextOccurrence', () => {
  it('counts today as zero days away', () => {
    expect(nextOccurrence(3, 14, '2026-03-14')).toEqual({ date: '2026-03-14', days_away: 0 })
  })

  it('counts tomorrow as one — the lead the whole feature turns on', () => {
    expect(nextOccurrence(3, 15, '2026-03-14')).toEqual({ date: '2026-03-15', days_away: 1 })
  })

  it('wraps into next year across New Year', () => {
    // The bug a naive same-year implementation ships with: on 31 December a
    // 1 January birthday reads as 364 days ago and never notifies.
    expect(nextOccurrence(1, 1, '2026-12-31')).toEqual({ date: '2027-01-01', days_away: 1 })
  })

  it('never returns a date in the past', () => {
    const { days_away } = nextOccurrence(1, 5, '2026-06-01')
    expect(days_away).toBeGreaterThan(0)
  })

  it('observes 29 February on the 28th in a common year', () => {
    // 2027 is not a leap year. Pointing the team at a day that does not exist
    // means the flyer never gets made.
    expect(nextOccurrence(2, 29, '2027-02-27')).toEqual({ date: '2027-02-28', days_away: 1 })
  })

  it('uses the real 29th in a leap year', () => {
    expect(nextOccurrence(2, 29, '2028-02-28')).toEqual({ date: '2028-02-29', days_away: 1 })
  })

  it('crosses a leap day correctly when counting forward', () => {
    // 2028 is a leap year: 28 Feb → 1 March is TWO days, not one.
    expect(nextOccurrence(3, 1, '2028-02-28')).toEqual({ date: '2028-03-01', days_away: 2 })
    expect(nextOccurrence(3, 1, '2027-02-28')).toEqual({ date: '2027-03-01', days_away: 1 })
  })

  it('handles the end of a 31-day month', () => {
    expect(nextOccurrence(2, 1, '2026-01-31')).toEqual({ date: '2026-02-01', days_away: 1 })
  })
})

describe('isLeapYear', () => {
  it('applies the century rules', () => {
    expect(isLeapYear(2028)).toBe(true)
    expect(isLeapYear(2027)).toBe(false)
    expect(isLeapYear(1900)).toBe(false)
    expect(isLeapYear(2000)).toBe(true)
  })
})

describe('upcomingCelebrants', () => {
  const roster = [
    member({ $id: 'today', first_name: 'Today', birth_month: 3, birth_day: 14 }),
    member({ $id: 'tomorrow', first_name: 'Tom', birth_month: 3, birth_day: 15 }),
    member({ $id: 'nextweek', first_name: 'Week', birth_month: 3, birth_day: 21 }),
    member({ $id: 'faraway', first_name: 'Far', birth_month: 9, birth_day: 1 }),
    member({ $id: 'nobirthday', first_name: 'None' }),
  ]

  it('returns the window soonest first', () => {
    const rows = upcomingCelebrants(roster, '2026-03-14', 7)
    expect(rows.map((r) => r.$id)).toEqual(['today', 'tomorrow', 'nextweek'])
    expect(rows.map((r) => r.days_away)).toEqual([0, 1, 7])
  })

  it('skips members with no birthday recorded', () => {
    const rows = upcomingCelebrants(roster, '2026-03-14', 365)
    expect(rows.map((r) => r.$id)).not.toContain('nobirthday')
  })

  it('excludes inactive members — no shoutout for someone who has left', () => {
    const rows = upcomingCelebrants(
      [member({ $id: 'gone', birth_month: 3, birth_day: 15, status: 'inactive' })],
      '2026-03-14',
      7,
    )
    expect(rows).toEqual([])
  })

  it('breaks ties on the same day by name', () => {
    const rows = upcomingCelebrants(
      [
        member({ $id: 'b', first_name: 'Zara', birth_month: 3, birth_day: 15 }),
        member({ $id: 'a', first_name: 'Abena', birth_month: 3, birth_day: 15 }),
      ],
      '2026-03-14',
      7,
    )
    expect(rows.map((r) => r.$id)).toEqual(['a', 'b'])
  })

  it('builds the full name from all three parts', () => {
    const rows = upcomingCelebrants(
      [
        member({
          $id: 'x',
          first_name: 'Kofi',
          other_names: 'Nana',
          last_name: 'Mensah',
          birth_month: 3,
          birth_day: 15,
        }),
      ],
      '2026-03-14',
      7,
    )
    expect(rows[0].full_name).toBe('Kofi Nana Mensah')
  })
})

describe('celebrantsForNotification', () => {
  const roster = [
    member({ $id: 'today', first_name: 'Today', birth_month: 3, birth_day: 14 }),
    member({ $id: 'tomorrow', first_name: 'Tom', birth_month: 3, birth_day: 15 }),
    member({ $id: 'twodays', first_name: 'Two', birth_month: 3, birth_day: 16 }),
  ]

  it('is exactly the day before — not today, not a window', () => {
    // A window would re-announce the same person every morning until their
    // birthday, and a team that gets the same alert four times stops reading
    // them.
    const rows = celebrantsForNotification(roster, '2026-03-14')
    expect(rows.map((r) => r.$id)).toEqual(['tomorrow'])
  })

  it('is empty on a day nobody is celebrating tomorrow', () => {
    expect(celebrantsForNotification(roster, '2026-03-20')).toEqual([])
  })

  it('still finds the celebrant across New Year', () => {
    const rows = celebrantsForNotification(
      [member({ $id: 'ny', first_name: 'New', birth_month: 1, birth_day: 1 })],
      '2026-12-31',
    )
    expect(rows.map((r) => r.$id)).toEqual(['ny'])
    expect(rows[0].date).toBe('2027-01-01')
  })
})

describe('birthdayNotificationText', () => {
  const c = (name: string) => ({ full_name: name }) as Parameters<typeof birthdayNotificationText>[0][number]

  it('names one person', () => {
    const { title, body } = birthdayNotificationText([c('Ama Serwaa')])
    expect(title).toBe('1 birthday tomorrow')
    expect(body).toContain('Ama Serwaa')
  })

  it('names up to three', () => {
    const { title, body } = birthdayNotificationText([c('A B'), c('C D'), c('E F')])
    expect(title).toBe('3 birthdays tomorrow')
    expect(body).toBe('A B, C D and E F — time to prepare the shoutout.')
  })

  it('summarises beyond three rather than overflowing the notification', () => {
    const { body } = birthdayNotificationText([c('A'), c('B'), c('C'), c('D'), c('E')])
    expect(body).toBe('A, B and C and 2 more.')
  })
})

describe('addDaysISO', () => {
  it('rolls over a month end', () => {
    expect(addDaysISO('2026-01-31', 1)).toBe('2026-02-01')
  })

  it('rolls over a year end', () => {
    expect(addDaysISO('2026-12-31', 1)).toBe('2027-01-01')
  })

  it('knows February is 28 days in a common year and 29 in a leap year', () => {
    expect(addDaysISO('2027-02-28', 1)).toBe('2027-03-01')
    expect(addDaysISO('2028-02-28', 1)).toBe('2028-02-29')
  })

  it('round-trips with nextOccurrence for tomorrow', () => {
    // The dashboard labels its card with addDaysISO and fills it with
    // nextOccurrence. If these two ever disagree the card names one day and
    // lists the people from another.
    const today = '2026-12-31'
    expect(addDaysISO(today, 1)).toBe(nextOccurrence(1, 1, today).date)
  })

  it('goes backwards too', () => {
    expect(addDaysISO('2026-03-01', -1)).toBe('2026-02-28')
  })
})

describe('labels', () => {
  it('reads naturally', () => {
    expect(daysAwayLabel(0)).toBe('Today')
    expect(daysAwayLabel(1)).toBe('Tomorrow')
    expect(daysAwayLabel(5)).toBe('In 5 days')
    expect(monthDayLabel(3, 14)).toBe('14 March')
  })
})
