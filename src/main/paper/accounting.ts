import type { Account } from '../../shared/paper/types'

export function integer(value: bigint): number {
  const n = Number(value)
  if (!Number.isSafeInteger(n)) throw new Error('MONEY_OVERFLOW')
  return n
}
// Half up, with nonnegative operands; all intermediate arithmetic uses bigint.
export function roundedRatio(n: bigint, d: bigint): number {
  if (n < 0n || d <= 0n) throw new Error('INVALID_RATIO')
  return integer((n + d / 2n) / d)
}
export function product(a: number, b: number): number { return integer(BigInt(a) * BigInt(b)) }
export function sum(a: number, b: number): number { return integer(BigInt(a) + BigInt(b)) }
export function assertAccount(account: Account): void {
  for (const n of [account.cash, account.income, account.realizedPnl]) if (!Number.isSafeInteger(n)) throw new Error('INVALID_ACCOUNT')
  if (account.cash < 0 || account.income < 0) throw new Error('NEGATIVE_ACCOUNT')
  if (new Set(account.positions.map(p => p.symbol)).size !== account.positions.length) throw new Error('DUPLICATE_POSITION')
  for (const p of account.positions) {
    if (!Number.isSafeInteger(p.quantity) || p.quantity <= 0 || !Number.isSafeInteger(p.cost) || p.cost < 0) throw new Error('INVALID_POSITION')
  }
}
export function equity(account: Account, prices: Record<string, number>): number {
  return account.positions.reduce((n, p) => {
    const price = prices[p.symbol]
    if (!Number.isSafeInteger(price) || price <= 0) throw new Error('MISSING_VALUATION')
    return sum(n, product(p.quantity, price))
  }, account.cash)
}
