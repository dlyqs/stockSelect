import type { PaperRepository } from './storage/repository'
/** Explicit user pauses remain paused; only interrupted background runs auto-resume. */
export function recoverableRuns(repository: PaperRepository): string[] {
  const events = new Map<string,string>()
  let cursor = 0
  for (;;) {
    const page = repository.events(cursor,1000)
    if (!page.length) break
    for (const row of page) {
      if (['paused','interruption'].includes(row.event.type)) events.set(row.event.runId,row.event.reason)
      cursor = row.cursor
    }
  }
  return repository.listRuns().filter(run => ['running','warming','data_insufficient'].includes(run.status) ||
    (run.status === 'paused' && ['SYSTEM_SUSPEND','SHUTDOWN','RESTART_REQUIRES_WARMUP'].includes(events.get(run.id) ?? ''))).map(run => run.id)
}
