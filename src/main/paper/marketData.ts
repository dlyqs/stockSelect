import { symbolSchema } from '../../shared/paper/schemas'
import type { PaperBar, TradeReference } from '../../shared/paper/types'
import { regularBar, sessionAt } from './calendar'
import { barSchema, MarketError, type QualityRecord } from './quality'
import type { MarketSource } from './marketSource'
export interface MarketStore { saveBar(bar: PaperBar): PaperBar; recordQuality(record: QualityRecord): void }
export interface BarBatch { time: number; bars: Record<string,PaperBar>; missing: string[] }
/** Single collector shared by all runs; scheduling and warmup use the same serial lane. */
export class MarketDataService {
  private owners = new Map<string,string[]>()
  private history = new Map<string,PaperBar[]>()
  private historyUpdated = new Map<string,number>()
  private lastBatch: number | undefined
  private accepted = new Map<string,PaperBar>()
  private current: number | undefined
  private lane: Promise<unknown> = Promise.resolve()
  private lastError = ''
  constructor(private source: MarketSource, private store: MarketStore, private now = Date.now, private log: (event: string, fields: Record<string,unknown>) => void = () => {}) {}
  subscribe(owner: string, symbols: string[]): void {
    symbols.forEach(s => symbolSchema.parse(s))
    const next = new Map(this.owners); next.set(owner, [...new Set(symbols)])
    if (new Set([...next.values()].flat()).size > 10) throw new Error('SYMBOL_LIMIT')
    this.owners = next
  }
  unsubscribe(owner: string): void { this.owners.delete(owner) }
  get symbols(): string[] { return [...new Set([...this.owners.values()].flat())].sort() }
  bars(symbol: string): PaperBar[] { return structuredClone(this.history.get(symbol) ?? []) }
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const task = this.lane.then(fn); this.lane = task.catch(() => {}); return task
  }
  private quality(symbol: string, time: number, reason: string, mode: QualityRecord['mode']): void {
    this.store.recordQuality({ symbol, marketTime: time, observedAt: this.now(), reason, mode })
  }
  private remember(bar: PaperBar): void {
    const bars = this.history.get(bar.symbol) ?? []
    if (!bars.some(b => b.marketTime === bar.marketTime)) bars.push(bar)
    bars.sort((a,b) => a.marketTime-b.marketTime)
    this.history.set(bar.symbol,bars.slice(-300)); this.historyUpdated.set(bar.symbol,this.now())
  }
  warmup(symbols: string[], mode: 'warmup' | 'recovery' = 'warmup'): Promise<void> {
    return this.serial(async () => {
      symbols = symbols.filter(s => this.now() - (this.historyUpdated.get(s) ?? 0) >= 60_000)
      if (!symbols.length) return
      const end = Math.floor(this.now()/60_000)*60_000
      sessionAt(end) // Fail closed for uncovered calendar years.
      const start = Math.max(Date.UTC(2026,0,1),end - 7*86_400_000)
      const data = await this.source.bars(symbols,start,end-1)
      const grouped = new Map<string,PaperBar[]>()
      for (const raw of data) {
        const b = barSchema.parse(raw)
        if (!symbols.includes(b.symbol) || b.marketTime < start || b.marketTime+60_000 > end || !regularBar(b.marketTime)) continue
        b.quality = 'unverified'; this.store.saveBar(b)
        const list = grouped.get(b.symbol) ?? []; list.push(b); grouped.set(b.symbol,list)
      }
      for (const symbol of symbols) {
        const unique = new Map((grouped.get(symbol) ?? []).map(b => [b.marketTime,b]))
        this.history.set(symbol,[...unique.values()].sort((a,b) => a.marketTime-b.marketTime).slice(-300))
        this.historyUpdated.set(symbol,this.now())
        this.quality(symbol,end,unique.size ? 'WARMUP_ONLY' : 'WARMUP_EMPTY',mode)
      }
    })
  }
  reset(reason: string): void {
    const now = this.now()
    for (const symbol of this.symbols) this.quality(symbol,now,reason,'recovery')
    this.lastBatch = Math.floor(now/60_000)*60_000 - 60_000
    this.current = undefined; this.accepted.clear(); this.history.clear(); this.historyUpdated.clear()
  }
  poll(): Promise<BarBatch | null> {
    return this.serial(async () => {
      const now = this.now(); const time = Math.floor(now/60_000)*60_000-60_000
      const symbols = this.symbols
      if (!symbols.length || now < time+65_000 || this.lastBatch === time) return null
      if (!regularBar(time)) return null
      if (this.current !== time) {
        if (this.current !== undefined && this.lastBatch !== this.current) {
          for (const symbol of symbols) if (!this.accepted.has(symbol)) this.quality(symbol,this.current,'MISSING','live')
        }
        if (this.current !== undefined && time > this.current+60_000) {
          for (const symbol of symbols) this.quality(symbol,time,'SCHEDULER_GAP','recovery')
        }
        this.current = time; this.accepted.clear()
      }
      let data: PaperBar[] = []
      try {
        // Small overlap records late/corrected bars without replaying their decisions.
        data = await this.source.bars(symbols,time-60_000,time+59_999)
        if (this.lastError) this.log('data_recovered', {})
        this.lastError = ''
      } catch (error) {
        const code = error instanceof MarketError ? error.code : 'INVALID_RESPONSE'
        if (code !== this.lastError) {
          for (const symbol of symbols) this.quality(symbol,time,code,'live')
          this.log('data_error',{ reasonCode: code }); this.lastError = code
        }
        if (['NO_KEY','PERMISSION'].includes(code)) throw error
      }
      for (const raw of data) {
        const b = barSchema.parse(raw)
        if (!symbols.includes(b.symbol) || b.marketTime > time || !regularBar(b.marketTime) || b.receivedAt > this.now() || b.receivedAt < b.marketTime+60_000) continue
        b.quality = b.receivedAt > b.marketTime+120_000 ? 'late' : 'fresh'
        const stored = this.store.saveBar(b)
        if (stored.quality === 'corrected' || b.quality === 'late') this.quality(b.symbol,b.marketTime,stored.quality === 'corrected' ? 'CORRECTED' : 'LATE','live')
        if (b.marketTime === time && stored.quality !== 'corrected' && b.quality === 'fresh') this.accepted.set(b.symbol,b)
      }
      const missing = symbols.filter(s => !this.accepted.has(s))
      if (missing.length && this.now() < time+115_000) return null
      for (const symbol of missing) this.quality(symbol,time,'MISSING','live')
      const bars = Object.fromEntries(this.accepted)
      for (const bar of this.accepted.values()) { this.remember(bar); this.quality(bar.symbol,time,'FRESH','live') }
      this.lastBatch = time
      this.log('batch',{ barTime: time, symbols: symbols.length, missing: missing.length })
      return { time, bars, missing }
    })
  }
  async drain(): Promise<void> { await this.lane }
  references(symbols: string[]): Promise<TradeReference[]> { return this.serial(() => this.source.trades([...new Set(symbols)].sort())) }
}
