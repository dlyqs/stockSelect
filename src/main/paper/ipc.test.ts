import { beforeEach,describe,expect,it,vi } from 'vitest'
const mocks=vi.hoisted(()=>({open:vi.fn(),save:vi.fn(),restore:vi.fn()}))
vi.mock('electron',()=>({app:{getPath:()=>'/unused'},dialog:{showOpenDialog:mocks.open,showSaveDialog:mocks.save}}))
vi.mock('../logger',()=>({logger:{write:vi.fn()}}))
vi.mock('./backup',()=>({stageRestore:mocks.restore}))
import { registerPaperIpc } from './ipc'
import type { PaperRuntime } from './runtime'
import { PaperRepository } from './storage/repository'
import { MarketDataService } from './marketData'
import { PaperTradingService } from './service'
import { strategyVersions } from '../../strategies/registry'
beforeEach(()=>vi.clearAllMocks())
describe('workbench IPC without windows',()=>{
  it('reports unavailable storage as an explicit fault, not a healthy empty account',async()=>{
    const handlers=new Map<string,(payload:unknown)=>unknown>()
    registerPaperIpc((name,fn)=>handlers.set(name,fn),null,()=>null)
    expect(handlers.get('paper:workbench')!(undefined)).toMatchObject({service:'unavailable',halted:true,configured:false})
    await expect(handlers.get('paper:action')!({type:'remove',symbol:'SPY'})).rejects.toThrow('PAPER_STORAGE_UNAVAILABLE')
  })
  it('keeps independent pages bounded and blocks writes after a successful staged restore',async()=>{
    const repo=new PaperRepository(':memory:'),service=new PaperTradingService(repo,new MarketDataService({bars:async()=>[],trades:async()=>[]},repo))
    const suspend=vi.fn(),resume=vi.fn(),runtime={service,status:'ready',suspend,resume} as unknown as PaperRuntime
    const handlers=new Map<string,(payload:unknown)=>unknown>()
    const call=(name:string,payload?:unknown):unknown=>handlers.get(name)!(payload)
    try {
      await service.initialize();repo.addInstrument('SPY','etf')
      service.create('a',{symbols:['SPY'],initialCash:1000000,fee:0,slippageBps:0,maxPositionBps:10000,parameters:{},strategyVersion:strategyVersions[0].id})
      registerPaperIpc((name,fn)=>handlers.set(name,fn),runtime,()=>null)
      expect(call('paper:page',{id:'a',kind:'events',offset:100,limit:1})).toMatchObject({rows:[]})
      expect(call('paper:page',{id:'a',kind:'events',offset:0,limit:1})).toMatchObject({rows:[expect.any(Object)]})
      expect(()=>call('paper:page',{id:'a',kind:'events',limit:501})).toThrow()
      expect(()=>call('paper:compare',['a','a'])).toThrow()
      mocks.open.mockResolvedValueOnce({canceled:true,filePaths:[]})
      expect(await call('paper:restore')).toEqual({cancelled:true})
      expect(suspend).not.toHaveBeenCalled();expect(mocks.restore).not.toHaveBeenCalled()
      mocks.open.mockResolvedValueOnce({canceled:false,filePaths:['/backup.sqlite']});mocks.restore.mockRejectedValueOnce(new Error('INVALID_BACKUP'))
      await expect(call('paper:restore')).rejects.toThrow('INVALID_BACKUP')
      expect(resume).toHaveBeenCalledOnce();expect(call('paper:workbench')).toMatchObject({restorePending:false})
      mocks.open.mockResolvedValueOnce({canceled:false,filePaths:['/backup.sqlite']});mocks.restore.mockResolvedValueOnce('/new.sqlite')
      expect(await call('paper:restore')).toEqual({restartRequired:true})
      expect(call('paper:workbench')).toMatchObject({restorePending:true,halted:true})
      await expect(call('paper:action',{type:'control',id:'a',action:'start'})).rejects.toThrow('RESTORE_PENDING_RESTART')
      await expect(call('paper:restore')).rejects.toThrow('RESTORE_PENDING_RESTART')
    } finally {service.shutdown();repo.close()}
  })
  it('serializes concurrent actions before restore and preserves a cancelled export',async()=>{
    const repo=new PaperRepository(':memory:'),service=new PaperTradingService(repo,new MarketDataService({bars:async()=>[],trades:async()=>[]},repo))
    const runtime={service,status:'ready',suspend:vi.fn(),resume:vi.fn()} as unknown as PaperRuntime
    const handlers=new Map<string,(payload:unknown)=>unknown>()
    try {
      await service.initialize();repo.addInstrument('SPY','etf');registerPaperIpc((name,fn)=>handlers.set(name,fn),runtime,()=>null)
      const payload={type:'create',requestId:'abcdefff-1234-4234-8234-123456789abc',config:{symbols:['SPY'],initialCash:1000000,fee:0,slippageBps:0,maxPositionBps:10000,parameters:{},strategyVersion:strategyVersions[0].id}}
      const results=await Promise.all([handlers.get('paper:action')!(payload),handlers.get('paper:action')!(payload)])
      expect(results[0]).toEqual(results[1]);expect(repo.listRuns()).toHaveLength(1)
      mocks.save.mockResolvedValueOnce({canceled:true})
      expect(await handlers.get('paper:export')!({format:'json'})).toEqual({cancelled:true})
    } finally {service.shutdown();repo.close()}
  })
})
