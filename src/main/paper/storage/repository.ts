import Database from 'better-sqlite3'
import { randomUUID, createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { z } from 'zod'
import { checkpointSchema, intentSchema, runConfigSchema, runStatusSchema, timeSchema } from '../../../shared/paper/schemas'
import type { Account, CorporateAction, Fill, Intent, PaperRun, RunConfig, RunStatus, StrategyEvent, TradeReference } from '../../../shared/paper/types'
import { execute, executionOrder } from '../execution'
import { applyCorporateAction } from '../corporateActions'
import { barSchema, type QualityRecord } from '../quality'
import type { PaperBar } from '../../../shared/paper/types'
import { schema, marketSchema, SCHEMA_VERSION } from './schema'

type Row = { id: string; config: string; status: RunStatus; cash: number; realized: number; income: number }
type Order = { id: string; signal_time: number; status: string; payload: string }
const activePaths = new Set<string>()
function json(value: unknown): string {
  const text = JSON.stringify(value)
  if (text === undefined || Buffer.byteLength(text) > 1_048_576) throw new Error('INVALID_PAYLOAD_SIZE')
  return text
}

/** Sole synchronous writer; callers must share this service, never open per-run connections. */
export class PaperRepository {
  private db: Database.Database
  private failed = false
  private path: string
  constructor(filename: string, private onFailure: (error: unknown) => void = () => {}, private log: (event: string, fields: Record<string, unknown>) => void = () => {}) {
    this.path = filename === ':memory:' ? randomUUID() : resolve(filename)
    if (activePaths.has(this.path)) throw new Error('WRITER_ALREADY_OPEN')
    activePaths.add(this.path)
    let opened: Database.Database | undefined
    try {
      opened = new Database(filename); this.db = opened
      this.db.pragma('foreign_keys = ON'); this.db.pragma('journal_mode = WAL'); this.db.pragma('synchronous = FULL')
      if (this.db.pragma('quick_check', { simple: true }) !== 'ok') throw new Error('DATABASE_CORRUPT')
      const version = this.db.pragma('user_version', { simple: true }) as number
      if (version > SCHEMA_VERSION) throw new Error('UNSUPPORTED_SCHEMA')
      if (version < SCHEMA_VERSION) this.db.transaction(() => {
        if (version === 0) this.db.exec(schema)
        this.db.exec(marketSchema); this.db.pragma(`user_version = ${SCHEMA_VERSION}`)
      })()
      this.trace('opened', { schemaVersion: SCHEMA_VERSION, migrated: version === 0 })
    } catch (error) { opened?.close(); activePaths.delete(this.path); onFailure(error); throw error }
  }
  private trace(event: string, fields: Record<string, unknown>): void {
    try { this.log(event, fields) } catch { /* diagnostics cannot change ledger outcomes */ }
  }
  get halted(): boolean { return this.failed }
  private write<T>(fn: () => T): T {
    if (this.failed) throw new Error('STORE_HALTED')
    try {
      const result = this.db.transaction(fn)()
      this.trace('transaction_committed', {})
      return result
    } catch (error) {
      this.trace('transaction_rolled_back', { reasonCode: (error as { code?: string }).code ?? 'VALIDATION' })
      // Constraint violations are programmer/input conflicts, not loss of durable storage.
      const code = (error as { code?: string }).code
      if (code?.startsWith('SQLITE_') && !code.startsWith('SQLITE_CONSTRAINT')) {
        this.failed = true
        try { this.db.prepare("UPDATE runs SET status='error' WHERE status NOT IN ('ended','archived')").run() } catch { /* preserve database; in-memory latch remains authoritative */ }
        this.onFailure(error)
      }
      throw error
    }
  }
  registerVersion(id: string, source: string, build: string, stateSchema = 1): void {
    z.string().min(1).parse(id); z.number().int().positive().parse(stateSchema)
    const hash = createHash('sha256').update(source).digest('hex')
    this.write(() => {
      const old = this.db.prepare('SELECT * FROM strategy_versions WHERE id=?').get(id) as { hash: string; build: string; state_schema: number } | undefined
      if (old) { if (old.hash !== hash || old.build !== build || old.state_schema !== stateSchema) throw new Error('VERSION_IMMUTABLE'); return }
      this.db.prepare('INSERT INTO strategy_versions VALUES (?,?,?,?,?)').run(id, source, hash, build, stateSchema)
    })
  }
  createRun(id: string, raw: RunConfig, now: number): PaperRun {
    z.string().min(1).parse(id); timeSchema.parse(now)
    const config = runConfigSchema.parse(raw)
    this.write(() => {
      if (!this.db.prepare('SELECT id FROM strategy_versions WHERE id=?').get(config.strategyVersion)) throw new Error('UNKNOWN_STRATEGY_VERSION')
      this.db.prepare('INSERT INTO runs VALUES (?,?,?,?,0,0)').run(id, json(config), 'created', config.initialCash)
      this.ledger(id, 'initial', config.initialCash, config.initialCash)
      this.checkpoint(id, null, now); this.event(id, 'created', now, 'INITIAL_CAPITAL', {})
    })
    return this.getRun(id)
  }
  getRun(id: string): PaperRun {
    const row = this.db.prepare('SELECT * FROM runs WHERE id=?').get(id) as Row | undefined
    if (!row) throw new Error('RUN_NOT_FOUND')
    const positions = this.db.prepare('SELECT symbol,quantity,cost FROM positions WHERE run_id=? ORDER BY symbol').all(id) as Account['positions']
    return { id, config: JSON.parse(row.config), status: this.failed ? 'error' : row.status, account: { cash: row.cash, realizedPnl: row.realized, income: row.income, positions } }
  }
  listRuns(): PaperRun[] { return (this.db.prepare('SELECT id FROM runs ORDER BY id').all() as { id: string }[]).map(r => this.getRun(r.id)) }
  setStatus(id: string, status: RunStatus, now: number, reason: string): void {
    runStatusSchema.parse(status); timeSchema.parse(now)
    this.write(() => {
      const old = this.getRun(id).status
      if (old === 'archived' || (old === 'ended' && status !== 'archived')) throw new Error('RUN_TERMINAL')
      this.db.prepare('UPDATE runs SET status=? WHERE id=?').run(status, id)
      if (status !== 'running') this.cancelPendingInternal(id, now, reason)
      this.checkpoint(id,this.getCheckpoint(id).state,now)
      this.event(id, status, now, reason, {})
    })
  }
  commitDecision(runId: string, batchId: string, signalTime: number, intents: Intent[], nextState: unknown): boolean {
    z.string().min(1).parse(batchId); timeSchema.parse(signalTime)
    const sorted = executionOrder(z.array(intentSchema).max(100).parse(intents)); const payload = json({ intents: sorted, nextState })
    if (new Set(sorted.map(i => i.id)).size !== sorted.length) throw new Error('DUPLICATE_INTENT')
    return this.write(() => {
      if (this.db.prepare('SELECT 1 FROM decisions WHERE run_id=? AND batch_id=?').get(runId, batchId)) return false
      const run = this.getRun(runId)
      if (run.status !== 'running') throw new Error('RUN_NOT_RUNNING')
      if (sorted.some(i => !run.config.symbols.includes(i.symbol))) throw new Error('SYMBOL_NOT_ALLOWED')
      this.db.prepare('INSERT INTO decisions VALUES (?,?,?,?)').run(runId, batchId, signalTime, payload)
      for (const i of sorted) this.db.prepare("INSERT INTO orders VALUES (?,?,?,?,'pending',?,NULL)").run(runId, i.id, batchId, signalTime, json(i))
      this.checkpoint(runId, nextState, signalTime); this.event(runId, 'decision', signalTime, batchId, { count: sorted.length })
      return true
    })
  }
  pending(runId: string): Array<{ intent: Intent; signalTime: number }> {
    const rows = this.db.prepare("SELECT * FROM orders WHERE run_id=? AND status='pending' ORDER BY rowid").all(runId) as Order[]
    return rows.map(r => ({ intent: JSON.parse(r.payload), signalTime: r.signal_time }))
  }
  settle(runId: string, intentId: string, reference: TradeReference, now: number, sessionClose: number): Fill | null {
    timeSchema.parse(now); timeSchema.parse(sessionClose)
    return this.write(() => {
      const previous = this.db.prepare('SELECT payload FROM fills WHERE run_id=? AND intent_id=?').get(runId, intentId) as { payload: string } | undefined
      if (previous) return JSON.parse(previous.payload)
      const row = this.db.prepare('SELECT * FROM orders WHERE run_id=? AND id=?').get(runId, intentId) as Order | undefined
      if (!row || row.status !== 'pending') return null
      const run = this.getRun(runId)
      if (run.status !== 'running') throw new Error('RUN_NOT_RUNNING')
      if (this.pending(runId)[0]?.intent.id !== intentId) throw new Error('ORDER_SEQUENCE')
      const intent: Intent = JSON.parse(row.payload)
      let result: ReturnType<typeof execute>
      try { result = execute(run.account, run.config, intent, reference, row.signal_time, now, sessionClose) }
      catch (error) {
        const reason = (error as Error).message
        // Invalid/old poll references do not consume an intent: wait for a qualifying trade.
        if (reason === 'INVALID_REFERENCE_TIME' || error instanceof z.ZodError) return null
        this.db.prepare("UPDATE orders SET status=?,reason=? WHERE run_id=? AND id=?").run(reason === 'INTENT_EXPIRED' ? 'cancelled' : 'rejected', reason, runId, intentId)
        this.event(runId, 'order_rejected', now, reason, { intentId }); return null
      }
      const fill: Fill = { id: `${runId}:${intentId}`, runId, intentId, symbol: intent.symbol, side: intent.side, quantity: intent.quantity, price: result.price, fee: run.config.fee, marketTime: reference.marketTime, receivedAt: reference.receivedAt }
      this.saveAccount(runId, result.account)
      this.db.prepare('INSERT INTO fills VALUES (?,?,?)').run(runId, intentId, json(fill))
      this.db.prepare("UPDATE orders SET status='filled' WHERE run_id=? AND id=?").run(runId, intentId)
      this.ledger(runId, `fill:${intentId}`, result.cashDelta, result.account.cash)
      this.checkpoint(runId, this.getCheckpoint(runId).state, now)
      this.event(runId, 'filled', now, intent.reason, { intentId, fillId: fill.id })
      return fill
    })
  }
  corporateAction(runId: string, action: CorporateAction): boolean {
    return this.write(() => {
      if (this.db.prepare('SELECT 1 FROM corporate_actions WHERE run_id=? AND id=?').get(runId, action.id)) return false
      const run = this.getRun(runId)
      if (run.status !== 'paused') throw new Error('PAUSE_BEFORE_CORPORATE_ACTION')
      if (!run.config.symbols.includes(action.symbol)) throw new Error('SYMBOL_NOT_ALLOWED')
      const result = applyCorporateAction(run.account, action)
      this.saveAccount(runId, result.account)
      this.db.prepare('INSERT INTO corporate_actions VALUES (?,?,?)').run(runId, action.id, json(action))
      this.ledger(runId, `action:${action.id}`, result.cashDelta, result.account.cash)
      this.checkpoint(runId, this.getCheckpoint(runId).state, action.occurredAt)
      this.event(runId, 'corporate_action', action.occurredAt, action.type, { actionId: action.id }); return true
    })
  }
  private cancelPendingInternal(id: string, now: number, reason: string): void {
    for (const { intent } of this.pending(id)) {
      this.db.prepare("UPDATE orders SET status='cancelled',reason=? WHERE run_id=? AND id=?").run(reason, id, intent.id)
      this.event(id, 'cancelled', now, reason, { intentId: intent.id })
    }
  }
  // Restart never replays old intentions. The runtime must warm up before setting running.
  recover(now: number): void {
    timeSchema.parse(now)
    this.write(() => {
      for (const run of this.listRuns()) {
        this.cancelPendingInternal(run.id, now, 'RESTART')
        if (['running', 'warming', 'data_insufficient'].includes(run.status)) {
          this.db.prepare("UPDATE runs SET status='paused' WHERE id=?").run(run.id)
          const heartbeat = this.db.prepare("SELECT payload FROM run_events WHERE run_id=? AND json_extract(payload,'$.type')='heartbeat' ORDER BY cursor DESC LIMIT 1").get(run.id) as {payload: string} | undefined
          const since = heartbeat ? (JSON.parse(heartbeat.payload) as StrategyEvent).occurredAt : this.getCheckpoint(run.id).updatedAt
          this.event(run.id, 'interruption', now, 'RESTART_REQUIRES_WARMUP', { since, until: now })
        }
      }
    })
  }
  getCheckpoint(id: string): { schemaVersion: 1; state: unknown; updatedAt: number } {
    const row = this.db.prepare('SELECT payload FROM checkpoints WHERE run_id=?').get(id) as { payload: string }
    const checkpoint = checkpointSchema.parse(JSON.parse(row.payload))
    return { ...checkpoint, state: checkpoint.state }
  }
  events(after = 0, limit = 100): Array<{ cursor: number; event: StrategyEvent }> {
    z.number().int().nonnegative().parse(after); z.number().int().min(1).max(1000).parse(limit)
    return (this.db.prepare('SELECT cursor,payload FROM run_events WHERE cursor>? ORDER BY cursor LIMIT ?').all(after, limit) as { cursor: number; payload: string }[]).map(r => ({ cursor: r.cursor, event: JSON.parse(r.payload) }))
  }
  saveBar(raw: PaperBar): PaperBar {
    const bar = barSchema.parse(raw)
    return this.write(() => {
      const key = [bar.source, bar.feed, bar.symbol, bar.interval, bar.marketTime]
      const previous = this.db.prepare('SELECT revision,payload FROM bars WHERE source=? AND feed=? AND symbol=? AND interval=? AND market_time=? ORDER BY revision DESC LIMIT 1').get(...key) as { revision: number; payload: string } | undefined
      if (previous) {
        const old: PaperBar = JSON.parse(previous.payload)
        if (['open','high','low','close','volume'].every(k => old[k as keyof PaperBar] === bar[k as keyof PaperBar])) return old
        bar.quality = 'corrected'
      }
      this.db.prepare('INSERT INTO bars VALUES (?,?,?,?,?,?,?)').run(...key, previous ? previous.revision + 1 : 0, json(bar))
      return bar
    })
  }
  recordQuality(record: QualityRecord): void {
    timeSchema.parse(record.marketTime); timeSchema.parse(record.observedAt)
    this.write(() => this.db.prepare('INSERT INTO market_quality(symbol,market_time,observed_at,reason,mode) VALUES (?,?,?,?,?)').run(record.symbol, record.marketTime, record.observedAt, record.reason, record.mode))
  }
  qualityRecords(): QualityRecord[] {
    return this.db.prepare('SELECT symbol,market_time AS marketTime,observed_at AS observedAt,reason,mode FROM market_quality ORDER BY cursor').all() as QualityRecord[]
  }
  recordEvent(id: string, type: string, now: number, reason: string, summary: Record<string,unknown> = {}): void {
    this.write(() => this.event(id, type, now, reason, summary))
  }
  hasDecision(id: string, batchId: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM decisions WHERE run_id=? AND batch_id=?').get(id, batchId)
  }
  expirePending(id: string, now: number, sessionClose: number): void {
    this.write(() => {
      for (const { intent, signalTime } of this.pending(id)) if (now > signalTime + 60_000 || now >= sessionClose) {
        this.db.prepare("UPDATE orders SET status='cancelled',reason='INTENT_EXPIRED' WHERE run_id=? AND id=?").run(id,intent.id)
        this.event(id, 'cancelled', now, 'INTENT_EXPIRED', { intentId: intent.id })
      }
    })
  }
  async backup(destination: string): Promise<void> {
    if (this.failed) throw new Error('STORE_HALTED')
    if (existsSync(destination) || resolve(destination) === this.path) throw new Error('BACKUP_DESTINATION_EXISTS')
    await this.db.backup(destination)
  }
  close(): void { this.db.close(); activePaths.delete(this.path) }
  private checkpoint(id: string, state: unknown, now: number): void {
    this.db.prepare('INSERT OR REPLACE INTO checkpoints VALUES (?,?)').run(id, json({ schemaVersion: 1, state, updatedAt: now }))
  }
  private saveAccount(id: string, a: Account): void {
    this.db.prepare('UPDATE runs SET cash=?,realized=?,income=? WHERE id=?').run(a.cash, a.realizedPnl, a.income, id)
    this.db.prepare('DELETE FROM positions WHERE run_id=?').run(id)
    for (const p of a.positions) this.db.prepare('INSERT INTO positions VALUES (?,?,?,?)').run(id, p.symbol, p.quantity, p.cost)
  }
  private ledger(id: string, key: string, delta: number, balance: number): void {
    this.db.prepare('INSERT INTO cash_ledger(run_id,key,delta,balance) VALUES (?,?,?,?)').run(id, key, delta, balance)
  }
  private event(id: string, type: string, now: number, reason: string, summary: Record<string, unknown>): void {
    const event: StrategyEvent = { eventId: randomUUID(), schemaVersion: 1, runId: id, strategyVersion: this.getRun(id).config.strategyVersion, type, occurredAt: now, reason, summary }
    this.db.prepare('INSERT INTO run_events(event_id,run_id,payload) VALUES (?,?,?)').run(event.eventId, id, json(event))
  }
}
