import { logger } from '../logger'
import { app, dialog } from 'electron'
import { writeFile } from 'node:fs/promises'
import { z } from 'zod'
import type { PaperRuntime } from './runtime'
import { PaperManagement } from './management'
import { validateInstrument } from './instruments'
import { history } from './queries'
import { compare } from './performance'
import { stageRestore } from './backup'
import type { Fill } from '../../shared/paper/types'
import type { Valuation } from '../../shared/paper/management'
export function registerPaperIpc(handle: (channel:string, handler:(payload:unknown)=>unknown)=>void, runtime:PaperRuntime|null, getKey:()=>string|null): void {
  const service=()=>{ if (!runtime) throw new Error('PAPER_STORAGE_UNAVAILABLE'); return runtime.service }
  const manager=()=>new PaperManagement(service(),symbol=>validateInstrument(symbol,getKey()))
  let restoring=false
  let lane:Promise<unknown>=Promise.resolve()
  const serialize=(work:()=>Promise<unknown>):Promise<unknown>=>{const task=lane.then(work);lane=task.catch(()=>{});return task}
  handle('paper:state',()=>manager().state())
  handle('paper:action',payload=>serialize(async()=>{if(restoring) throw new Error('RESTORE_PENDING_RESTART'); return manager().action(payload)}))
  handle('paper:history',payload=>history(service().repository,payload))
  handle('paper:compare',payload=>{
    const ids=z.array(z.string().min(1).max(100)).min(2).max(10).parse(payload)
    return compare(ids.map(id=>({id,incomplete:!history(service().repository,{id}).reviewed || history(service().repository,{id}).performance.incomplete,snapshots:service().repository.historyRows<Valuation>('equity_snapshots',id,0,Number.MAX_SAFE_INTEGER,0,-1).rows})))
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
}
