import { z } from 'zod'
import { moneySchema, qualitySchema, symbolSchema, timeSchema } from '../../shared/paper/schemas'
export const barSchema = z.object({
  source: z.literal('alpaca'), feed: z.literal('iex'), symbol: symbolSchema, interval: z.literal('1Min'),
  marketTime: timeSchema, receivedAt: timeSchema, open: moneySchema.positive(), high: moneySchema.positive(),
  low: moneySchema.positive(), close: moneySchema.positive(), volume: z.number().nonnegative().finite(), quality: qualitySchema
}).strict().refine(b => b.low <= Math.min(b.open, b.close) && b.high >= Math.max(b.open,b.close) && b.low <= b.high && b.marketTime % 60_000 === 0, 'INVALID_OHLC')
export interface QualityRecord { symbol: string; marketTime: number; observedAt: number; reason: string; mode: 'live' | 'warmup' | 'recovery' }
export class MarketError extends Error {
  constructor(readonly code: string, readonly retryMs = 0) { super(code) }
}
/** Convert decimal vendor dollars to integer microdollars, half-up. */
export function microdollars(value: number): number {
  if (!Number.isFinite(value) || value <= 0) throw new MarketError('INVALID_PRICE')
  const [mantissa, exponent = '0'] = value.toString().toLowerCase().split('e')
  const [whole, fraction = ''] = mantissa.split('.')
  const digits = BigInt(whole + fraction)
  const shift = 6 + Number(exponent) - fraction.length
  const result = shift >= 0 ? digits * 10n ** BigInt(shift) : (digits + 10n ** BigInt(-shift) / 2n) / 10n ** BigInt(-shift)
  return moneySchema.positive().parse(Number(result))
}
