/** Reviewed NYSE 2026 calendar: https://www.nyse.com/markets/hours-calendars
 * Coverage is deliberately bounded. Unknown years fail closed, including warmup.
 */
const holidays = new Set(['2026-01-01','2026-01-19','2026-02-16','2026-04-03','2026-05-25','2026-06-19','2026-07-03','2026-09-07','2026-11-26','2026-12-25'])
const halfDays = new Set(['2026-11-27', '2026-12-24'])
const formatter = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' })
export interface Session { date: string; open: number; close: number }
export function sessionAt(time: number): Session | null {
  if (!Number.isSafeInteger(time) || time < 0) throw new Error('INVALID_TIME')
  const parts = formatter.formatToParts(time)
  const get = (key: string): string => parts.find(p => p.type === key)!.value
  if (get('year') !== '2026') throw new Error('CALENDAR_UNCOVERED')
  const date = `${get('year')}-${get('month')}-${get('day')}`
  if (['Sat','Sun'].includes(get('weekday')) || holidays.has(date)) return null
  const minute = Number(get('hour')) * 60 + Number(get('minute'))
  const midnight = Math.floor(time / 60_000) * 60_000 - minute * 60_000
  return { date, open: midnight + 570 * 60_000, close: midnight + (halfDays.has(date) ? 780 : 960) * 60_000 }
}
export function regularBar(time: number): boolean {
  const session = sessionAt(time)
  return time % 60_000 === 0 && !!session && time >= session.open && time + 60_000 <= session.close
}
