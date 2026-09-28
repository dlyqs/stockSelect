import { app } from 'electron'
import { join } from 'node:path'
import { logger } from '../../logger'
import { PaperRepository } from './repository'

/** Lifecycle wiring in Phase 4 owns this instance and must stop scheduling on failure. */
export function openPaperRepository(onFailure: (error: unknown) => void): PaperRepository {
  return new PaperRepository(join(app.getPath('userData'), 'paper-trading.sqlite'), error => {
    logger.write('error', ['[paper-store]', { event: 'storage_halted', reasonCode: (error as { code?: string }).code ?? 'OPEN_FAILED' }])
    onFailure(error)
  }, (event, fields) => logger.write('info', ['[paper-store]', { event, ...fields }]))
}
