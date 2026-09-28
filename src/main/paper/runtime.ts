import { logger } from '../logger'
import { openPaperRepository } from './storage/open'
import { AlpacaPaperSource } from './marketSource'
import { MarketDataService } from './marketData'
import { PaperTradingService } from './service'
import { PaperScheduler } from './scheduler'
export interface PaperRuntime { service: PaperTradingService; suspend(): void; resume(): void; shutdown(): Promise<void> }
export function createPaperRuntime(getKey: () => string | null): PaperRuntime | null {
  let service: PaperTradingService | undefined
  let scheduler: PaperScheduler | undefined
  const log = (event: string, fields: Record<string,unknown>): void => logger.write('info',['[paper-run]',{ event,...fields }])
  try {
    const repository = openPaperRepository(() => { scheduler?.stop(); service?.halt() })
    const market = new MarketDataService(new AlpacaPaperSource(getKey),repository,Date.now,(event,fields) => logger.write('info',['[paper-data]',{event,...fields}]))
    service = new PaperTradingService(repository,market,undefined,Date.now,log)
    const current = service
    scheduler = new PaperScheduler(() => current.tick(),() => log('scheduler_error',{}))
    let closing = false
    let suspended = false
    const ready = current.initialize().then(() => { if (!closing && !suspended) scheduler!.start() }).catch(() => { current.halt(); log('initialization_failed',{}) })
    return {
      service: current,
      suspend: () => { suspended = true; scheduler!.stop(); current.suspend() },
      resume: () => { suspended = false; void ready.then(() => current.resume()).then(() => { if (!closing && !suspended) scheduler!.start() }).catch(() => log('resume_failed',{})) },
      shutdown: async () => {
        if (closing) return
        closing = true; scheduler!.stop(); current.shutdown()
        await ready; await scheduler!.drain(); await market.drain(); repository.close()
      }
    }
  } catch { log('unavailable',{ reasonCode: 'STORE_OPEN_FAILED' }); return null }
}
