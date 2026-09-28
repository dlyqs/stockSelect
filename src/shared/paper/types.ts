import type { z } from 'zod'
import type { runConfigSchema, runStatusSchema, qualitySchema, intentSchema, referenceSchema, checkpointSchema, strategyEventSchema, fillSchema } from './schemas'
export type RunConfig = z.infer<typeof runConfigSchema>
export type RunStatus = z.infer<typeof runStatusSchema>
export type MarketQuality = z.infer<typeof qualitySchema>
export type Intent = z.infer<typeof intentSchema>
export type TradeReference = z.infer<typeof referenceSchema>
export type Checkpoint = z.infer<typeof checkpointSchema>
export type StrategyEvent = z.infer<typeof strategyEventSchema>
export type Fill = z.infer<typeof fillSchema>
export interface Position { symbol: string; quantity: number; cost: number }
export interface Account { cash: number; realizedPnl: number; income: number; positions: Position[] }
export interface PaperRun { id: string; config: RunConfig; status: RunStatus; account: Account }
export interface PaperBar {
  source: 'alpaca'; feed: 'iex'; symbol: string; interval: '1Min'; marketTime: number; receivedAt: number
  open: number; high: number; low: number; close: number; volume: number; quality: MarketQuality
}
export interface StrategyContext { bars: Readonly<Record<string, readonly PaperBar[]>>; account: Readonly<Account>; parameters: Readonly<Record<string, unknown>>; state: unknown }
export interface StrategyResult { intents: Intent[]; nextState: unknown }
export type CorporateAction = { id: string; symbol: string; occurredAt: number } & (
  { type: 'dividend'; perShare: number } | { type: 'split'; numerator: number; denominator: number; cashInLieuPrice?: number }
)
