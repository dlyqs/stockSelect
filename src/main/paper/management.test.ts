import { describe, it, expect, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { PaperRepository } from './storage/repository'
import { PaperManagement } from './management'
import { PaperTradingService } from './service'
import { MarketDataService } from './marketData'
import { history } from './queries'
import { stageRestore } from './backup'
import { performance, compare } from './performance'
import { actionSchema, historySchema, type Valuation } from '../../shared/paper/management'
import { strategyVersions } from '../../strategies/registry'
import type { Fill, PaperBar, RunConfig } from '../../shared/paper/types'
const U=1e6, base=Date.parse('2026-09-28T14:00:00Z')
const config:RunConfig={symbols:['AAPL'],initialCash:1000*U,fee:U,slippageBps:0,maxPositionBps:10000,parameters:{fast:2,slow:3},strategyVersion:strategyVersions[0].id}
const bar=(time:number,price:number):PaperBar=>({source:'alpaca',feed:'iex',symbol:'AAPL',interval:'1Min',marketTime:time,receivedAt:time+65000,open:price,high:price,low:price,close:price,volume:100,quality:'fresh'})
const snap=(at:number,equity:number,quality:Valuation['quality']='fresh'):Valuation=>({at,equity,quality,prices:{},realized:0,unrealized:0,income:0})
function repository():PaperRepository { const r=new PaperRepository(':memory:');r.registerVersion(config.strategyVersion,'source','test');r.createRun('a',config,base);r.setStatus('a','running',base,'test');return r }
function fill(r:PaperRepository,id:string,side:'buy'|'sell',quantity:number,price:number,at:number):void {
  r.commitDecision('a',id,at,[{id,symbol:'AAPL',side,quantity,reason:'test'}],{})
  r.settle('a',id,{source:'alpaca',feed:'iex',symbol:'AAPL',price,marketTime:at+1,receivedAt:at+2},at+2,base+3600000)
}
describe('paper management and history',()=>{
  it('rejects malformed IPC, unvalidated symbols and an eleventh reservation',async()=>{
    expect(actionSchema.safeParse({type:'control',id:'a',action:'delete'}).success).toBe(false)
    expect(historySchema.safeParse({id:'a',from:2,to:1}).success).toBe(false)
    expect(historySchema.safeParse({id:'a',limit:100000}).success).toBe(false)
    const r=new PaperRepository(':memory:'),market=new MarketDataService({bars:async()=>[],trades:async()=>[]},r)
    const service=new PaperTradingService(r,market),validate=vi.fn(async()=>{}),m=new PaperManagement(service,validate)
    try {
      await service.initialize()
      await expect(m.action({type:'create',config})).rejects.toThrow('VALIDATE_INSTRUMENT_FIRST')
      await m.action({type:'add',symbol:'AAPL',kind:'stock'});await m.action({type:'add',symbol:'AAPL',kind:'stock'})
      await m.action({type:'create',config})
      await expect(m.action({type:'remove',symbol:'AAPL'})).rejects.toThrow('SYMBOL_IN_USE')
      for(const s of ['SPY','QQQ','DIA','IWM','MSFT','NVDA','AMD','META','GOOG'])await m.action({type:'add',symbol:s,kind:'stock'})
      await expect(m.action({type:'add',symbol:'TSLA',kind:'stock'})).rejects.toThrow('SYMBOL_LIMIT')
      expect(m.state().instruments).toHaveLength(10)
      const run=r.listRuns()[0];await m.action({type:'control',id:run.id,action:'end'});await m.action({type:'control',id:run.id,action:'archive'})
      await m.action({type:'remove',symbol:'AAPL'});expect(r.getRun(run.id).config).toEqual({...config,parameters:{fast:2,slow:3,quantity:1}})
    } finally {service.shutdown();r.close()}
  })
  it('reconciles fees, dividends and average cost against independent values; paginates immutable samples',()=>{
    const r=repository()
    try {
      r.saveBar(bar(base,100*U));fill(r,'buy','buy',5,100*U,base+65000)
      expect(r.getRun('a').account.cash).toBe(499*U)
      r.setStatus('a','paused',base+66000,'action')
      r.corporateAction('a',{id:'div',symbol:'AAPL',occurredAt:base+67000,type:'dividend',perShare:2*U})
      r.setStatus('a','running',base+68000,'resume');r.saveBar(bar(base+60000,110*U));fill(r,'sell','sell',2,110*U,base+125000)
      const v=r.valuation('a',base+125002)
      expect(v.equity).toBe(1058*U);expect(v.realized).toBe(18.6*U);expect(v.unrealized).toBe(29.4*U);expect(v.income).toBe(10*U)
      expect(v.realized+v.unrealized!+v.income).toBe(v.equity!-config.initialCash)
      const report=history(r,{id:'a',from:base,to:base+130000,limit:1,offset:1})
      expect(report.fills[0].side).toBe('sell');expect(report.counts.fills).toBe(2);expect(report.performance.closedTrades).toBe(0)
      expect(report.performance.returnPct).toBeCloseTo(5.8)
      expect(r.valuation('a',base+600000).quality).toBe('stale')
      expect(history(r,{id:'a',from:base+200000,to:base+300000}).fills).toEqual([])
    } finally {r.close()}
  })
  it('calculates cross-month returns, drawdown, zero trades, gaps and common observation returns',()=>{
    const jan=Date.parse('2026-01-30T20:00Z'),feb=Date.parse('2026-02-02T20:00Z'),march=Date.parse('2026-03-02T20:00Z')
    const result=performance(100,[snap(jan,110),snap(feb,99,'stale'),snap(march,120)],[])
    expect(result.maxDrawdownPct).toBeCloseTo(10);expect(result.months.map(m=>m.returnPct)).toEqual([expect.closeTo(10),expect.closeTo(-10),expect.closeTo(21.212121)])
    expect(result.closedTrades).toBe(0);expect(result.incomplete).toBe(true)
    expect(performance(100,[snap(jan,100)],[]).totalPnl).toBe(0)
    expect(performance(100,[],[]).returnPct).toBeNull()
    expect(compare([{id:'a',snapshots:[snap(jan,100),snap(feb,110)]},{id:'b',snapshots:[snap(jan,200),snap(feb,220)]}])?.returns.map(r=>r.returnPct)).toEqual([expect.closeTo(10),expect.closeTo(10)])
    expect(compare([{id:'a',snapshots:[snap(jan,100)]},{id:'b',snapshots:[snap(feb,200)]}])).toBeNull()
    const missing={...snap(jan+30000,100),equity:null,quality:'missing' as const}
    expect(compare([{id:'a',snapshots:[snap(jan,100),missing,snap(feb,110)]},{id:'b',snapshots:[snap(jan,200),snap(feb,220)]}])?.returns[0].points[1].value).toBeNull()
    const f=(side:'buy'|'sell',quantity:number,at:number):Fill=>({id:String(at),intentId:String(at),runId:'a',symbol:'AAPL',side,quantity,price:U,fee:0,marketTime:at,receivedAt:at})
    expect(performance(100,[],[f('buy',5,1),f('sell',4,3),f('sell',6,4)],false,[{id:'split',type:'split',symbol:'AAPL',numerator:2,denominator:1,occurredAt:2}]).closedTrades).toBe(1)
  })
  it('rolls back a multi-account corporate action when any account needs fractional cash',()=>{
    const r=repository()
    try {
      fill(r,'buy','buy',5,100*U,base+1000);r.createRun('b',config,base);r.setStatus('a','paused',base+2000,'action');r.setStatus('b','paused',base+2000,'action')
      expect(()=>r.corporateActions(['b','a'],{id:'split',type:'split',symbol:'AAPL',numerator:1,denominator:2,occurredAt:base+3000})).toThrow('CASH_IN_LIEU_REQUIRED')
      expect(r.historyRows('corporate_actions','b',0,Number.MAX_SAFE_INTEGER).count).toBe(0)
      expect(r.getRun('a').account.positions[0].quantity).toBe(5)
    } finally {r.close()}
  })
  it('restores SQLite and full JSON to new files, preserves originals and rejects damaged accounts',async()=>{
    const directory=mkdtempSync(join(tmpdir(),'paper-restore-')),r=repository()
    try {
      fill(r,'buy','buy',2,100*U,base+1000)
      const backup=join(directory,'backup.sqlite');await r.backup(backup)
      const restored=await stageRestore(r,backup,directory),opened=new PaperRepository(restored)
      expect(opened.getRun('a').account).toEqual(r.getRun('a').account);opened.close()
      const json=join(directory,'full.json');writeFileSync(json,JSON.stringify(r.exportLedger()))
      const copy=await stageRestore(r,json,directory),second=new PaperRepository(copy)
      expect(second.getCheckpoint('a')).toEqual(r.getCheckpoint('a'));second.close()
      expect(readdirSync(directory).filter(n=>n.startsWith('paper-before-restore-'))).toHaveLength(2)
      const legacy=new Database(backup)
      legacy.exec('DROP INDEX paper_fills_time; DROP INDEX paper_events_time; DROP INDEX paper_bars_symbol_time;');legacy.close()
      const oldCopy=await stageRestore(r,backup,directory),oldOpened=new PaperRepository(oldCopy)
      expect(oldOpened.getRun('a').account).toEqual(r.getRun('a').account);oldOpened.close()
      const pointer=readFileSync(join(directory,'paper-database.json'),'utf8')
      const corrupt=new Database(backup);corrupt.prepare('UPDATE runs SET cash=cash+1').run();corrupt.close()
      await expect(stageRestore(r,backup,directory)).rejects.toThrow('INVALID_BACKUP_BALANCE')
      expect(readFileSync(join(directory,'paper-database.json'),'utf8')).toBe(pointer)
      expect(r.getRun('a').account.cash).toBe(799*U)
    } finally {r.close();rmSync(directory,{recursive:true,force:true})}
  })
})
