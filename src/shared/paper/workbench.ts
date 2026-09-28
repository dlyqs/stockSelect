import { z } from 'zod'
import type { PaperState } from './management'
export type CheckReason = 'UNVERIFIED' | 'OK' | 'NO_KEY' | 'PERMISSION' | 'RATE_LIMIT' | 'NETWORK' | 'INVALID_RESPONSE'
export interface Readiness { checkedAt: number | null; iex: CheckReason; assets: CheckReason }
export interface WorkbenchState extends PaperState {
  observedAt: number
  service: 'initializing' | 'ready' | 'suspended' | 'halted' | 'unavailable'
  session: 'open' | 'closed' | 'unknown'
  configured: boolean
  readiness: Readiness
  restorePending: boolean
  summaries: Record<string, { latestSampleAt: number | null; createdAt: number | null; reviewed: boolean; latestEvent: { at: number; type: string; reason: string } | null; liquidating: boolean }>
  market: { at: number; marketTime: number; reason: string; symbol: string; mode: string } | null
}
export const pageSchema = z.object({ id: z.string().min(1).max(100), kind: z.enum(['fills','snapshots','events']), from: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0), to: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(Number.MAX_SAFE_INTEGER), offset: z.number().int().min(0).max(10000000).default(0), limit: z.number().int().min(1).max(500).default(100) }).strict().refine(q => q.from <= q.to)
