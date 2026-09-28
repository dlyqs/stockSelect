import { Worker } from 'node:worker_threads'
import { z } from 'zod'
import { intentSchema } from '../../shared/paper/schemas'
import type { StrategyContext, StrategyResult } from '../../shared/paper/types'
import { executable } from '../../strategies/registry'
import type { TemplateKind } from '../../strategies/templates'
export interface StrategyExecutor {
  evaluate(runId: string, kind: TemplateKind, context: StrategyContext): Promise<StrategyResult>
  stop(runId: string): void
  close(): void
}
const resultSchema = z.object({ intents: z.array(intentSchema).max(100), nextState: z.record(z.number().int().min(-1).max(1)) }).strict()
/** Worker is fault isolation for trusted local templates, not a hostile-code sandbox. */
export class StrategyWorkers implements StrategyExecutor {
  private workers = new Map<string, { worker: Worker; cancel?: () => void }>()
  constructor(private timeoutMs = 1000, private code = executable) {}
  evaluate(runId: string, kind: TemplateKind, context: StrategyContext): Promise<StrategyResult> {
    if (Buffer.byteLength(JSON.stringify(context)) > 2_000_000) return Promise.reject(new Error('CONTEXT_TOO_LARGE'))
    if (this.workers.get(runId)?.cancel) return Promise.reject(new Error('WORKER_BUSY'))
    let entry = this.workers.get(runId)
    if (!entry) {
      const worker = new Worker(`
        const {parentPort,workerData} = require('node:worker_threads');
        const evaluate = (${this.code});
        function freeze(value) { if(value && typeof value==='object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
        parentPort.on('message', context => {
          try {
            const result = evaluate(workerData.kind, freeze(context));
            const payload = JSON.stringify(result);
            if (typeof payload !== 'string' || Buffer.byteLength(payload)>65536) throw new Error('OUTPUT_TOO_LARGE');
            parentPort.postMessage({ payload });
          } catch { parentPort.postMessage({ error: 'STRATEGY_FAILED' }); }
        });
      `, { eval: true, workerData: { kind }, resourceLimits: { maxOldGenerationSizeMb: 32, stackSizeMb: 2 } })
      entry = { worker }; this.workers.set(runId,entry)
      // Errors while idle must not become uncaught main-process errors.
      worker.on('error', () => { if (this.workers.get(runId)?.worker === worker) this.stop(runId) })
    }
    const current = entry
    return new Promise((resolve,reject) => {
      const finish = (error?: Error, result?: StrategyResult): void => {
        clearTimeout(timer); current.worker.off('message',message); current.worker.off('exit',exit)
        current.cancel = undefined
        if (error) { this.stop(runId); reject(error) } else resolve(result!)
      }
      const message = (reply: { error?: string; payload?: string }): void => {
        try {
          if (reply.error || !reply.payload || Buffer.byteLength(reply.payload)>65536) throw new Error(reply.error ?? 'INVALID_OUTPUT')
          finish(undefined,resultSchema.parse(JSON.parse(reply.payload)))
        } catch { finish(new Error('INVALID_STRATEGY_OUTPUT')) }
      }
      const exit = (): void => finish(new Error('WORKER_EXIT'))
      const timer = setTimeout(() => finish(new Error('WORKER_TIMEOUT')),this.timeoutMs)
      current.cancel = () => finish(new Error('WORKER_STOPPED'))
      current.worker.once('message',message); current.worker.once('exit',exit)
      current.worker.postMessage(context)
    })
  }
  stop(runId: string): void {
    const entry = this.workers.get(runId)
    if (!entry) return
    this.workers.delete(runId); entry.cancel?.(); void entry.worker.terminate()
  }
  close(): void { for (const id of [...this.workers.keys()]) this.stop(id) }
}
