import { z } from 'zod'
import type { CheckReason, Readiness } from '../../shared/paper/workbench'
/** Never retain keys or response bodies in state, IPC or logs. Only a generation is retained. */
export class ReadinessChecker {
  private generation = 0
  private value: Readiness = { checkedAt: null, iex: 'UNVERIFIED', assets: 'UNVERIFIED' }
  private pending: Promise<Readiness> | null = null
  constructor(private getKey: () => string | null, private request: typeof fetch = fetch, private now = Date.now) {}
  invalidate(): void { this.generation++; this.value = { checkedAt: null, iex: 'UNVERIFIED', assets: 'UNVERIFIED' }; this.pending = null }
  state(): Readiness { return { ...this.value } }
  check(): Promise<Readiness> {
    if (this.pending) return this.pending
    const generation = this.generation
    const key = this.getKey(), split = key?.indexOf(':') ?? -1
    const work = async (): Promise<Readiness> => {
      const test = async (endpoint: 'iex' | 'assets'): Promise<CheckReason> => {
        if (!key || split <= 0 || split === key.length - 1) return 'NO_KEY'
        try {
          const url = endpoint === 'iex' ? 'https://data.alpaca.markets/v2/stocks/trades/latest?symbols=SPY&feed=iex' : 'https://paper-api.alpaca.markets/v2/assets/SPY'
          const response = await this.request(url, { headers: { 'APCA-API-KEY-ID': key.slice(0,split), 'APCA-API-SECRET-KEY': key.slice(split+1) }, signal: AbortSignal.timeout(10000) })
          if ([401,403].includes(response.status)) return 'PERMISSION'
          if (response.status === 429) return 'RATE_LIMIT'
          if (!response.ok) return 'NETWORK'
          const body = await response.json()
          return (endpoint === 'iex' ? z.object({trades:z.record(z.object({t:z.string().datetime({offset:true}),p:z.number().positive()}))}).safeParse(body).success : z.object({symbol:z.literal('SPY'),class:z.literal('us_equity')}).safeParse(body).success) ? 'OK' : 'INVALID_RESPONSE'
        } catch { return 'NETWORK' }
      }
      const [iex, assets] = await Promise.all([test('iex'), test('assets')])
      if (generation === this.generation) this.value = { checkedAt: this.now(), iex, assets }
      return this.state()
    }
    const task = work().finally(() => { if (generation === this.generation) this.pending = null })
    this.pending = task
    return task
  }
}
