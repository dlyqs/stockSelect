import { describe,it,expect } from 'vitest'
import { allowedControls,dateRange,needsAttention,selectStrategyRuns,runName } from './presentation'
import type { WorkbenchState } from '../../../shared/paper/workbench'
import type { PaperRun } from '../../../shared/paper/types'
const run={id:'a',status:'paused',account:{cash:0,realizedPnl:0,income:0,positions:[{symbol:'SPY',quantity:2,cost:10}]},config:{symbols:['SPY'],strategyVersion:'sma:x',parameters:{},initialCash:100,fee:0,slippageBps:0,maxPositionBps:10000}} satisfies PaperRun
const state:WorkbenchState={observedAt:100,configured:true,readiness:{checkedAt:null,iex:'UNVERIFIED',assets:'UNVERIFIED'},market:null,runs:[run],templates:[],instruments:[],service:'ready',session:'open',halted:false,restorePending:false,summaries:{a:{liquidating:false,createdAt:0,latestSampleAt:100,latestEvent:null,reviewed:true}},valuations:{a:{at:100,equity:100,realized:0,income:0,unrealized:0,prices:{},quality:'fresh'}}}
describe('workbench lifecycle and NY filters',()=>{
  it('keeps terminal, liquidation and restore semantics distinct',()=>{
    expect(allowedControls(run,state)).toContain('liquidate')
    expect(allowedControls({...run,status:'ended'},state)).toEqual(['review','archive','liquidate'])
    expect(allowedControls({...run,status:'archived'},state)).toEqual(['review'])
    expect(allowedControls({...run,status:'error'},state)).not.toContain('liquidate')
    expect(allowedControls(run,{...state,session:'closed'})).not.toContain('liquidate')
    expect(allowedControls(run,{...state,restorePending:true})).toEqual([])
    expect(allowedControls(run,{...state,service:'halted'})).toEqual([])
    const liquidating={...state,summaries:{a:{...state.summaries.a,liquidating:true}}}
    expect(allowedControls(run,liquidating)).not.toContain('start')
    expect(allowedControls({...run,status:'ended'},liquidating)).not.toContain('archive')
  })
  it('does not turn missing or unreviewed data into healthy state',()=>{
    expect(needsAttention({...run,status:'running'},state)).toBe(false)
    expect(needsAttention({...run,status:'running'},{...state,summaries:{}})).toBe(true)
    expect(needsAttention({...run,status:'running'},{...state,valuations:{}})).toBe(true)
  })
  it('keeps overview shortcuts consistent with management filters and searches',()=>{
    const runs:PaperRun[]=[
      {...run,id:'running-spy',status:'running'},
      {...run,id:'warming-spy',status:'warming'},
      {...run,id:'paused-aapl',status:'paused',config:{...run.config,symbols:['AAPL']}},
      {...run,id:'created-spy',status:'created'},
      {...run,id:'ended-spy',status:'ended'},
      {...run,id:'archived-spy',status:'archived'},
    ]
    const data={...state,runs}
    const ids=(filter:Parameters<typeof selectStrategyRuns>[1],search='')=>selectStrategyRuns(data,filter,search).map(r=>r.id)
    expect(ids('all')).toHaveLength(6)
    expect(ids('active')).toEqual(['running-spy','warming-spy'])
    expect(ids('created')).toEqual(['created-spy'])
    expect(ids('history')).toEqual(['ended-spy','archived-spy'])
    expect(ids('attention')).not.toContain('archived-spy')
    expect(ids('all',' aapl ')).toEqual(['paused-aapl'])
    expect(ids('paused','spy')).toEqual([])
    expect(ids('all','RUNNING-SPY')).toEqual(['running-spy'])
    expect(ids('all','历史模板')).toEqual([])
    expect(selectStrategyRuns(data,'all',runName(run).split(' · ')[0])).toHaveLength(6)
  })
  it('uses inclusive NY calendar dates across both DST transitions',()=>{
    const spring=dateRange('2026-03-08','2026-03-08'),fall=dateRange('2026-11-01','2026-11-01')
    expect(spring).toEqual({from:Date.parse('2026-03-08T05:00:00Z'),to:Date.parse('2026-03-09T04:00:00Z')-1})
    expect(fall.to-fall.from+1).toBe(25*3600000)
    expect(dateRange('','')).toEqual({from:0,to:Number.MAX_SAFE_INTEGER})
    expect(()=>dateRange('2026-03-09','2026-03-08')).toThrow()
    expect(()=>dateRange('2026-02-30','')).toThrow()
    expect(()=>dateRange('','invalid')).toThrow()
  })
})
