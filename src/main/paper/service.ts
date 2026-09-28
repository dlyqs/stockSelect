import type { RunConfig, StrategyContext } from '../../shared/paper/types'
import { runConfigSchema } from '../../shared/paper/schemas'
import { strategyVersions, templateFor, parametersFor, requiredBars } from '../../strategies/registry'
import { sessionAt } from './calendar'
import { MarketDataService } from './marketData'
import { PaperRepository } from './storage/repository'
import { StrategyWorkers, type StrategyExecutor } from './strategyWorker'
import { recoverableRuns } from './recovery'
export class PaperTradingService {
  private active = new Map<string, { generation: number; readyAfter: number }>()
  private generation = 0
  private stopped = false
  private suspended = false
  private sleeping: string[] = []
  private busy = false
  private lastHeartbeat = 0
  private lastTick: number | undefined
  constructor(readonly repository: PaperRepository, readonly market: MarketDataService, private workers: StrategyExecutor = new StrategyWorkers(), private now = Date.now, private log: (event: string, fields: Record<string,unknown>) => void = () => {}) {}
  async initialize(): Promise<void> {
    for (const version of strategyVersions) this.repository.registerVersion(version.id,version.source,version.build,version.stateSchema)
    const ids = recoverableRuns(this.repository)
    this.repository.recover(this.now())
    for (const id of ids) {
      if (this.stopped || this.suspended) break
      const since = this.repository.getCheckpoint(id).updatedAt
      this.repository.recordEvent(id,'recovery',this.now(),'WARMUP_WITHOUT_REPLAY',{since,until:this.now()})
      await this.start(id,'recovery')
    }
  }
  create(id: string, raw: RunConfig): void {
    const config = runConfigSchema.parse(raw)
    config.parameters = parametersFor(templateFor(config.strategyVersion),config.parameters)
    // Reserve the global pool for every non-archived instance, including paused holdings.
    const symbols = new Set(this.repository.listRuns().filter(r => r.status !== 'archived').flatMap(r => r.config.symbols))
    config.symbols.forEach(s => symbols.add(s))
    if (symbols.size > 10) throw new Error('SYMBOL_LIMIT')
    this.repository.createRun(id,config,this.now())
  }
  async start(id: string, mode: 'warmup' | 'recovery' = 'warmup'): Promise<void> {
    if (this.stopped || this.suspended || this.repository.halted) throw new Error('SERVICE_STOPPED')
    if (this.active.has(id)) return
    const run = this.repository.getRun(id)
    if (['ended','archived'].includes(run.status)) throw new Error('RUN_TERMINAL')
    const generation = ++this.generation
    try {
      const kind = templateFor(run.config.strategyVersion)
      parametersFor(kind,run.config.parameters)
      sessionAt(this.now())
      this.market.subscribe(id,run.config.symbols)
      this.active.set(id,{ generation, readyAfter: Math.ceil(this.now()/60_000)*60_000 })
      this.repository.setStatus(id,'warming',this.now(),'WARMUP_REQUIRED')
      await this.market.warmup(run.config.symbols,mode)
      if (this.active.get(id)?.generation !== generation || this.stopped) return
      const enough = run.config.symbols.every(s => this.market.bars(s).length >= requiredBars(kind,run.config.parameters))
      this.repository.setStatus(id,enough ? 'running' : 'data_insufficient',this.now(),enough ? 'WARMUP_COMPLETE' : 'WARMUP_INSUFFICIENT')
      this.log('started',{ runId: id, reasonCode: enough ? 'READY' : 'WARMUP_INSUFFICIENT' })
    } catch (error) {
      if (!this.repository.halted && !this.stopped) this.pause(id,this.reason(error))
      else this.halt()
    }
  }
  pause(id: string, reason = 'USER_PAUSE'): void {
    this.active.delete(id); this.market.unsubscribe(id); this.workers.stop(id)
    this.repository.setStatus(id,'paused',this.now(),reason)
    this.log('paused',{ runId: id, reasonCode: reason })
  }
  end(id: string): void {
    this.pause(id,'USER_END'); this.repository.setStatus(id,'ended',this.now(),'POSITIONS_RETAINED')
  }
  private reason(error: unknown): string {
    // Never forward arbitrary source/response/credential payloads to persisted diagnostics.
    const message = error instanceof Error ? error.message : ''
    return /^[A-Z][A-Z0-9_]{0,63}$/.test(message) ? message : 'RUNTIME_FAILED'
  }
  async tick(): Promise<void> {
    if (this.stopped || this.busy || !this.active.size) return
    this.busy = true
    try {
      const before = this.now()
      const delayed = this.lastTick !== undefined && before-this.lastTick > 90_000
      this.lastTick = before
      if (delayed) {
        this.suspend(); await this.resume(); return
      }
      const session = sessionAt(before)
      if (before-this.lastHeartbeat >= 60_000) {
        for (const id of this.active.keys()) this.repository.recordEvent(id,'heartbeat',before,'PROCESS_ALIVE')
        this.lastHeartbeat = before
      }
      for (const id of this.active.keys()) this.repository.expirePending(id,before,session?.close ?? before)
      const batch = await this.market.poll()
      if (this.stopped) return
      if (batch) await Promise.all([...this.active].map(async ([id,entry]) => {
        try {
          const run = this.repository.getRun(id)
          if (batch.time < entry.readyAfter || this.repository.hasDecision(id,String(batch.time))) return
          const kind = templateFor(run.config.strategyVersion)
          const bars = Object.fromEntries(run.config.symbols.map(s => [s,this.market.bars(s)]))
          if (run.config.symbols.some(s => !batch.bars[s] || bars[s].length < requiredBars(kind,run.config.parameters))) {
            if (run.status !== 'data_insufficient') this.repository.setStatus(id,'data_insufficient',this.now(),'BATCH_INCOMPLETE')
            this.repository.recordEvent(id,'skipped',this.now(),'BATCH_INCOMPLETE',{ barTime: batch.time })
            return
          }
          // A suspicious jump requires explicit corporate-action review, never a guessed split.
          if (Object.values(bars).some(list => list.length > 1 && Math.abs(list.at(-1)!.close / list.at(-2)!.close - 1) >= 0.4)) {
            this.pause(id,'CORPORATE_ACTION_REVIEW'); return
          }
          if (run.status !== 'running') this.repository.setStatus(id,'running',this.now(),'DATA_RECOVERED')
          const context: StrategyContext = { bars, account: structuredClone(run.account), parameters: parametersFor(kind,run.config.parameters), state: this.repository.getCheckpoint(id).state }
          const result = await this.workers.evaluate(id,kind,context)
          if (this.stopped || this.active.get(id)?.generation !== entry.generation) return
          const now = this.now()
          if (now > batch.time+120_000 || !session || now >= session.close) {
            this.repository.recordEvent(id,'skipped',now,'DECISION_EXPIRED',{ barTime: batch.time }); return
          }
          this.repository.commitDecision(id,String(batch.time),now,result.intents,result.nextState)
          this.log('decision',{ runId: id, barTime: batch.time, count: result.intents.length })
        } catch (error) {
          if (this.repository.halted) this.halt()
          else if (this.active.has(id)) this.pause(id,this.reason(error))
        }
      }))
      if (this.stopped) return
      const pendingSymbols = [...this.active.keys()].flatMap(id => this.repository.pending(id).map(o => o.intent.symbol))
      if (!pendingSymbols.length) return
      const references = await this.market.references(pendingSymbols)
      if (this.stopped) return
      const now = this.now()
      for (const [id] of this.active) {
        if (this.repository.getRun(id).status !== 'running') continue
        this.repository.expirePending(id,now,session?.close ?? now)
        for (const {intent} of this.repository.pending(id)) {
          const reference = references.find(r => r.symbol === intent.symbol)
          if (!reference) break
          const fill = this.repository.settle(id,intent.id,reference,now,session?.close ?? now)
          if (fill) this.log('filled',{ runId: id, intentId: intent.id, symbol: intent.symbol })
          if (this.repository.pending(id).some(o => o.intent.id === intent.id)) break
        }
      }
    } catch (error) {
      if (this.repository.halted) this.halt()
      else {
        const reason = this.reason(error)
        if (['NO_KEY','PERMISSION','CALENDAR_UNCOVERED'].includes(reason)) for (const id of [...this.active.keys()]) this.pause(id,reason)
        this.log('cycle_error',{ reasonCode: reason })
      }
    } finally { this.busy = false }
  }
  suspend(): void {
    if (this.stopped) return
    this.suspended = true
    this.sleeping = [...new Set([...this.active.keys(),...recoverableRuns(this.repository)])]
    this.market.reset('SYSTEM_SUSPEND')
    for (const id of this.sleeping) this.pause(id,'SYSTEM_SUSPEND')
  }
  async resume(): Promise<void> {
    if (this.stopped) return
    this.suspended = false
    this.lastTick = this.now()
    const ids = this.sleeping; this.sleeping = []
    for (const id of ids) if (this.repository.getRun(id).status === 'paused') await this.start(id,'recovery')
  }
  halt(): void {
    this.stopped = true; this.active.clear(); this.workers.close()
  }
  shutdown(): void {
    if (!this.repository.halted) for (const id of [...this.active.keys()]) this.pause(id,'SHUTDOWN')
    this.halt()
  }
}
