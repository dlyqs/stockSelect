import { describe, expect, it, vi } from 'vitest'
import { history } from './queries'
import { PaperRepository } from './storage/repository'
import { PaperManagement } from './management'
import { PaperTradingService } from './service'
import { MarketDataService } from './marketData'
import { strategyVersions } from '../../strategies/registry'
const base=Date.now()+60000
describe('workbench ledger queries and creation',()=>{
  it('creates once across retries without starting, and preserves the original config on conflicts',async()=>{
    const repo=new PaperRepository(':memory:')
    const market=new MarketDataService({bars:async()=>[],trades:async()=>[]},repo)
    const service=new PaperTradingService(repo,market), manager=new PaperManagement(service,async()=>{})
    try {
      await service.initialize(); await manager.action({type:'add',symbol:'SPY',kind:'etf'})
      const input={type:'create',requestId:'abcdefff-1234-4234-8234-123456789abc',config:{symbols:['SPY'],initialCash:100000000,fee:0,slippageBps:0,maxPositionBps:10000,parameters:{},strategyVersion:strategyVersions[0].id}}
      const first=await manager.action(input),retry=await manager.action(input)
      expect(retry).toEqual(first);expect(repo.listRuns()).toHaveLength(1)
      expect(repo.listRuns()[0].status).toBe('created'); expect(market.symbols).toEqual([])
      await expect(manager.action({...input,config:{...input.config,fee:1}})).rejects.toThrow('CREATE_REQUEST_CONFLICT')
      expect(repo.listRuns()[0].config.fee).toBe(0)
    } finally {service.shutdown();repo.close()}
  })
  it('reads long-history summaries without calling full history or inventing missing facts',async()=>{
    const repo=new PaperRepository(':memory:')
    const service=new PaperTradingService(repo,new MarketDataService({bars:async()=>[],trades:async()=>[]},repo)),manager=new PaperManagement(service,async()=>{})
    try {
      await service.initialize(); await manager.action({type:'add',symbol:'SPY',kind:'etf'})
      const result=await manager.action({type:'create',config:{symbols:['SPY'],initialCash:100000000,fee:0,slippageBps:0,maxPositionBps:10000,parameters:{},strategyVersion:strategyVersions[0].id}})
      const id=result!.id
      expect(repo.workbenchFacts().market).toBeNull()
      expect(repo.workbenchFacts().summaries[id].latestSampleAt).toEqual(expect.any(Number))
      for(let i=0;i<2000;i++)repo.snapshot(id,base+i*60000)
      repo.setStatus(id,'ended',base+2000*60000,'USER_END')
      expect(repo.workbenchFacts().summaries[id].reviewed).toBe(false)
      repo.recordEvent(id,'corporate_review',base,'USER_CONFIRMED_CORPORATE_ACTIONS')
      expect(repo.workbenchFacts().summaries[id].reviewed).toBe(true)
      repo.recordEvent(id,'paused',base,'CORPORATE_ACTION_REVIEW')
      expect(repo.workbenchFacts().summaries[id].reviewed).toBe(false)
      repo.setStatus(id,'ended',base+2000*60000,'USER_END')
      const scan=vi.spyOn(repo,'historyRows')
      expect(manager.state().valuations[id].at).toBe(base+1999*60000)
      expect(repo.workbenchFacts().summaries[id]).toMatchObject({latestSampleAt:base+1999*60000,latestEvent:{reason:'USER_END'}})
      expect(scan).not.toHaveBeenCalled()
      expect(repo.historyRows('equity_snapshots',id,0,Number.MAX_SAFE_INTEGER,500,20).rows).toHaveLength(20)
      const report=history(repo,{id,limit:1});scan.mockClear()
      expect(history(repo,{id,limit:1})).toBe(report)
      expect(scan).not.toHaveBeenCalled()
      repo.recordEvent(id,'corporate_review',base+2001*60000,'USER_CONFIRMED_CORPORATE_ACTIONS')
      expect(history(repo,{id,limit:1}).reviewed).toBe(true)
      expect(scan).toHaveBeenCalled()
      await expect(manager.action({type:'control',id,action:'pause'})).rejects.toThrow('RUN_TERMINAL')
      await manager.action({type:'control',id,action:'archive'})
      await expect(manager.action({type:'control',id,action:'end'})).rejects.toThrow('RUN_TERMINAL')
      expect(repo.getRun(id).status).toBe('archived')
    } finally {service.shutdown();repo.close()}
  })
})
