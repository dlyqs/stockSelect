import Database from 'better-sqlite3'
import { randomUUID, createHash } from 'node:crypto'
import { basename, join } from 'node:path'
import { writeFileSync, renameSync, readFileSync, statSync } from 'node:fs'
import { SCHEMA_VERSION, schema, marketSchema, readIndexes, readIndexNames } from './storage/schema'
import { runConfigSchema, fillSchema, checkpointSchema, strategyEventSchema } from '../../shared/paper/schemas'
import { assertAccount } from './accounting'
import type { PaperRepository } from './storage/repository'
const tables=['instruments','strategy_versions','runs','bars','decisions','orders','fills','cash_ledger','positions','equity_snapshots','run_events','corporate_actions','checkpoints','market_quality']
function empty(): Database.Database {
  const db=new Database(':memory:'); db.exec(schema); db.exec(marketSchema); db.exec(readIndexes); db.pragma(`user_version=${SCHEMA_VERSION}`); db.pragma('foreign_keys=ON'); return db
}
function jsonDatabase(source:string): Database.Database {
  if(statSync(source).size>256*1024*1024) throw new Error('JSON_BACKUP_TOO_LARGE')
  const input=JSON.parse(readFileSync(source,'utf8')) as {schemaVersion:number;tables:Record<string,Record<string,unknown>[]>}
  if(input.schemaVersion!==SCHEMA_VERSION || !input.tables || Object.keys(input.tables).sort().join()!==[...tables].sort().join()) throw new Error('INVALID_BACKUP')
  const db=empty()
  try {
    db.transaction(()=>{
      db.pragma('defer_foreign_keys=ON')
      for(const table of tables) {
        const columns=(db.pragma(`table_info(${table})`) as {name:string}[]).map(c=>c.name)
        const insert=db.prepare(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(()=>'?').join(',')})`)
        for(const row of input.tables[table]) {
          if(Object.keys(row).sort().join()!==[...columns].sort().join()) throw new Error('INVALID_BACKUP_ROW')
          insert.run(...columns.map(c=>row[c]))
        }
      }
    })()
    return db
  } catch(error) {db.close();throw error}
}
function validate(db:Database.Database):void {
  if (db.pragma('integrity_check',{simple:true})!=='ok' || db.pragma('user_version',{simple:true})!==SCHEMA_VERSION || (db.pragma('foreign_key_check') as unknown[]).length) throw new Error('INVALID_BACKUP')
  const expected=empty()
  try {
    const definition=(d:Database.Database): Array<{type:string;name:string;tbl_name:string;sql:string}> => d.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all() as Array<{type:string;name:string;tbl_name:string;sql:string}>
    const actual = definition(db), wanted = definition(expected)
    const required = (rows: typeof actual): typeof actual => rows.filter(row => !readIndexNames.includes(row.name))
    if(JSON.stringify(required(actual)) !== JSON.stringify(required(wanted))) throw new Error('INVALID_BACKUP_SCHEMA')
    // Only these exact optional indexes may be absent in pre-workbench backups.
    for(const row of actual.filter(row=>readIndexNames.includes(row.name))) {
      if(JSON.stringify(row) !== JSON.stringify(wanted.find(item=>item.name===row.name))) throw new Error('INVALID_BACKUP_SCHEMA')
    }
  } finally {expected.close()}
  for(const row of db.prepare('SELECT id,config,cash,realized,income,status FROM runs').all() as {id:string;config:string;cash:number;realized:number;income:number;status:string}[]) {
    const config=runConfigSchema.parse(JSON.parse(row.config))
    if(!db.prepare('SELECT 1 FROM strategy_versions WHERE id=?').get(config.strategyVersion)) throw new Error('INVALID_BACKUP_VERSION')
    const positions=db.prepare('SELECT symbol,quantity,cost FROM positions WHERE run_id=?').all(row.id) as {symbol:string;quantity:number;cost:number}[]
    assertAccount({cash:row.cash,realizedPnl:row.realized,income:row.income,positions})
    if(positions.some(p=>!config.symbols.includes(p.symbol)) || !['created','warming','running','data_insufficient','paused','ended','archived','error'].includes(row.status)) throw new Error('INVALID_BACKUP_ACCOUNT')
    const ledger=db.prepare('SELECT delta,balance FROM cash_ledger WHERE run_id=? ORDER BY cursor').all(row.id) as {delta:number;balance:number}[]
    let balance=0n
    for(const entry of ledger) {balance+=BigInt(entry.delta);if(balance!==BigInt(entry.balance)) throw new Error('INVALID_BACKUP_LEDGER')}
    if(balance!==BigInt(row.cash)) throw new Error('INVALID_BACKUP_BALANCE')
    const checkpoint=db.prepare('SELECT payload FROM checkpoints WHERE run_id=?').get(row.id) as {payload:string}|undefined
    if(!checkpoint) throw new Error('INVALID_BACKUP_CHECKPOINT')
    checkpointSchema.parse(JSON.parse(checkpoint.payload))
  }
  for(const row of db.prepare('SELECT source,hash FROM strategy_versions').all() as {source:string;hash:string}[]) if(createHash('sha256').update(row.source).digest('hex')!==row.hash) throw new Error('INVALID_BACKUP_SOURCE')
  for(const row of db.prepare('SELECT payload FROM fills').all() as {payload:string}[]) fillSchema.parse(JSON.parse(row.payload))
  for(const row of db.prepare('SELECT payload FROM run_events').all() as {payload:string}[]) strategyEventSchema.parse(JSON.parse(row.payload))
}
/** Stage a validated independent copy; the current database and a consistent pre-restore backup survive. */
export async function stageRestore(repository: PaperRepository, source: string, directory: string): Promise<string> {
  const input=source.toLowerCase().endsWith('.json')?jsonDatabase(source):new Database(source,{readonly:true,fileMustExist:true})
  const target=join(directory,`paper-restored-${randomUUID()}.sqlite`)
  try {validate(input); await input.backup(target)} finally {input.close()}
  const copied=new Database(target,{readonly:true,fileMustExist:true})
  try {validate(copied)} finally {copied.close()}
  await repository.backup(join(directory,`paper-before-restore-${randomUUID()}.sqlite`))
  const pointer=join(directory,'paper-database.json'), temp=`${pointer}.${randomUUID()}.tmp`
  writeFileSync(temp,JSON.stringify({filename:basename(target)}),{flag:'wx'})
  renameSync(temp,pointer)
  return target
}
