import type { StrategyContext, StrategyResult } from '../shared/paper/types'
export type TemplateKind = 'sma' | 'rsi' | 'breakout'
/** Trusted, self-contained TypeScript templates. No IO; all state travels in the checkpoint. */
export function evaluateTemplate(kind: TemplateKind, context: StrategyContext): StrategyResult {
  const intents: StrategyResult['intents'] = []
  const p = context.parameters as Record<string,number>
  const previous = (context.state ?? {}) as Record<string,number>
  const nextState = { ...previous }
  for (const symbol of Object.keys(context.bars).sort()) {
    const bars = context.bars[symbol]
    const prices = bars.map(b => b.close)
    let signal: number
    if (kind === 'sma') {
      const average = (n: number): number => prices.slice(-n).reduce((a,b) => a+b,0)/n
      if (prices.length < p.slow) continue
      signal = average(p.fast) > average(p.slow) ? 1 : -1
    } else if (kind === 'rsi') {
      if (prices.length < p.period+1) continue
      let gain = 0; let loss = 0
      for (let i=prices.length-p.period;i<prices.length;i++) {
        const delta = prices[i]-prices[i-1]; gain += Math.max(0,delta); loss += Math.max(0,-delta)
      }
      // Explicit simple-window RSI; flat windows are neutral (50).
      const rsi = gain+loss === 0 ? 50 : 100*gain/(gain+loss)
      signal = rsi < p.lower ? 1 : rsi > p.upper ? -1 : 0
    } else {
      if (prices.length < p.lookback+1) continue
      const before = bars.slice(-p.lookback-1,-1)
      const last = prices[prices.length-1]
      signal = last > Math.max(...before.map(b => b.high)) ? 1 : last < Math.min(...before.map(b => b.low)) ? -1 : 0
    }
    const held = context.account.positions.find(pos => pos.symbol === symbol)?.quantity ?? 0
    // SMA only acts on transitions; RSI/breakout use level signals and current holdings.
    const changed = kind !== 'sma' || previous[symbol] !== signal
    if (changed && ((signal === 1 && !held) || (signal === -1 && held))) {
      intents.push({ id: `${bars[bars.length-1].marketTime}:${symbol}`, symbol, side: signal === 1 ? 'buy' : 'sell', quantity: signal === 1 ? p.quantity : held, reason: `${kind.toUpperCase()}_${signal === 1 ? 'ENTRY' : 'EXIT'}` })
    }
    nextState[symbol] = signal
  }
  return { intents, nextState }
}
