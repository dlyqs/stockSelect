import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { PaperRepository } from './storage/repository'
import { execute } from './execution'
import { equity } from './accounting'
import { applyCorporateAction } from './corporateActions'
import { runConfigSchema } from '../../shared/paper/schemas'
import type { Account, Intent, RunConfig, TradeReference } from '../../shared/paper/types'
const U = 1_000_000
const config: RunConfig = { symbols: ['AAPL','SPY'], initialCash: 10000*U, fee: U, slippageBps: 5, maxPositionBps: 10000, parameters: {}, strategyVersion: 'v1' }
const intent: Intent = { id: 'buy', symbol: 'AAPL', side: 'buy', quantity: 10, reason: 'test' }
const ref: TradeReference = { source:'alpaca',feed:'iex',symbol:'AAPL',price:100*U,marketTime:1001,receivedAt:1002 }
const empty = (): Account => ({ cash:10000*U,realizedPnl:0,income:0,positions:[] })
const directories: string[] = [], stores: PaperRepository[] = []
function setup() {
  const dir = mkdtempSync(join(tmpdir(),'paper-test-')); directories.push(dir)
  const path = join(dir,'paper.sqlite'); const store = new PaperRepository(path); stores.push(store)
  store.registerVersion('v1','source','test'); store.createRun('a',config,0); store.setStatus('a','running',1,'test')
  return { store,path,dir }
}
afterEach(() => { for (const s of stores.splice(0)) { try { s.close() } catch { /* already closed */ } } for (const p of directories.splice(0)) rmSync(p,{recursive:true,force:true}) })
describe('paper accounting contract', () => {
  it('uses independently calculated cost, average basis and realized/unrealized reconciliation', () => {
    const buy = execute(empty(),config,intent,ref,1000,1002,100000)
    expect(buy.price).toBe(100050000); expect(buy.account.cash).toBe(8998500000)
    const sell = execute(buy.account,config,{...intent,id:'sell',side:'sell',quantity:4},{...ref,price:110*U},1000,1002,100000)
    expect(sell.account.cash).toBe(9437280000)
    expect(sell.account.realizedPnl).toBe(38180000)
    expect(sell.account.positions[0]).toEqual({symbol:'AAPL',quantity:6,cost:600900000})
    expect(equity(sell.account,{AAPL:110*U})-config.initialCash).toBe(sell.account.realizedPnl + 6*110*U-600900000)
  })
  it('rejects fractional shares, negative fees, duplicates, cash/position overflow and short sales', () => {
    expect(runConfigSchema.safeParse({...config, symbols:['AAPL','AAPL']}).success).toBe(false)
    for (const bad of [{...intent,quantity:1.5},{...intent,quantity:1000},{...intent,side:'sell' as const}]) expect(() => execute(empty(),config,bad,ref,1000,1002,100000)).toThrow()
    expect(() => execute(empty(),{...config,fee:-1},intent,ref,1000,1002,100000)).toThrow()
    expect(() => execute(empty(),{...config,maxPositionBps:1},intent,ref,1000,1002,100000)).toThrow('POSITION_LIMIT')
    expect(() => execute(empty(),config,intent,{...ref,price:Number.MAX_SAFE_INTEGER},1000,1002,100000)).toThrow('MONEY_OVERFLOW')
  })
  it('enforces next observed trade, receipt deadline and session close', () => {
    for (const r of [{...ref,marketTime:1000},{...ref,receivedAt:1003}]) expect(() => execute(empty(),config,intent,r,1000,1002,100000)).toThrow('INVALID_REFERENCE_TIME')
    expect(() => execute(empty(),config,intent,ref,1000,61001,100000)).toThrow('INTENT_EXPIRED')
    expect(() => execute(empty(),config,intent,ref,1000,1002,1002)).toThrow('INTENT_EXPIRED')
  })
  it('handles dividends, split and reverse split with explicit fractional cash', () => {
    const a: Account = {cash:0,realizedPnl:0,income:0,positions:[{symbol:'AAPL',quantity:5,cost:500*U}]}
    const div = applyCorporateAction(a,{id:'d',symbol:'AAPL',type:'dividend',perShare:2*U,occurredAt:1})
    expect(div.account.cash).toBe(10*U); expect(div.account.income).toBe(10*U)
    const split = applyCorporateAction(a,{id:'s',symbol:'AAPL',type:'split',numerator:2,denominator:1,occurredAt:1})
    expect(split.account.positions[0]).toEqual({symbol:'AAPL',quantity:10,cost:500*U})
    const action = {id:'r',symbol:'AAPL',type:'split' as const,numerator:1,denominator:2,occurredAt:1}
    expect(() => applyCorporateAction(a,action)).toThrow('CASH_IN_LIEU_REQUIRED')
    const reverse = applyCorporateAction(a,{...action,cashInLieuPrice:220*U})
    expect(reverse.account).toEqual({cash:110*U,realizedPnl:10*U,income:0,positions:[{symbol:'AAPL',quantity:2,cost:400*U}]})
  })
})
describe('durable single writer', () => {
  it('isolates runs and makes decisions, fills and actions idempotent across reopen', async () => {
    const {store,path,dir} = setup(); store.createRun('b',config,0)
    expect(() => new PaperRepository(path)).toThrow('WRITER_ALREADY_OPEN')
    expect(store.commitDecision('a','batch',1000,[intent],{n:1})).toBe(true)
    expect(store.commitDecision('a','batch',1000,[intent],{n:2})).toBe(false)
    const fill = store.settle('a','buy',ref,1002,100000)
    expect(store.settle('a','buy',ref,1002,100000)).toEqual(fill)
    expect(store.getRun('b').account).toEqual(empty())
    store.setStatus('a','paused',2000,'action')
    const action = {id:'div',type:'dividend' as const,symbol:'AAPL',perShare:U,occurredAt:2001}
    expect(store.corporateAction('a',action)).toBe(true); expect(store.corporateAction('a',action)).toBe(false)
    const expected = store.getRun('a'); await store.backup(join(dir,'backup.sqlite'))
    store.close(); const reopened = new PaperRepository(path); stores.push(reopened)
    expect(reopened.getRun('a')).toEqual(expected); expect(reopened.getCheckpoint('a').state).toEqual({n:1})
    const backup = new PaperRepository(join(dir,'backup.sqlite')); stores.push(backup); expect(backup.getRun('a')).toEqual(expected)
    const events = reopened.events(); expect(reopened.events(events[0].cursor)[0].cursor).toBe(events[1].cursor)
  })
  it('rolls back all fill writes when a late statement fails, then safely retries', () => {
    const {store,path} = setup(); store.commitDecision('a','batch',1000,[intent],{n:1})
    const fault = new Database(path)
    fault.exec("CREATE TRIGGER fail_fill BEFORE INSERT ON run_events WHEN json_extract(NEW.payload,'$.type')='filled' BEGIN SELECT RAISE(ABORT,'test failure'); END;")
    expect(() => store.settle('a','buy',ref,1002,100000)).toThrow('test failure')
    expect(store.getRun('a').account).toEqual(empty()); expect(store.pending('a')).toHaveLength(1)
    expect((fault.prepare('SELECT count(*) AS n FROM fills').get() as {n:number}).n).toBe(0)
    fault.exec('DROP TRIGGER fail_fill'); fault.close()
    expect(store.settle('a','buy',ref,1002,100000)).not.toBeNull()
  })
  it('rolls back colliding intent IDs and nextState, cancels pending on recovery', () => {
    const {store,path} = setup(); store.commitDecision('a','one',1000,[intent],{n:1})
    expect(() => store.commitDecision('a','two',1000,[intent],{n:2})).toThrow()
    expect(store.getCheckpoint('a').state).toEqual({n:1})
    store.close(); const reopened = new PaperRepository(path); stores.push(reopened); reopened.recover(70000)
    expect(reopened.pending('a')).toEqual([]); expect(reopened.getRun('a').status).toBe('paused')
    expect(reopened.getRun('a').account).toEqual(empty())
  })
  it('waits on old quotes, rejects unaffordable orders and cancels expired orders', () => {
    const {store} = setup(); store.commitDecision('a','one',1000,[intent],null)
    expect(store.settle('a','buy',{...ref,marketTime:999},1002,100000)).toBeNull(); expect(store.pending('a')).toHaveLength(1)
    expect(store.settle('a','buy',ref,61001,100000)).toBeNull(); expect(store.pending('a')).toHaveLength(0)
    store.commitDecision('a','two',2000,[{...intent,id:'expensive',quantity:1000}],null)
    store.settle('a','expensive',{...ref,marketTime:2001,receivedAt:2002},2002,100000)
    expect(store.getRun('a').account).toEqual(empty()); expect(store.events().some(e => e.event.reason === 'INSUFFICIENT_CASH')).toBe(true)
  })
  it('halts all accounts on a storage write failure without erasing history', () => {
    const {store} = setup(); let failed = false
    // SQLite query_only reproduces a real SQLITE_READONLY write failure.
    const db = (store as unknown as {db: Database.Database}).db
    db.pragma('query_only = ON')
    try { store.commitDecision('a','failure',1000,[intent],null) } catch { failed = true }
    expect(failed).toBe(true); expect(store.halted).toBe(true)
    expect(store.getRun('a').status).toBe('error'); expect(store.getRun('a').account).toEqual(empty())
    expect(() => store.setStatus('a','running',1001,'retry')).toThrow('STORE_HALTED')
    expect(store.events().length).toBeGreaterThan(0)
  })
  it('preserves corrupt files and notifies the owner', () => {
    const dir = mkdtempSync(join(tmpdir(),'paper-corrupt-')); directories.push(dir); const path = join(dir,'bad.sqlite')
    writeFileSync(path,'not a database'); let reported = false
    expect(() => new PaperRepository(path,() => { reported = true })).toThrow(); expect(reported).toBe(true)
  })
})
