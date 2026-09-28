import type { CorporateAction, Fill, StrategyEvent } from '../../shared/paper/types'
import type { PaperHistory, Valuation } from '../../shared/paper/management'
import { historySchema } from '../../shared/paper/management'
import { sessionAt } from './calendar'
import { performance } from './performance'
import type { PaperRepository } from './storage/repository'
export function history(repo: PaperRepository, raw: unknown): PaperHistory {
  const q=historySchema.parse(raw), run=repo.getRun(q.id)
  const fills=repo.historyRows<Fill>('fills',q.id,q.from,q.to,q.offset,q.limit)
  const snapshots=repo.historyRows<Valuation>('equity_snapshots',q.id,q.from,q.to,q.offset,q.limit)
  const events=repo.historyRows<StrategyEvent>('run_events',q.id,q.from,q.to,q.offset,q.limit)
  const all=repo.historyRows<Valuation>('equity_snapshots',q.id,0,q.to,0,-1).rows
  const allFills=repo.historyRows<Fill>('fills',q.id,0,q.to,0,-1).rows
  const allEvents=repo.historyRows<StrategyEvent>('run_events',q.id,0,q.to,0,-1).rows
  const qualityCount=repo.qualityRecords().filter(r=>run.config.symbols.includes(r.symbol) && r.marketTime>=q.from && r.marketTime<=q.to && !['FRESH','WARMUP_ONLY'].includes(r.reason)).length
  const reviewIndex=allEvents.map(e=>e.type).lastIndexOf('corporate_review')
  const reviewed=reviewIndex>=0 && !allEvents.slice(reviewIndex+1).some(e=>e.type==='corporate_action' || e.reason==='CORPORATE_ACTION_REVIEW')
  const actions=repo.historyRows<CorporateAction>('corporate_actions',q.id,0,q.to,0,-1).rows.map(a=>({...a,occurredAt:allEvents.find(e=>e.type==='corporate_action' && e.summary.actionId===a.id)?.occurredAt ?? a.occurredAt}))
  const start=allEvents.find(e=>e.type==='created')?.occurredAt ?? all[0]?.at ?? Date.now()
  const finish=Math.min(q.to,Date.now(),all.at(-1)?.at ?? Date.now())
  let expected=0
  try {
    if(finish-start>370*86400000) throw new Error('CALENDAR_UNCOVERED')
    for(let day=Math.floor(start/86400000)*86400000;day<=finish;day+=86400000) {
      const session=sessionAt(day+12*3600000)
      if(session) expected+=Math.max(0,Math.floor((Math.min(finish,session.close)-Math.max(Math.ceil(start/60000)*60000,session.open))/60000))*run.config.symbols.length
    }
  } catch {expected=-1}
  const fresh=new Set(repo.qualityRecords().filter(r=>r.reason==='FRESH' && r.mode==='live' && run.config.symbols.includes(r.symbol) && r.marketTime>=start && r.marketTime+60000<=finish).map(r=>`${r.symbol}:${r.marketTime}`)).size
  return {coverage:{expected,fresh,pct:expected>0?Math.min(100,fresh/expected*100):null},observedMs:Math.max(0,finish-start),fills:fills.rows,snapshots:snapshots.rows,events:events.rows,counts:{fills:fills.count,snapshots:snapshots.count,events:events.count},performance:performance(run.config.initialCash,all,allFills,(expected>0 && fresh<expected) || qualityCount>0 || allEvents.some(e=>['interruption','recovery','skipped'].includes(e.type)),actions),reviewed,qualityCount}
}
