import { describe, it, expect, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { PaperRepository } from './storage/repository'
import { MarketDataService } from './marketData'
import { PaperTradingService } from './service'
import { StrategyWorkers } from './strategyWorker'
import { strategyVersions, parametersFor } from '../../strategies/registry'
import { evaluateTemplate } from '../../strategies/templates'
import type { PaperBar, RunConfig, StrategyContext } from '../../shared/paper/types'
const U = 1_000_000
const base = Date.parse('2026-09-28T14:00:00Z')
function bar(time: number, receivedAt: number, close = 100*U): PaperBar {
  return { source: 'alpaca', feed: 'iex', symbol: 'AAPL', interval: '1Min', marketTime: time, receivedAt, open: close, high: close, low: close, close, volume: 100, quality: 'fresh' }
}
const config: RunConfig = { symbols: ['AAPL'], initialCash: 1000*U, fee: 0, slippageBps: 0, maxPositionBps: 10000, parameters: {fast:2,slow:3,quantity:1}, strategyVersion: strategyVersions[0].id }
function harness(path = ':memory:', workers = new StrategyWorkers()) {
  let now = base
  const repo = new PaperRepository(path)
  let freshReference = false
  const source = {
    bars: vi.fn(async (_symbols: string[],start: number,end: number) => {
      if (end-start > 120_000) return [bar(base-180_000,now,97*U),bar(base-120_000,now,98*U),bar(base-60_000,now,99*U)]
      const time = Math.floor(now/60_000)*60_000-60_000
      return [bar(time,now,100*U)]
    }),
    trades: vi.fn(async () => [{ source: 'alpaca' as const, feed: 'iex' as const, symbol: 'AAPL', price: 101*U, marketTime: freshReference ? now-1 : base, receivedAt: now }])
  }
  const market = new MarketDataService(source,repo,() => now)
  const service = new PaperTradingService(repo,market,workers,() => now)
  return { repo, source, market, service, setTime: (time: number) => { now=time }, fresh: () => {freshReference=true}, close: async () => { service.shutdown(); await market.drain(); repo.close() } }
}
describe('paper strategy runtime', () => {
  it('freezes parameters, runs all three templates and rejects invalid windows', () => {
    expect(() => parametersFor('sma',{fast:30,slow:10})).toThrow()
    const context: StrategyContext = { account:{cash:1000*U,income:0,realizedPnl:0,positions:[]}, bars:{AAPL:[bar(base-120_000,base,98*U),bar(base-60_000,base,99*U),bar(base,base,100*U)]}, parameters:{fast:2,slow:3,quantity:1},state:null }
    expect(evaluateTemplate('sma',context).intents[0].side).toBe('buy')
    expect(evaluateTemplate('breakout',{...context,parameters:{lookback:2,quantity:1}}).intents[0].side).toBe('buy')
    const descending = {...context,bars:{AAPL:[bar(base-120_000,base,100*U),bar(base-60_000,base,99*U),bar(base,base,98*U)]},parameters:{period:2,lower:30,upper:70,quantity:1}}
    expect(evaluateTemplate('rsi',descending).intents[0].side).toBe('buy')
    expect(evaluateTemplate('sma',{...context,state:{AAPL:1}}).intents).toEqual([])
  })
  it('shares warmup and live data, isolates cash, waits for later observed price, and never repeats a batch', async () => {
    const h = harness()
    try {
      await h.service.initialize(); h.service.create('a',config); h.service.create('b',{...config,initialCash:2000*U})
      await h.service.start('a'); await h.service.start('b')
      expect(h.source.bars).toHaveBeenCalledTimes(1)
      expect(h.repo.pending('a')).toEqual([])
      h.setTime(base+65_000); await h.service.tick()
      expect(h.repo.pending('a')).toHaveLength(1); expect(h.repo.getRun('a').account.cash).toBe(1000*U)
      h.fresh(); h.setTime(base+70_000); await h.service.tick()
      expect(h.repo.getRun('a').account.cash).toBe(899*U); expect(h.repo.getRun('b').account.cash).toBe(1899*U)
      await h.service.tick()
      expect(h.repo.events().filter(e => e.event.type==='decision')).toHaveLength(2)
      expect(h.repo.events().filter(e => e.event.type==='filled')).toHaveLength(2)
    } finally { await h.close() }
  })
  it('persists checkpoints across restart, cancels old intentions, preserves explicit pauses and skips recovery trading', async () => {
    const directory = mkdtempSync(join(tmpdir(),'paper-runtime-')); const file = join(directory,'paper.sqlite')
    const h = harness(file)
    try {
      await h.service.initialize(); h.service.create('a',config); h.service.create('b',config)
      await h.service.start('a'); await h.service.start('b'); h.setTime(base+65_000); await h.service.tick()
      h.service.pause('b'); expect(h.repo.pending('a')).toHaveLength(1)
      h.service.halt(); h.repo.close() // emulate abnormal process exit without orderly pause
      const next = harness(file)
      try {
        next.setTime(base+600_000); await next.service.initialize()
        expect(next.repo.getRun('a').status).toBe('running'); expect(next.repo.getRun('b').status).toBe('paused')
        expect(next.repo.getCheckpoint('a').state).toEqual({AAPL:1}); expect(next.repo.pending('a')).toEqual([])
        expect(next.repo.events().filter(e => e.event.type==='filled')).toHaveLength(0)
        expect(next.repo.events().some(e => e.event.reason==='RESTART_REQUIRES_WARMUP')).toBe(true)
      } finally { await next.close() }
    } finally { rmSync(directory,{recursive:true,force:true}) }
  })
  it('records suspend gaps, cancels pending intents and warms before resuming', async () => {
    const h = harness()
    try {
      await h.service.initialize(); h.service.create('a',config); await h.service.start('a')
      h.setTime(base+65_000); await h.service.tick(); h.service.suspend()
      expect(h.repo.pending('a')).toEqual([]); expect(h.repo.getRun('a').status).toBe('paused')
      h.setTime(base+600_000); await h.service.resume(); h.fresh(); await h.service.tick()
      expect(h.repo.getRun('a').account.positions).toEqual([])
      expect(h.repo.qualityRecords().some(q => q.reason==='SYSTEM_SUSPEND')).toBe(true)
      expect(h.source.bars).toHaveBeenCalledTimes(3)
    } finally { await h.close() }
  })
  it('bounds worker time/output and isolates a crashed instance', async () => {
    const h = harness(undefined,new StrategyWorkers(300,`function(kind,context) { if(context.account.cash===1000000000) { while(true){} } return {intents:[],nextState:{}} }`))
    try {
      await h.service.initialize(); h.service.create('a',config); h.service.create('b',{...config,initialCash:2000*U})
      await h.service.start('a'); await h.service.start('b'); h.setTime(base+65_000); await h.service.tick()
      expect(h.repo.getRun('a').status).toBe('paused'); expect(h.repo.getRun('b').status).toBe('running')
      expect(h.repo.events().some(e => e.event.reason==='WORKER_TIMEOUT')).toBe(true)
    } finally { await h.close() }
    const context: StrategyContext = {bars:{},account:{cash:0,income:0,realizedPnl:0,positions:[]},parameters:{},state:null}
    for (const code of ['function(){ process.exit(1) }','function(){ return {intents:[],nextState:"x".repeat(70000)} }','function(){ return {intents:[{quantity:-1}],nextState:{}} }']) {
      const workers = new StrategyWorkers(500,code)
      await expect(workers.evaluate('a','sma',context)).rejects.toThrow(); workers.close()
    }
  })
  it('expires intentions without any trade and halts scheduling on durable write failure', async () => {
    const directory = mkdtempSync(join(tmpdir(),'paper-runtime-')); const file = join(directory,'paper.sqlite')
    const h = harness(file)
    try {
      await h.service.initialize(); h.service.create('a',config); await h.service.start('a')
      h.setTime(base+65_000); await h.service.tick()
      h.setTime(base+126_000); h.source.trades.mockResolvedValue([]); await h.service.tick()
      expect(h.repo.pending('a')).toEqual([])
      const db = (h.repo as unknown as {db: Database.Database}).db
      db.pragma('query_only = ON')
      h.setTime(base+185_000); await h.service.tick()
      expect(h.repo.halted).toBe(true); expect(h.repo.getRun('a').status).toBe('error')
      const requests = h.source.bars.mock.calls.length
      h.setTime(base+245_000); await h.service.tick()
      expect(h.source.bars).toHaveBeenCalledTimes(requests)
      expect(h.repo.events().filter(e => e.event.type==='filled')).toHaveLength(0)
    } finally { await h.close(); rmSync(directory,{recursive:true,force:true}) }
  })
  it('prevents a late worker response from committing after a user pause', async () => {
    let release: (() => void) | undefined
    let entered: (() => void) | undefined
    const executing = new Promise<void>(resolve => { entered = resolve })
    const workers = new StrategyWorkers()
    const h = harness(undefined,workers)
    try {
      await h.service.initialize(); h.service.create('a',config); await h.service.start('a')
      vi.spyOn(workers,'evaluate').mockImplementation(async () => {
        entered!(); await new Promise<void>(resolve => {release=resolve})
        return {intents:[{id:'late',symbol:'AAPL',side:'buy',quantity:1,reason:'test'}],nextState:{}}
      })
      h.setTime(base+65_000); const tick = h.service.tick(); await executing
      h.service.pause('a'); release!(); await tick
      expect(h.repo.pending('a')).toEqual([])
      expect(h.repo.events().some(row => row.event.type==='decision')).toBe(false)
    } finally { await h.close() }
  })
  it('recovers from a timer gap with warmup and preserves orderly shutdown recovery', async () => {
    const directory = mkdtempSync(join(tmpdir(),'paper-clean-')); const file = join(directory,'paper.sqlite')
    const h = harness(file)
    try {
      await h.service.initialize(); h.service.create('a',config); await h.service.start('a')
      h.setTime(base+65_000); await h.service.tick()
      h.setTime(base+600_000); await h.service.tick()
      expect(h.repo.pending('a')).toEqual([])
      expect(h.repo.qualityRecords().some(q => q.mode==='recovery')).toBe(true)
      await h.close()
      const next = harness(file)
      try {
        next.setTime(base+900_000); await next.service.initialize()
        expect(next.repo.getRun('a').status).toBe('running')
        expect(next.repo.getRun('a').account.positions).toEqual([])
      } finally { await next.close() }
    } finally { rmSync(directory,{recursive:true,force:true}) }
  })
  it('skips incomplete batches and pauses for unreviewed large price jumps', async () => {
    const h = harness()
    try {
      await h.service.initialize(); h.service.create('a',config); await h.service.start('a')
      h.source.bars.mockResolvedValueOnce([])
      h.setTime(base+115_000); await h.service.tick()
      expect(h.repo.getRun('a').status).toBe('data_insufficient')
      h.source.bars.mockResolvedValueOnce([bar(base+60_000,base+125_000,200*U)])
      h.setTime(base+125_000); await h.service.tick()
      expect(h.repo.getRun('a').status).toBe('paused')
      expect(h.repo.events().some(e => e.event.reason==='CORPORATE_ACTION_REVIEW')).toBe(true)
    } finally { await h.close() }
  })

})
