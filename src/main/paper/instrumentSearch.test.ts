import { afterEach, describe, expect, it, vi } from 'vitest'
import { matchInstruments, parseInstrumentDirectory, searchInstruments } from './instrumentSearch'

const directory = `Nasdaq Traded|Symbol|Security Name|ETF|Test Issue
Y|AAPL|Apple Inc.|N|N
Y|SPY|SPDR S&P 500 Trust|Y|N
Y|SPYG|SPDR Growth|Y|N
Y|TEST|Test security|N|Y
N|OLD|Old security|N|N
Y|UNKNOWN|Unknown classification||N
File Creation Time: 09282026||||`

afterEach(() => vi.unstubAllGlobals())

describe('instrument search', () => {
  it('uses the explicit ETF flag and excludes test, inactive and unclassified rows', () => {
    expect(parseInstrumentDirectory(directory)).toEqual([
      { symbol: 'AAPL', name: 'Apple Inc.', kind: 'stock' },
      { symbol: 'SPY', name: 'SPDR S&P 500 Trust', kind: 'etf' },
      { symbol: 'SPYG', name: 'SPDR Growth', kind: 'etf' }
    ])
    expect(() => parseInstrumentDirectory('<html>Error</html>')).toThrow('格式异常')
  })
  it('matches names and symbols case-insensitively and ranks exact symbols first', () => {
    const items = parseInstrumentDirectory(directory).reverse()
    expect(matchInstruments(items, ' spy ').map(i => i.symbol)).toEqual(['SPY', 'SPYG'])
    expect(matchInstruments(items, 'apple')[0].symbol).toBe('AAPL')
    expect(matchInstruments(items, '')).toEqual([])
    expect(matchInstruments(items, 'missing')).toEqual([])
  })
  it('retries failed downloads, shares concurrent downloads, and caches successful results', async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ ok: true, text: async () => directory })
    vi.stubGlobal('fetch', fetcher)
    await expect(searchInstruments('AAPL')).rejects.toThrow('offline')
    const [stock, etf] = await Promise.all([searchInstruments('AAPL'), searchInstruments('SPY')])
    expect(stock[0].kind).toBe('stock')
    expect(etf[0].kind).toBe('etf')
    await searchInstruments('apple')
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
})
