import { z } from 'zod'
export const templateFields = {
  fast: { label: '短均线窗口', min: 2, max: 299, default: 10, step: 1, unit: '分钟' },
  slow: { label: '长均线窗口', min: 2, max: 299, default: 30, step: 1, unit: '分钟' },
  period: { label: 'RSI 窗口', min: 2, max: 299, default: 14, step: 1, unit: '分钟' },
  lower: { label: '买入阈值', min: 0, max: 100, default: 30, step: 0.01, unit: 'RSI' },
  upper: { label: '卖出阈值', min: 0, max: 100, default: 70, step: 0.01, unit: 'RSI' },
  lookback: { label: '突破窗口', min: 2, max: 299, default: 20, step: 1, unit: '分钟' },
  quantity: { label: '单次交易数量', min: 1, max: 1000000, default: 1, step: 1, unit: '股' }
} as const
export const templateInfo = {
  sma: { name: '双均线', description: '短均线上穿长均线买入，下穿卖出。短窗口须小于长窗口。', fields: ['fast','slow','quantity'] },
  rsi: { name: 'RSI 均值回归', description: '使用简单窗口 RSI，低于下限买入、高于上限卖出；买入阈值须小于卖出阈值。', fields: ['period','lower','upper','quantity'] },
  breakout: { name: '区间突破', description: '价格突破历史窗口高点买入，跌破低点卖出。', fields: ['lookback','quantity'] }
} as const
export type TemplateKind = keyof typeof templateInfo
function field(key: keyof typeof templateFields): z.ZodDefault<z.ZodNumber> {
  const f = templateFields[key]
  let schema = z.number().min(f.min).max(f.max)
  if (f.step === 1) schema = schema.int()
  return schema.default(f.default)
}
export const parameterSchemas = {
  sma: z.object({ fast: field('fast'), slow: field('slow'), quantity: field('quantity') }).strict().refine(p => p.fast < p.slow, { path: ['fast'], message: '短窗口须小于长窗口' }),
  rsi: z.object({ period: field('period'), lower: field('lower'), upper: field('upper'), quantity: field('quantity') }).strict().refine(p => p.lower < p.upper, { path: ['lower'], message: '买入阈值须小于卖出阈值' }),
  breakout: z.object({ lookback: field('lookback'), quantity: field('quantity') }).strict()
}
