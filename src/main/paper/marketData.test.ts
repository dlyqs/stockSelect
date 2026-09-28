import { describe, it, expect, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { schema } from './storage/schema'
import { sessionAt, regularBar } from './calendar'
import { MarketDataService } from './marketData'
import { AlpacaPaperSource } from './marketSource'
import { PaperRepository } from './storage/repository'
import { microdollars } from './quality'
import type { PaperBar } from '../../shared/paper/types'
const minute = Date.parse('2026-09-28T14:00:00Z')
function bar(symbol = 'AAPL', time = minute, close = 100_000_000): PaperBar {
  return { source: 'alpaca', feed: 'iex', interval: '1Min', symbol, marketTime: time, receivedAt: minute+65_000, open: close, high: close, low: close, close, volume: 1, quality: 'fresh' }
}
describe('paper market calendar and raw data', () => {
  it('bounds calendar coverage, holidays, DST and half days', () => {
    expect(sessionAt(Date.parse('2026-03-06T17:00:00Z'))?.open).toBe(Date.parse('2026-03-06T14:30:00Z'))
    expect(sessionAt(Date.parse('2026-03-09T17:00:00Z'))?.open).toBe(Date.parse('2026-03-09T13:30:00Z'))
    expect(sessionAt(Date.parse('2026-11-27T17:00:00Z'))?.close).toBe(Date.parse('2026-11-27T18:00:00Z'))
    expect(sessionAt(Date.parse('2026-07-03T17:00:00Z'))).toBeNull()
    expect(regularBar(Date.parse('2026-12-24T18:00:00Z'))).toBe(false)
    expect(() => sessionAt(Date.parse('2027-01-04T17:00:00Z'))).toThrow('CALENDAR_UNCOVERED')
  })
  it('shares one batch for ten symbols and rejects an eleventh atomically', async () => {
    const repo = new PaperRepository(':memory:')
    try {
      const symbols = ['AAPL','SPY','QQQ','IWM','DIA','MSFT','NVDA','TSLA','GOOG','META']
      const bars = vi.fn(async () => symbols.map(s => bar(s)))
      const market = new MarketDataService({ bars, trades: async () => [] },repo,() => minute+65_000)
      market.subscribe('a',symbols); market.subscribe('b',['AAPL'])
      expect(() => market.subscribe('c',['XYZ'])).toThrow('SYMBOL_LIMIT')
      const results = await Promise.all([market.poll(),market.poll()])
      expect(bars).toHaveBeenCalledTimes(1)
      expect(Object.keys(results[0]!.bars)).toHaveLength(10)
      expect(results[1]).toBeNull(); expect(market.symbols).toEqual([...symbols].sort())
    } finally { repo.close() }
  })
  it('does not replay warmup, partial, late, duplicate or corrected bars', async () => {
    const repo = new PaperRepository(':memory:'); let now = minute+65_000
    let response = [bar('AAPL',minute-60_000)]
    const source = { bars: vi.fn(async () => response), trades: async () => [] }
    const market = new MarketDataService(source,repo,() => now)
    try {
      market.subscribe('a',['AAPL','SPY']); await market.warmup(['AAPL','SPY'])
      expect(market.bars('AAPL')).toHaveLength(1)
      response = [bar(),bar('SPY',minute+60_000)]
      expect(await market.poll()).toBeNull()
      now = minute+115_000
      expect((await market.poll())!.missing).toEqual(['SPY'])
      expect(await market.poll()).toBeNull()
      now = minute+125_000
      response = [{...bar('AAPL',minute,101_000_000),receivedAt: now}, {...bar('SPY',minute),receivedAt: now}, {...bar('AAPL',minute+60_000),receivedAt: now}]
      expect(await market.poll()).toBeNull()
      expect(repo.qualityRecords().map(q => q.reason)).toEqual(expect.arrayContaining(['WARMUP_ONLY','WARMUP_EMPTY','MISSING','CORRECTED','LATE']))
      expect(market.bars('AAPL').find(b => b.marketTime === minute)?.close).toBe(100_000_000)
    } finally { repo.close() }
  })
  it('uses raw IEX, paginates, rounds microdollars and honors shared rate backoff', async () => {
    let now = minute
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify({ bars: {}, next_page_token: 'next' }))).mockResolvedValueOnce(new Response(JSON.stringify({ bars: { AAPL: [{t:'2026-09-28T14:00:00Z',o:1.0000005,h:1.0000005,l:1.0000005,c:1.0000005,v:1}] } })))
    const source = new AlpacaPaperSource(() => 'id:secret', () => now, request)
    expect((await source.bars(['AAPL'],minute,minute+60_000))[0].close).toBe(1_000_001)
    const url = new URL(String(request.mock.calls[1][0]))
    expect(url.searchParams.get('feed')).toBe('iex'); expect(url.searchParams.get('adjustment')).toBe('raw'); expect(url.searchParams.get('page_token')).toBe('next')
    request.mockResolvedValueOnce(new Response('',{status:429,headers:{'Retry-After':'30'}}))
    await expect(source.trades(['AAPL'])).rejects.toThrow('RATE_LIMIT')
    await expect(source.bars(['AAPL'],minute,minute)).rejects.toThrow('BACKOFF')
    expect(request).toHaveBeenCalledTimes(3)
    now += 30_000; request.mockResolvedValueOnce(new Response('',{status:403}))
    await expect(source.trades(['AAPL'])).rejects.toThrow('PERMISSION')
    expect(microdollars(1e-6)).toBe(1)
  })
  it('bounds aggregate requests and separates network from missing credentials', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}'))
    const source = new AlpacaPaperSource(() => null,() => minute,request)
    await expect(source.trades(['AAPL'])).rejects.toThrow('NO_KEY'); expect(request).not.toHaveBeenCalled()
    const network = new AlpacaPaperSource(() => 'id:key',() => minute,vi.fn().mockRejectedValue(new Error('private network details')))
    await expect(network.trades(['AAPL'])).rejects.toThrow('NETWORK')
    const quota = new AlpacaPaperSource(() => 'id:key',() => minute,async () => new Response('{"trades":{}}'))
    for (let i=0;i<60;i++) await quota.trades(['AAPL'])
    await expect(quota.trades(['AAPL'])).rejects.toThrow('LOCAL_RATE_LIMIT')
  })
  it('migrates a v1 ledger without replacing its source versions or history', () => {
    const directory = mkdtempSync(join(tmpdir(),'paper-v1-')); const file = join(directory,'paper.sqlite')
    try {
      const old = new Database(file); old.exec(schema); old.pragma('user_version=1')
      old.prepare('INSERT INTO strategy_versions VALUES (?,?,?,?,?)').run('old','original','hash','build',1)
      old.close()
      const repo = new PaperRepository(file)
      try {
        repo.recordQuality({symbol:'AAPL',marketTime:minute,observedAt:minute,reason:'MIGRATED',mode:'warmup'})
        expect(repo.qualityRecords()).toHaveLength(1)
        expect(() => repo.registerVersion('old','changed','build')).toThrow('VERSION_IMMUTABLE')
      } finally { repo.close() }
      const check = new Database(file)
      expect(check.pragma('user_version',{simple:true})).toBe(2)
      expect((check.prepare('SELECT source FROM strategy_versions WHERE id=?').get('old') as {source:string}).source).toBe('original')
      check.close()
    } finally { rmSync(directory,{recursive:true,force:true}) }
  })

})
