import { createHash } from 'node:crypto'
import { z } from 'zod'
import source from './templates.ts?raw'
import { evaluateTemplate, type TemplateKind } from './templates'
const quantity = z.number().int().min(1).max(1_000_000)
const window = z.number().int().min(2).max(299)
const schemas = {
  sma: z.object({ fast: window.default(10), slow: window.default(30), quantity: quantity.default(1) }).strict().refine(p => p.fast < p.slow),
  rsi: z.object({ period: window.default(14), lower: z.number().min(0).max(100).default(30), upper: z.number().min(0).max(100).default(70), quantity: quantity.default(1) }).strict().refine(p => p.lower < p.upper),
  breakout: z.object({ lookback: window.default(20), quantity: quantity.default(1) }).strict()
}
export const executable = evaluateTemplate.toString()
const hash = createHash('sha256').update(source).update(executable).digest('hex')
export const strategyVersions = (['sma','rsi','breakout'] as const).map(kind => ({ kind, id: `${kind}:${hash}`, source, build: `templates-v1:${hash}`, stateSchema: 1 }))
export function templateFor(version: string): TemplateKind {
  const entry = strategyVersions.find(v => v.id === version)
  if (!entry) throw new Error('STRATEGY_VERSION_UNAVAILABLE')
  return entry.kind
}
export function parametersFor(kind: TemplateKind, raw: Record<string,unknown>): Record<string,number> { return schemas[kind].parse(raw) }
export function requiredBars(kind: TemplateKind, parameters: Record<string,unknown>): number {
  const p = parametersFor(kind,parameters)
  return kind === 'sma' ? p.slow : (kind === 'rsi' ? p.period : p.lookback)+1
}
