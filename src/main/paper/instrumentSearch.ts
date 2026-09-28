import type { InstrumentHit } from '../../shared/paper/instruments'
import { symbolSchema } from '../../shared/paper/schemas'

// Nasdaq's consolidated directory includes an explicit ETF flag for all exchanges.
export function parseInstrumentDirectory(text: string): InstrumentHit[] {
  const [header, ...rows] = text.trim().split(/\r?\n/)
  const columns = header.split('|')
  const required = ['Symbol', 'Security Name', 'ETF', 'Test Issue', 'Nasdaq Traded']
  if (required.some(name => !columns.includes(name))) throw new Error('证券目录格式异常，请稍后重试')
  return rows.flatMap(row => {
    const values = row.split('|')
    const get = (name: string): string => values[columns.indexOf(name)] ?? ''
    const symbol = get('Symbol'), flag = get('ETF')
    if (get('Test Issue') !== 'N' || get('Nasdaq Traded') !== 'Y' || !['Y', 'N'].includes(flag) || !symbolSchema.safeParse(symbol).success) return []
    return [{ symbol, name: get('Security Name'), kind: flag === 'Y' ? 'etf' as const : 'stock' as const }]
  })
}

export function matchInstruments(directory: InstrumentHit[], query: string): InstrumentHit[] {
  const term = query.trim().toUpperCase()
  if (!term) return []
  const rank = (hit: InstrumentHit): number => hit.symbol === term ? 0 : hit.symbol.startsWith(term) ? 1 : 2
  return directory.filter(hit => hit.symbol.includes(term) || hit.name.toUpperCase().includes(term))
    .sort((a, b) => rank(a) - rank(b) || a.symbol.localeCompare(b.symbol)).slice(0, 12)
}

let cached: { items: InstrumentHit[]; at: number } | undefined
let pending: Promise<InstrumentHit[]> | undefined
export async function searchInstruments(query: string): Promise<InstrumentHit[]> {
  if (!cached || Date.now() - cached.at > 3600_000) {
    pending ??= (async () => {
      const response = await fetch('https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqtraded.txt', { signal: AbortSignal.timeout(60000) })
      if (!response.ok) throw new Error('证券目录暂时不可用，请稍后重试')
      const items = parseInstrumentDirectory(await response.text())
      if (!items.length) throw new Error('证券目录为空，请稍后重试')
      cached = { items, at: Date.now() }
      return items
    })().finally(() => { pending = undefined })
    await pending
  }
  return matchInstruments(cached!.items, query)
}
