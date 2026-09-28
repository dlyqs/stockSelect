export const SCHEMA_VERSION = 2
export const schema = `
CREATE TABLE strategy_versions (id TEXT PRIMARY KEY, source TEXT NOT NULL, hash TEXT NOT NULL, build TEXT NOT NULL, state_schema INTEGER NOT NULL);
CREATE TABLE instruments (symbol TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('stock','etf')));
CREATE TABLE runs (id TEXT PRIMARY KEY, config TEXT NOT NULL, status TEXT NOT NULL, cash INTEGER NOT NULL CHECK(cash>=0), realized INTEGER NOT NULL, income INTEGER NOT NULL CHECK(income>=0));
CREATE TABLE positions (run_id TEXT NOT NULL REFERENCES runs(id), symbol TEXT NOT NULL, quantity INTEGER NOT NULL CHECK(quantity>0), cost INTEGER NOT NULL CHECK(cost>=0), PRIMARY KEY(run_id,symbol));
CREATE TABLE decisions (run_id TEXT NOT NULL REFERENCES runs(id), batch_id TEXT NOT NULL, signal_time INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(run_id,batch_id));
CREATE TABLE orders (run_id TEXT NOT NULL REFERENCES runs(id), id TEXT NOT NULL, batch_id TEXT NOT NULL, signal_time INTEGER NOT NULL, status TEXT NOT NULL, payload TEXT NOT NULL, reason TEXT, PRIMARY KEY(run_id,id), FOREIGN KEY(run_id,batch_id) REFERENCES decisions(run_id,batch_id));
CREATE TABLE fills (run_id TEXT NOT NULL REFERENCES runs(id), intent_id TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(run_id,intent_id), FOREIGN KEY(run_id,intent_id) REFERENCES orders(run_id,id));
CREATE TABLE cash_ledger (cursor INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL REFERENCES runs(id), key TEXT NOT NULL, delta INTEGER NOT NULL, balance INTEGER NOT NULL, UNIQUE(run_id,key));
CREATE TABLE run_events (cursor INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL UNIQUE, run_id TEXT NOT NULL REFERENCES runs(id), payload TEXT NOT NULL);
CREATE TABLE checkpoints (run_id TEXT PRIMARY KEY REFERENCES runs(id), payload TEXT NOT NULL);
CREATE TABLE corporate_actions (run_id TEXT NOT NULL REFERENCES runs(id), id TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(run_id,id));
CREATE TABLE bars (source TEXT NOT NULL, feed TEXT NOT NULL, symbol TEXT NOT NULL, interval TEXT NOT NULL, market_time INTEGER NOT NULL, revision INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(source,feed,symbol,interval,market_time,revision));
CREATE TABLE equity_snapshots (run_id TEXT NOT NULL REFERENCES runs(id), occurred_at INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(run_id,occurred_at));
CREATE INDEX events_run_cursor ON run_events(run_id,cursor);
`

export const marketSchema = `
CREATE TABLE IF NOT EXISTS market_quality (cursor INTEGER PRIMARY KEY AUTOINCREMENT, symbol TEXT NOT NULL, market_time INTEGER NOT NULL, observed_at INTEGER NOT NULL, reason TEXT NOT NULL, mode TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS quality_time ON market_quality(market_time);
`

// Additive read indexes; old schema-v2 backups remain valid without them.
export const readIndexNames = ['paper_fills_time','paper_events_time','paper_bars_symbol_time','paper_review_cursor']
export const readIndexes = `CREATE INDEX IF NOT EXISTS paper_fills_time ON fills(run_id,json_extract(payload,'$.marketTime'));
CREATE INDEX IF NOT EXISTS paper_events_time ON run_events(run_id,json_extract(payload,'$.occurredAt'));
CREATE INDEX IF NOT EXISTS paper_bars_symbol_time ON bars(symbol,market_time DESC,revision DESC);
CREATE INDEX IF NOT EXISTS paper_review_cursor ON run_events(run_id,cursor DESC) WHERE json_extract(payload,'$.type') IN ('corporate_review','corporate_action') OR json_extract(payload,'$.reason')='CORPORATE_ACTION_REVIEW';`
