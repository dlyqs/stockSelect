import { app } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { logger } from '../../logger'
import { PaperRepository } from './repository'

/** Lifecycle wiring in Phase 4 owns this instance and must stop scheduling on failure. */
export function openPaperRepository(onFailure: (error: unknown) => void): PaperRepository {
  const directory=app.getPath('userData'), pointer=join(directory,'paper-database.json')
  let filename='paper-trading.sqlite'
  if (existsSync(pointer)) {
    const saved=JSON.parse(readFileSync(pointer,'utf8')) as {filename:string}
    if (!/^paper-restored-[a-f0-9-]+\.sqlite$/.test(saved.filename) || !existsSync(join(directory,saved.filename))) throw new Error('INVALID_DATABASE_POINTER')
    filename=saved.filename
  }
  return new PaperRepository(join(directory, filename), error => {
    logger.write('error', ['[paper-store]', { event: 'storage_halted', reasonCode: (error as { code?: string }).code ?? 'OPEN_FAILED' }])
    onFailure(error)
  }, (event, fields) => logger.write('info', ['[paper-store]', { event, ...fields }]))
}
