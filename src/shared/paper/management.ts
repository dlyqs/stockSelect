import { z } from 'zod'
import { moneySchema, runConfigSchema, symbolSchema, timeSchema } from './schemas'
import type { PaperRun, Fill, StrategyEvent } from './types'
export const actionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('create'), config: runConfigSchema, requestId: z.string().uuid().optional() }).strict(),
  z.object({ type: z.literal('control'), id: z.string().min(1).max(100), action: z.enum(['start','pause','end','archive','liquidate','review']) }).strict(),
  z.object({ type: z.literal('add'), symbol: symbolSchema, kind: z.enum(['stock','etf']) }).strict(),
  z.object({ type: z.literal('remove'), symbol: symbolSchema }).strict(),
  z.object({ type: z.literal('corporate'), action: z.discriminatedUnion('type', [
    z.object({ id: z.string().min(1).max(100), symbol: symbolSchema, occurredAt: timeSchema, type: z.literal('dividend'), perShare: moneySchema }),
    z.object({ id: z.string().min(1).max(100), symbol: symbolSchema, occurredAt: timeSchema, type: z.literal('split'), numerator: z.number().int().positive().max(1000000), denominator: z.number().int().positive().max(1000000), cashInLieuPrice: moneySchema.positive().optional() })
  ]) }).strict()
])
export const historySchema = z.object({ id: z.string().min(1).max(100), from: timeSchema.default(0), to: timeSchema.default(Number.MAX_SAFE_INTEGER), offset: z.number().int().min(0).max(10000000).default(0), limit: z.number().int().min(1).max(500).default(100) }).strict().refine(p => p.from <= p.to)
export interface Valuation { at: number; equity: number | null; realized: number; income: number; unrealized: number | null; prices: Record<string,{ price: number; at: number }>; quality: 'fresh' | 'stale' | 'missing' }
export interface Performance { totalPnl: number | null; returnPct: number | null; maxDrawdownPct: number | null; closedTrades: number; days: Array<{ period: string; returnPct: number | null; incomplete: boolean }>; months: Array<{ period: string; returnPct: number | null; incomplete: boolean }>; incomplete: boolean }
export interface PaperState { runs: PaperRun[]; instruments: Array<{ symbol: string; kind: string }>; templates: Array<{ id: string; kind: string; parameters: Record<string,number> }>; valuations: Record<string,Valuation>; halted: boolean }
export interface PaperHistory { fills: Fill[]; snapshots: Valuation[]; events: StrategyEvent[]; performance: Performance; reviewed: boolean; qualityCount: number; coverage: {expected: number; fresh: number; pct: number | null}; observedMs: number; counts: { fills: number; snapshots: number; events: number } }
