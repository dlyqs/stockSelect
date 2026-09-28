import { describe,it,expect } from 'vitest'
import { mkdtempSync,rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PaperRepository } from './storage/repository'
import { PaperTradingService } from './service'
import { MarketDataService } from './marketData'
import { StrategyWorkers } from './strategyWorker'
import { strategyVersions } from '../../strategies/registry'
import { history } from './queries'
import type { PaperBar } from '../../shared/paper/types'
const U=1e6,base=Date.parse('2026-09-28T14:00Z'),symbols=['AAPL','MSFT','SPY','QQQ','IWM','DIA','NVDA','AMD','META','GOOG']
describe('paper end-to-end without a window',()=>{
  it('shares ten symbols across three real strategy workers through collection, fills, queries and crash recovery',async()=>{
    const directory=mkdtempSync(join(tmpdir(),'paper-e2e-')),file=join(directory,'ledger.sqlite')
    let now=base,requests=0,repo=new PaperRepository(file)
    const makeBar=(symbol:string,time:number,step:number):PaperBar=>{const close=(symbol==='AAPL'?100-step:100+step)*U;return {source:'alpaca',feed:'iex',symbol,interval:'1Min',marketTime:time,receivedAt:now,open:close,high:close,low:close,close,volume:100,quality:'fresh'}}
    const source={bars:async(requested:string[],start:number,end:number)=>{
      requests++
      expect(new Set(requested).size).toBe(requested.length)
      if(end-start>120000)return requested.flatMap(symbol=>Array.from({length:4},(_,i)=>makeBar(symbol,base-(4-i)*60000,i)))
      return requested.map(symbol=>makeBar(symbol,Math.floor(now/60000)*60000-60000,4))
    },trades:async(requested:string[])=>requested.map(symbol=>({source:'alpaca' as const,feed:'iex' as const,symbol,price:100*U,marketTime:now-1,receivedAt:now}))}
    let service=new PaperTradingService(repo,new MarketDataService(source,repo,()=>now),new StrategyWorkers(),()=>now)
    try {
      await service.initialize()
      for(const [i,version] of strategyVersions.entries()) {
        service.create(String(i),{symbols,initialCash:10000*U,fee:U,slippageBps:5,maxPositionBps:10000,strategyVersion:version.id,parameters:version.kind==='sma'?{fast:2,slow:3}:version.kind==='rsi'?{period:2,lower:30,upper:70}:{lookback:2}})
        await service.start(String(i))
      }
      expect(requests).toBe(1)
      now=base+65000;await service.tick()
      expect(repo.listRuns().every(r=>repo.pending(r.id).length>0)).toBe(true)
      now=base+70000;await service.tick()
      const before=repo.listRuns().map(r=>r.account)
      for(const run of repo.listRuns()) {
        expect(run.account.positions.length).toBeGreaterThan(0)
        expect(history(repo,{id:run.id}).counts.fills).toBe(run.account.positions.length)
        expect(history(repo,{id:run.id}).counts.snapshots).toBeGreaterThan(1)
      }
      const count=repo.events(0,1000).filter(e=>e.event.type==='filled').length
      await service.tick();expect(repo.events(0,1000).filter(e=>e.event.type==='filled')).toHaveLength(count)
      service.halt();repo.close()
      now=base+10*60000;repo=new PaperRepository(file);service=new PaperTradingService(repo,new MarketDataService(source,repo,()=>now),new StrategyWorkers(),()=>now)
      await service.initialize();await service.tick()
      expect(repo.listRuns().map(r=>r.account)).toEqual(before)
      expect(repo.events(0,1000).filter(e=>e.event.type==='filled')).toHaveLength(count)
      expect(repo.events(0,1000).filter(e=>e.event.type==='interruption')).toHaveLength(3)
    } finally {service.shutdown();repo.close();rmSync(directory,{recursive:true,force:true})}
  })
  it('liquidates only with a later reference and keeps the account paused afterwards; refuses premarket',async()=>{
    let now=base
    const repo=new PaperRepository(':memory:')
    const source={bars:async()=>Array.from({length:4},(_,i):PaperBar=>({source:'alpaca',feed:'iex',symbol:'AAPL',interval:'1Min',marketTime:base-(4-i)*60000,receivedAt:now,open:(100+i)*U,high:(100+i)*U,low:(100+i)*U,close:(100+i)*U,volume:100,quality:'fresh'})),trades:async()=>[{source:'alpaca' as const,feed:'iex' as const,symbol:'AAPL',price:100*U,marketTime:now-1,receivedAt:now}]}
    const service=new PaperTradingService(repo,new MarketDataService(source,repo,()=>now),new StrategyWorkers(),()=>now)
    try {
      await service.initialize();service.create('a',{symbols:['AAPL'],initialCash:1000*U,fee:0,slippageBps:0,maxPositionBps:10000,parameters:{fast:2,slow:3},strategyVersion:strategyVersions[0].id});await service.start('a')
      repo.commitDecision('a','seed',now,[{id:'buy',symbol:'AAPL',quantity:2,side:'buy',reason:'fixture'}],{})
      repo.settle('a','buy',{source:'alpaca',feed:'iex',symbol:'AAPL',price:100*U,marketTime:now+1,receivedAt:now+2},now+2,base+3600000)
      now+=5000;service.liquidate('a');await service.tick();expect(repo.getRun('a').account.positions).toHaveLength(1)
      now+=5000;await service.tick();expect(repo.getRun('a').account.positions).toEqual([])
      now+=5000;await service.tick();expect(repo.getRun('a').status).toBe('paused')
      await service.start('a')
      repo.commitDecision('a','seed2',now,[{id:'buy2',symbol:'AAPL',quantity:2,side:'buy',reason:'fixture'}],{})
      repo.settle('a','buy2',{source:'alpaca',feed:'iex',symbol:'AAPL',price:100*U,marketTime:now+1,receivedAt:now+2},now+2,base+3600000)
      service.pause('a');now+=5000;service.liquidate('a');service.suspend();now+=5000;await service.resume()
      expect(repo.getRun('a').status).toBe('paused');expect(repo.pending('a')).toEqual([])
      service.end('a');now+=5000;service.liquidate('a');await service.tick()
      expect(repo.getRun('a').status).toBe('ended');expect(repo.getRun('a').account.positions).toHaveLength(1)
      now+=5000;await service.tick();now+=5000;await service.tick()
      expect(repo.getRun('a').status).toBe('ended');expect(repo.getRun('a').account.positions).toEqual([])
      await expect(service.start('a')).rejects.toThrow('RUN_TERMINAL')
      now=Date.parse('2026-09-28T12:00Z');expect(()=>service.liquidate('a')).toThrow('LIQUIDATION_UNAVAILABLE')
    } finally {service.shutdown();repo.close()}
  })
})
