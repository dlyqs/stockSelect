import { randomUUID } from 'node:crypto'
import { ReadinessChecker } from './readiness'
import { sessionAt } from './calendar'
import { pageSchema } from '../../shared/paper/workbench'
import type { WorkbenchState } from '../../shared/paper/workbench'
import { logger } from '../logger'
import { app, dialog } from 'electron'
import { writeFile } from 'node:fs/promises'
import { z } from 'zod'
import type { PaperRuntime } from './runtime'
import { PaperManagement } from './management'
import { validateInstrument } from './instruments'
import { searchInstruments } from './instrumentSearch'
import { AlpacaProvider } from '../providers/alpaca'
import { symbolSchema } from '../../shared/paper/schemas'
import { history } from './queries'
import { compare } from './performance'
import { stageRestore } from './backup'
import type { Fill } from '../../shared/paper/types'
import { actionSchema, type Valuation } from '../../shared/paper/management'
export function registerPaperIpc(handle: (channel:string, handler:(payload:unknown)=>unknown)=>void, runtime:PaperRuntime|null, getKey:()=>string|null): { invalidateReadiness: () => void } {
  const readiness = new ReadinessChecker(getKey)
  const quotes = new AlpacaProvider(getKey)
  handle('paper:instruments:search', payload => searchInstruments(z.object({ query: z.string().trim().min(1).max(80) }).parse(payload).query))
  handle('paper:quote', payload => quotes.getQuote(z.object({ symbol: symbolSchema }).parse(payload).symbol))
  const service=()=>{ if (!runtime) throw new Error('PAPER_STORAGE_UNAVAILABLE'); return runtime.service }
  const manager=()=>new PaperManagement(service(),symbol=>validateInstrument(symbol,getKey()))
  let restoring=false
  let lane:Promise<unknown>=Promise.resolve()
  const serialize=(work:()=>Promise<unknown>):Promise<unknown>=>{const task=lane.then(work);lane=task.catch(()=>{});return task}
  handle('paper:workbench',(): WorkbenchState => {
    const observedAt = Date.now()
    let session: WorkbenchState['session'] = 'unknown'
    try { const hours = sessionAt(observedAt); session = hours && observedAt >= hours.open && observedAt < hours.close ? 'open' : 'closed' } catch { /* unknown calendar is explicit */ }
    const base = { observedAt, session, configured: !!getKey(), readiness: readiness.state(), restorePending: restoring }
    if (!runtime) return { ...base, service:'unavailable', runs:[], instruments:[], templates:[], valuations:{}, halted:true, summaries:{}, market:null }
    const facts = runtime.service.repository.workbenchFacts()
    for (const [id,summary] of Object.entries(facts.summaries)) summary.liquidating = runtime.service.isLiquidating(id)
    return { ...manager().state(), ...base, ...facts, service: runtime.status }
  })
  handle('paper:readiness', async () => {
    const start = Date.now()
    logger.write('info',['[paper-ui]',{event:'readiness_check_started',provider:'alpaca',feed:'iex',checkedAt:start}])
    const result = await readiness.check()
    logger.write('info',['[paper-ui]',{event:'readiness_check_completed',reasonCode:`${result.iex}/${result.assets}`,durationMs:Date.now()-start,checkedAt:result.checkedAt}])
    return result
  })
  handle('paper:page', payload => {
    const q = pageSchema.parse(payload)
    service().repository.getRun(q.id)
    const table = {fills:'fills',snapshots:'equity_snapshots',events:'run_events'} as const
    return service().repository.historyRows(table[q.kind],q.id,q.from,q.to,q.offset,q.limit)
  })
  handle('paper:state',()=>manager().state())
  handle('paper:action',payload=>serialize(async()=>{
    const requestId = randomUUID(), parsed=actionSchema.safeParse(payload)
    const context=parsed.success ? {action:parsed.data.type,...(parsed.data.type==='control'?{runId:parsed.data.id}:{}),...(parsed.data.type==='corporate'?{actionId:parsed.data.action.id}:{})} : {}
    logger.write('info',['[paper-run]',{event:'action_started',requestId,...context}])
    try {
      if(restoring) throw new Error('RESTORE_PENDING_RESTART')
      const result = await manager().action(payload)
      logger.write('info',['[paper-run]',{event:'action_completed',requestId,...context,...(result ? {runId:result.id} : {})}])
      return result
    } catch(error) {
      const message = error instanceof Error ? error.message : ''
      logger.write('warn',['[paper-run]',{event:'action_rejected',requestId,...context,reasonCode:/^[A-Z_]+$/.test(message)?message:'INVALID_ACTION'}])
      throw error
    }
  }))
  handle('paper:history',payload=>history(service().repository,payload))
  handle('paper:compare',payload=>{
    const ids=z.array(z.string().min(1).max(100)).min(2).max(10).refine(ids=>new Set(ids).size===ids.length).parse(payload)
    return compare(ids.map(id=>{const report=history(service().repository,{id,limit:1});return {id,incomplete:!report.reviewed || report.performance.incomplete,snapshots:service().repository.historyRows<Valuation>('equity_snapshots',id,0,Number.MAX_SAFE_INTEGER,0,-1).rows}}))
  })
  handle('paper:export',async payload=>{
    const {format}=z.object({format:z.enum(['json','csv','sqlite'])}).strict().parse(payload)
    const result=await dialog.showSaveDialog({defaultPath:`paper-${Date.now()}.${format}`,filters:[{name:format,extensions:[format]}]})
    if(result.canceled || !result.filePath) return {cancelled:true}
    const repo=service().repository
    if(format==='sqlite') await repo.backup(result.filePath)
    else if(format==='json') await writeFile(result.filePath,JSON.stringify(repo.exportLedger(),null,2),{flag:'wx'})
    else {
      // CSV is a view; JSON/SQLite retain every row. No untrusted free-text cells.
      const full=repo.listRuns().flatMap(r=>repo.historyRows<Fill>('fills',r.id,0,Number.MAX_SAFE_INTEGER,0,-1).rows)
      const csv=['run_id,symbol,side,quantity,price_usd,fee_usd,market_time',...full.map(f=>['"'+(/^[=+@\-\t\r]/.test(f.runId)?"'":'')+f.runId.replaceAll('"','""')+'"',f.symbol,f.side,f.quantity,f.price/1e6,f.fee/1e6,new Date(f.marketTime).toISOString()].join(','))].join('\n')
      await writeFile(result.filePath,csv,{flag:'wx'})
    }
    logger.write('info',['[paper-store]',{event:'export_completed',format}])
    return {saved:true}
  })
  handle('paper:restore',()=>serialize(async()=>{
    service()
    if(restoring) throw new Error('RESTORE_PENDING_RESTART')
    restoring=true
    let suspended=false
    try {
      const result=await dialog.showOpenDialog({properties:['openFile'],filters:[{name:'Paper backup',extensions:['sqlite','json']}]})
      if(result.canceled || !result.filePaths[0]) {restoring=false;return {cancelled:true}}
      runtime!.suspend(); suspended=true
      await service().market.drain()
      await stageRestore(service().repository,result.filePaths[0],app.getPath('userData'))
      service().halt()
      logger.write('info',['[paper-store]',{event:'restore_staged',restartRequired:true}])
      return {restartRequired:true}
    } catch(error) {logger.write('error',['[paper-store]',{event:'restore_failed'}]);restoring=false; if(suspended)runtime!.resume(); throw error}
  }))
  return { invalidateReadiness: () => readiness.invalidate() }
}
