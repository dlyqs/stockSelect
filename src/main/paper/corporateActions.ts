import { z } from 'zod'
import { moneySchema, symbolSchema, timeSchema } from '../../shared/paper/schemas'
import type { Account, CorporateAction } from '../../shared/paper/types'
import { assertAccount, integer, product, roundedRatio, sum } from './accounting'
const base = { id: z.string().min(1), symbol: symbolSchema, occurredAt: timeSchema }
const actionSchema = z.discriminatedUnion('type', [
  z.object({ ...base, type: z.literal('dividend'), perShare: moneySchema }).strict(),
  z.object({ ...base, type: z.literal('split'), numerator: z.number().int().positive().max(1e9), denominator: z.number().int().positive().max(1e9), cashInLieuPrice: moneySchema.positive().optional() }).strict()
])
export function applyCorporateAction(account: Account, action: CorporateAction): { account: Account; cashDelta: number } {
  actionSchema.parse(action); assertAccount(account)
  const next = structuredClone(account), p = next.positions.find(p => p.symbol === action.symbol)
  if (!p) return { account: next, cashDelta: 0 }
  let cashDelta: number
  if (action.type === 'dividend') {
    cashDelta = product(p.quantity, action.perShare); next.income = sum(next.income, cashDelta)
  } else {
    const total = BigInt(p.quantity) * BigInt(action.numerator), denominator = BigInt(action.denominator)
    const whole = total / denominator, remainder = total % denominator
    if (remainder && !action.cashInLieuPrice) throw new Error('CASH_IN_LIEU_REQUIRED')
    const removedCost = roundedRatio(BigInt(p.cost) * remainder, total)
    cashDelta = roundedRatio(BigInt(action.cashInLieuPrice ?? 0) * remainder, denominator)
    p.quantity = integer(whole); p.cost -= removedCost
    next.realizedPnl = sum(next.realizedPnl, sum(cashDelta, -removedCost))
    next.positions = next.positions.filter(p => p.quantity > 0)
  }
  next.cash = sum(next.cash, cashDelta); assertAccount(next)
  return { account: next, cashDelta }
}
