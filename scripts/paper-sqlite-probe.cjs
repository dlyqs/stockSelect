// Run with ELECTRON_RUN_AS_NODE=1. No BrowserWindow or application UI is created.
const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads')
const { mkdtempSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const assert = require('node:assert/strict')
if (isMainThread) {
  const directory = mkdtempSync(join(tmpdir(), 'paper-sqlite-probe-'))
  const worker = new Worker(__filename, { workerData: { path: join(directory, 'probe.sqlite'), driver: process.argv[2] || 'better-sqlite3' } })
  worker.on('message', result => console.log(JSON.stringify(result)))
  worker.on('error', error => { console.error(error.message); process.exitCode = 1 })
  worker.on('exit', code => { rmSync(directory, { recursive: true, force: true }); if (code) process.exitCode = code })
} else {
  const Database = require(workerData.driver)
  let db = new Database(workerData.path)
  db.pragma('journal_mode = WAL')
  db.exec('CREATE TABLE probe (id INTEGER PRIMARY KEY, value INTEGER NOT NULL)')
  db.transaction(() => db.prepare('INSERT INTO probe VALUES (?, ?)').run(1, 42))()
  assert.throws(() => db.transaction(() => { db.prepare('INSERT INTO probe VALUES (?, ?)').run(2, 99); throw new Error('rollback') })())
  db.close(); db = new Database(workerData.path)
  assert.deepEqual(db.prepare('SELECT * FROM probe').all(), [{ id: 1, value: 42 }]); db.close()
  parentPort.postMessage({ ok: true, electron: process.versions.electron, node: process.versions.node, abi: process.versions.modules, arch: process.arch, worker: true, transaction: true, rollback: true, reopen: true })
}
