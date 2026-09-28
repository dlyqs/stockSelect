import { randomUUID } from 'node:crypto'
import { actionSchema } from '../../shared/paper/management'
import type { PaperState } from '../../shared/paper/management'
import { strategyVersions, parametersFor } from '../../strategies/registry'
import type { PaperTradingService } from './service'
import { sessionAt } from './calendar'
export class PaperManagement {
  constructor(private service: PaperTradingService, private validate: (symbol:string)=>Promise<void>) {}
  state(): PaperState {
    const r=this.service.repository
    return {runs:r.listRuns(),instruments:r.instruments(),templates:strategyVersions.map(v=>({id:v.id,kind:v.kind,parameters:parametersFor(v.kind,{})})),valuations:Object.fromEntries(r.listRuns().map(run=>[run.id,['ended','archived'].includes(run.status)?r.historyRows<import('../../shared/paper/management').Valuation>('equity_snapshots',run.id,0,Number.MAX_SAFE_INTEGER,0,-1).rows.at(-1) ?? r.valuation(run.id,Date.now()):r.valuation(run.id,Date.now())])),halted:this.service.halted}
  }
  async action(raw: unknown): Promise<void> {
    const input=actionSchema.parse(raw), r=this.service.repository
    if(this.service.halted) throw new Error('PAPER_SERVICE_HALTED')
    if (input.type==='add') { await this.validate(input.symbol); if(this.service.halted) throw new Error('PAPER_SERVICE_HALTED'); r.addInstrument(input.symbol,input.kind); return }
    if (input.type==='remove') { r.removeInstrument(input.symbol); return }
    if (input.type==='create') {
      if (input.config.symbols.some(s=>!r.instruments().some(i=>i.symbol===s))) throw new Error('VALIDATE_INSTRUMENT_FIRST')
      this.service.create(randomUUID(),input.config); return
    }
    if (input.type==='corporate') {
      const affected=r.listRuns().filter(run=>run.config.symbols.includes(input.action.symbol) && !['ended','archived'].includes(run.status))
      if(input.action.occurredAt>Date.now()) throw new Error('FUTURE_CORPORATE_ACTION')
      for (const run of affected) this.service.pause(run.id,'CORPORATE_ACTION_REVIEW')
      r.corporateActions(affected.map(run=>run.id),input.action)
      return
    }
    const run=r.getRun(input.id)
    switch (input.action) {
      case 'start': await this.service.start(input.id); break
      case 'pause': this.service.pause(input.id); break
      case 'end': this.service.end(input.id); break
      case 'archive': if (run.status!=='ended') throw new Error('END_BEFORE_ARCHIVE'); r.setStatus(input.id,'archived',Date.now(),'USER_ARCHIVE'); break
      case 'review': r.recordEvent(input.id,'corporate_review',Date.now(),'USER_CONFIRMED_CORPORATE_ACTIONS'); break
      case 'liquidate': {
        const now=Date.now(), session=sessionAt(now)
        if (!session || now<session.open || now>=session.close) throw new Error('MARKET_CLOSED')
        this.service.liquidate(input.id)
      }
    }
  }
}
