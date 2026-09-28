import { intentSchema, referenceSchema, runConfigSchema, timeSchema, PAPER_POLICY } from '../../shared/paper/schemas'
import type { Account, Intent, RunConfig, TradeReference } from '../../shared/paper/types'
import { assertAccount, product, roundedRatio, sum } from './accounting'

export function executionOrder(intents: Intent[]): Intent[] {
  return [...intents].sort((a,b) => (a.side === b.side ? 0 : a.side === 'sell' ? -1 : 1) || a.symbol.localeCompare(b.symbol) || a.id.localeCompare(b.id))
}
export function execute(account: Account, config: RunConfig, intent: Intent, reference: TradeReference, signalTime: number, now: number, sessionClose: number): { account: Account; price: number; cashDelta: number } {
  assertAccount(account); runConfigSchema.parse(config); intentSchema.parse(intent); referenceSchema.parse(reference)
  timeSchema.parse(signalTime); timeSchema.parse(now); timeSchema.parse(sessionClose)
  if (!config.symbols.includes(intent.symbol) || intent.symbol !== reference.symbol) throw new Error('SYMBOL_NOT_ALLOWED')
  if (now < signalTime || now >= sessionClose || now > signalTime + PAPER_POLICY.intentTtlMs) throw new Error('INTENT_EXPIRED')
  if (reference.marketTime <= signalTime || reference.marketTime >= sessionClose || reference.receivedAt < reference.marketTime || reference.receivedAt > now || reference.receivedAt > signalTime + PAPER_POLICY.intentTtlMs) throw new Error('INVALID_REFERENCE_TIME')
  const price = roundedRatio(BigInt(reference.price) * BigInt(10000 + (intent.side === 'buy' ? config.slippageBps : -config.slippageBps)), 10000n)
  if (price <= 0) throw new Error('INVALID_EXECUTION_PRICE')
  const next = structuredClone(account)
  const position = next.positions.find(p => p.symbol === intent.symbol)
  const gross = product(price, intent.quantity)
  let cashDelta: number
  if (intent.side === 'buy') {
    const cost = sum(gross, config.fee)
    if (cost > next.cash) throw new Error('INSUFFICIENT_CASH')
    const totalCost = sum(position?.cost ?? 0, cost)
    if (BigInt(totalCost) * 10000n > BigInt(config.initialCash) * BigInt(config.maxPositionBps)) throw new Error('POSITION_LIMIT')
    if (position) { position.quantity = sum(position.quantity, intent.quantity); position.cost = totalCost }
    else next.positions.push({ symbol: intent.symbol, quantity: intent.quantity, cost })
    cashDelta = -cost
  } else {
    if (!position || intent.quantity > position.quantity) throw new Error('INSUFFICIENT_SHARES')
    const allocated = roundedRatio(BigInt(position.cost) * BigInt(intent.quantity), BigInt(position.quantity))
    cashDelta = sum(gross, -config.fee)
    if (sum(next.cash, cashDelta) < 0) throw new Error('INSUFFICIENT_CASH')
    next.realizedPnl = sum(next.realizedPnl, sum(cashDelta, -allocated))
    position.quantity -= intent.quantity; position.cost -= allocated
    next.positions = next.positions.filter(p => p.quantity > 0)
  }
  next.cash = sum(next.cash, cashDelta); assertAccount(next)
  return { account: next, price, cashDelta }
}
