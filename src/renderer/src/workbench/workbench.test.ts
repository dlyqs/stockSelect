import { describe, expect, it } from 'vitest'
import { decimalUnits, unitsDecimal, readDraft, emptyDraft, useNavigation } from './state'
import { configFromDraft } from './pages/CreatePage'
import { parameterSchemas, templateInfo, templateFields } from '../../../shared/paper/templates'
import { pageSchema } from '../../../shared/paper/workbench'
const state={templates:[{id:'sma:version',kind:'sma',parameters:{fast:10,slow:30,quantity:1}}],instruments:[{symbol:'SPY',kind:'etf'}]}
const draft={...emptyDraft,template:'sma:version',symbols:['SPY'],parameters:{fast:'10',slow:'30',quantity:'1'}}
describe('workbench contracts',()=>{
  it('converts USD and percentage exactly at precision and overflow boundaries',()=>{
    expect(decimalUnits('0.000001',6)).toBe(1)
    expect(decimalUnits('0.29',6)).toBe(290000)
    expect(decimalUnits('99.99',2)).toBe(9999)
    expect(decimalUnits('9007199254.740991',6)).toBe(Number.MAX_SAFE_INTEGER)
    expect(unitsDecimal(Number.MAX_SAFE_INTEGER,6)).toBe('9007199254.740991')
    for(const invalid of ['1e3','-1','NaN','0.0000001','9007199254.740992']) expect(()=>decimalUnits(invalid,6)).toThrow()
  })
  it('recovers only draft preferences and always starts with overview navigation',()=>{
    expect(readDraft('{')).toEqual(emptyDraft)
    expect(readDraft(JSON.stringify({...draft,version:2}))).toEqual(emptyDraft)
    expect(readDraft(JSON.stringify({...draft,step:2}))).toEqual({...draft,step:2})
    expect(useNavigation.getState().page).toBe('overview')
    useNavigation.getState().navigate('create')
    useNavigation.getState().setTerminal(true)
    useNavigation.getState().setTerminal(false)
    expect(useNavigation.getState().page).toBe('create')
  })
  it('opens targeted strategy views and preserves them when returning from details',()=>{
    const navigation=useNavigation.getState()
    navigation.setStrategySearch('SPY')
    navigation.openStrategies('attention')
    expect(useNavigation.getState()).toMatchObject({page:'strategies',strategyFilter:'attention',strategySearch:'',runId:null})
    navigation.setStrategySearch('SMA')
    navigation.navigate('detail','run-a')
    navigation.navigate('strategies')
    expect(useNavigation.getState()).toMatchObject({page:'strategies',strategyFilter:'attention',strategySearch:'SMA',runId:null})
    navigation.openStrategies()
    expect(useNavigation.getState()).toMatchObject({page:'strategies',strategyFilter:'all',strategySearch:''})
  })
  it('shares field defaults and validation with the execution contracts',()=>{
    for(const kind of ['sma','rsi','breakout'] as const) {
      expect(parameterSchemas[kind].parse({})).toEqual(Object.fromEntries(templateInfo[kind].fields.map(k=>[k,templateFields[k].default])))
    }
    expect(configFromDraft(draft,state)).toMatchObject({initialCash:10000000000,maxPositionBps:10000,parameters:{fast:10,slow:30,quantity:1}})
    expect(()=>configFromDraft({...draft,position:'100.01'},state)).toThrow('position:')
    expect(()=>configFromDraft({...draft,cash:'0'},state)).toThrow('cash:')
    expect(()=>configFromDraft({...draft,symbols:['UNKNOWN']},state)).toThrow('symbols:')
    expect(()=>configFromDraft({...draft,symbols:Array(11).fill('SPY')},state)).toThrow()
    expect(()=>configFromDraft({...draft,parameters:{fast:'30',slow:'10',quantity:'1'}},state)).toThrow('fast:')
    expect(()=>configFromDraft({...draft,parameters:{fast:'',slow:'10',quantity:'1'}},state)).toThrow('fast:')
  })
  it('bounds independent history requests and rejects reversed dates',()=>{
    expect(pageSchema.parse({id:'x',kind:'events',offset:100}).offset).toBe(100)
    expect(pageSchema.parse({id:'x',kind:'fills'}).offset).toBe(0)
    for(const input of [{id:'x',kind:'snapshots',limit:501},{id:'x',kind:'events',from:2,to:1},{id:'x',kind:'secrets'}]) expect(pageSchema.safeParse(input).success).toBe(false)
  })
})
