import { z } from 'zod'
import { create } from 'zustand'
import type { RunStatus } from '../../../shared/paper/types'
export const pages = { overview: '总览', strategies: '策略', instruments: '标的池', compare: '绩效比较', data: '数据与核对', settings: '设置与备份', help: '使用说明', create: '新建策略', detail: '策略详情' } as const
export type Page = keyof typeof pages
export const draftSchema = z.object({ version: z.literal(1), requestId: z.string().uuid().optional(), step: z.number().int().min(0).max(3), template: z.string(), symbols: z.array(z.string()).max(10), parameters: z.record(z.string()), cash: z.string(), fee: z.string(), slippage: z.string(), position: z.string() }).strict()
export type Draft = z.infer<typeof draftSchema>
export const emptyDraft: Draft = { version: 1, step: 0, template: '', symbols: [], parameters: {}, cash: '10000', fee: '0', slippage: '0', position: '100' }
export function readDraft(raw: string | null): Draft {
  try { return draftSchema.parse(JSON.parse(raw ?? 'null')) } catch { return { ...emptyDraft, symbols: [], parameters: {} } }
}
export type StrategyFilter = 'all' | 'active' | 'attention' | 'history' | RunStatus
export const strategyFilters: Record<StrategyFilter, string> = {
  all: '全部账户（含归档）', active: '运行 / 预热', attention: '需要查看（未归档）',
  created: '待启动', warming: '预热中', running: '运行中', paused: '已暂停',
  data_insufficient: '数据不足', error: '发生错误', ended: '已结束', archived: '已归档', history: '已结束 / 已归档',
}
interface NavigationState {
  page: Page
  terminal: boolean
  runId: string | null
  strategyFilter: StrategyFilter
  strategySearch: string
  navigate: (page: Page, runId?: string) => void
  setTerminal: (value: boolean) => void
  openStrategies: (filter?: StrategyFilter) => void
  setStrategyFilter: (filter: StrategyFilter) => void
  setStrategySearch: (search: string) => void
}
export const useNavigation = create<NavigationState>(set => ({
  page: 'overview', terminal: false, runId: null, strategyFilter: 'all', strategySearch: '',
  navigate: (page, runId) => set({ page, terminal: false, runId: runId ?? null }),
  setTerminal: terminal => set({ terminal }),
  openStrategies: (strategyFilter = 'all') => set({ page: 'strategies', terminal: false, runId: null, strategyFilter, strategySearch: '' }),
  setStrategyFilter: strategyFilter => set({ strategyFilter }),
  setStrategySearch: strategySearch => set({ strategySearch }),
}))
/** Exact decimal conversion, never multiply a binary floating point dollar value. */
export function decimalUnits(raw: string, digits: number): number {
  if (!new RegExp(`^\\d+(?:\\.\\d{1,${digits}})?$`).test(raw)) throw new Error(`请输入非负数，最多 ${digits} 位小数`)
  const [whole, fraction = ''] = raw.split('.')
  const value = BigInt(whole) * 10n ** BigInt(digits) + BigInt(fraction.padEnd(digits, '0'))
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('数值超过安全上限')
  return Number(value)
}
export const statusText: Record<string, string> = { created: '待启动', warming: '预热中', running: '运行中', paused: '已暂停', data_insufficient: '数据不足', error: '发生错误', ended: '已结束', archived: '已归档' }
export const nyTime = (at?: number | null): string => at == null ? '无最近记录' : new Intl.DateTimeFormat('zh-CN', { timeZone: 'America/New_York', dateStyle: 'short', timeStyle: 'medium' }).format(at) + '（纽约）'

export function unitsDecimal(value: number, digits: number): string {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('INVALID_UNITS')
  const raw = String(value).padStart(digits+1,'0')
  return raw.slice(0,-digits) + '.' + raw.slice(-digits)
}
