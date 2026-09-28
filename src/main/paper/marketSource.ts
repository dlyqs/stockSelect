import { z } from 'zod'
import type { PaperBar, TradeReference } from '../../shared/paper/types'
import { MarketError, microdollars } from './quality'
export interface MarketSource {
  bars(symbols: string[], start: number, end: number): Promise<PaperBar[]>
  trades(symbols: string[]): Promise<TradeReference[]>
}
const vendorBar = z.object({ t: z.string().datetime({ offset: true }), o: z.number(), h: z.number(), l: z.number(), c: z.number(), v: z.number().nonnegative() })
const vendorTrade = z.object({ t: z.string().datetime({ offset: true }), p: z.number() })
/** Separate raw IEX path; no chart caches or provider fallback. All requests share one budget. */
export class AlpacaPaperSource implements MarketSource {
  private requests: number[] = []
  private blockedUntil = 0
  private failures = 0
  constructor(private getKey: () => string | null, private now = Date.now, private request: typeof fetch = fetch) {}
  private async get(path: string, params: Record<string,string>): Promise<unknown> {
    const raw = this.getKey(); const split = raw?.indexOf(':') ?? -1
    if (!raw || split <= 0 || split === raw.length - 1) throw new MarketError('NO_KEY')
    const now = this.now()
    this.requests = this.requests.filter(t => t > now - 60_000)
    if (now < this.blockedUntil) throw new MarketError('BACKOFF', this.blockedUntil - now)
    // Reserve capacity for the pre-existing terminal's quote/chart requests.
    if (this.requests.length >= 60) throw new MarketError('LOCAL_RATE_LIMIT', 60_000)
    this.requests.push(now)
    const url = new URL(`https://data.alpaca.markets/v2/stocks/${path}`)
    for (const [key,value] of Object.entries({ ...params, feed: 'iex' })) url.searchParams.set(key,value)
    try {
      const response = await this.request(url, { headers: { 'APCA-API-KEY-ID': raw.slice(0,split), 'APCA-API-SECRET-KEY': raw.slice(split+1) }, signal: AbortSignal.timeout(10_000) })
      if (response.status === 401 || response.status === 403) throw new MarketError('PERMISSION')
      if (!response.ok) {
        const retry = response.headers.get('retry-after')
        const delay = retry ? (Number.isFinite(Number(retry)) ? Number(retry) * 1000 : Date.parse(retry) - this.now()) : 0
        throw new MarketError(response.status === 429 ? 'RATE_LIMIT' : `HTTP_${response.status}`, Math.max(0, delay || 0))
      }
      const result: unknown = await response.json()
      this.failures = 0
      return result
    } catch (error) {
      const failure = error instanceof MarketError ? error : new MarketError('NETWORK')
      this.blockedUntil = this.now() + Math.max(failure.retryMs, Math.min(60_000, 1000 * 2 ** Math.min(this.failures++, 6)))
      throw failure
    }
  }
  async bars(symbols: string[], start: number, end: number): Promise<PaperBar[]> {
    if (!symbols.length) return []
    const result: PaperBar[] = []; let token: string | undefined
    for (let page = 0; page < 8; page++) {
      const payload = z.object({ bars: z.record(z.array(vendorBar)), next_page_token: z.string().nullable().optional() }).parse(await this.get('bars', {
        symbols: symbols.join(','), timeframe: '1Min', adjustment: 'raw', start: new Date(start).toISOString(), end: new Date(end).toISOString(), limit: '10000', ...(token ? { page_token: token } : {})
      }))
      const receivedAt = this.now()
      for (const [symbol, bars] of Object.entries(payload.bars)) for (const b of bars) result.push({ source: 'alpaca', feed: 'iex', interval: '1Min', symbol, marketTime: Date.parse(b.t), receivedAt, open: microdollars(b.o), high: microdollars(b.h), low: microdollars(b.l), close: microdollars(b.c), volume: b.v, quality: 'unverified' })
      token = payload.next_page_token ?? undefined
      if (!token) return result
    }
    throw new MarketError('PAGINATION_LIMIT')
  }
  async trades(symbols: string[]): Promise<TradeReference[]> {
    if (!symbols.length) return []
    const payload = z.object({ trades: z.record(vendorTrade) }).parse(await this.get('trades/latest', { symbols: symbols.join(',') }))
    const receivedAt = this.now()
    return Object.entries(payload.trades).map(([symbol,t]) => ({ source: 'alpaca', feed: 'iex', symbol, price: microdollars(t.p), marketTime: Date.parse(t.t), receivedAt }))
  }
}
