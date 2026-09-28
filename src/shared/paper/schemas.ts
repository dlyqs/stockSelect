import { z } from 'zod'

// USD values are integer microdollars (1 USD = 1,000,000 units).
export const moneySchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
export const timeSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
export const symbolSchema = z.string().regex(/^[A-Z][A-Z0-9.-]{0,14}$/)
export const runStatusSchema = z.enum(['created', 'warming', 'running', 'paused', 'data_insufficient', 'error', 'ended', 'archived'])
export const qualitySchema = z.enum(['fresh', 'stale', 'missing', 'late', 'corrected', 'unverified'])
export const runConfigSchema = z.object({
  symbols: z.array(symbolSchema).min(1).max(10).refine(s => new Set(s).size === s.length),
  initialCash: moneySchema.positive(), fee: moneySchema,
  slippageBps: z.number().int().min(0).max(9999),
  // Per-symbol acquisition cost ceiling as a fraction of initial capital.
  maxPositionBps: z.number().int().min(1).max(10000),
  parameters: z.record(z.unknown()), strategyVersion: z.string().min(1)
}).strict()
export const intentSchema = z.object({
  id: z.string().min(1), symbol: symbolSchema, side: z.enum(['buy', 'sell']),
  quantity: z.number().int().positive().max(1_000_000_000), reason: z.string().min(1).max(2048)
}).strict()
export const referenceSchema = z.object({
  source: z.literal('alpaca'), feed: z.literal('iex'), symbol: symbolSchema,
  price: moneySchema.positive(), marketTime: timeSchema, receivedAt: timeSchema
}).strict()
export const checkpointSchema = z.object({ schemaVersion: z.literal(1), state: z.unknown(), updatedAt: timeSchema }).strict()
export const strategyEventSchema = z.object({
  eventId: z.string().min(1), schemaVersion: z.literal(1), runId: z.string().min(1),
  strategyVersion: z.string().min(1), type: z.string().min(1), occurredAt: timeSchema,
  reason: z.string(), summary: z.record(z.unknown())
}).strict()
export const fillSchema = z.object({
  id: z.string(), runId: z.string(), intentId: z.string(), symbol: symbolSchema,
  side: z.enum(['buy', 'sell']), quantity: z.number().int().positive(),
  price: moneySchema.positive(), fee: moneySchema, marketTime: timeSchema, receivedAt: timeSchema
}).strict()
export const PAPER_POLICY = Object.freeze({
  moneyScale: 1_000_000, barIntervalMs: 60_000, firstPollDelayMs: 5_000,
  barDeadlineMs: 60_000, intentTtlMs: 60_000, warmupBars: 300,
  source: 'alpaca', feed: 'iex', adjustment: 'raw', stateSchemaVersion: 1
} as const)
