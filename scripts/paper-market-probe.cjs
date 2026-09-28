// Read-only market data probe. Never prints credentials or raw responses.
require('dotenv').config({ quiet: true })
async function main() {
  const key = process.env.ALPACA_API_KEY
  if (!key || !key.includes(':')) { console.log(JSON.stringify({ verified: false, reason: 'ALPACA_API_KEY KEY_ID:SECRET unavailable', unblock: 'Supply an authorized Alpaca IEX key and run during a regular trading session' })); return }
  const separator = key.indexOf(':')
  const headers = { 'APCA-API-KEY-ID': key.slice(0,separator), 'APCA-API-SECRET-KEY': key.slice(separator+1) }
  for (const symbol of ['AAPL','SPY']) {
    for (const endpoint of ['bars/latest','trades/latest']) {
      const response = await fetch(`https://data.alpaca.markets/v2/stocks/${symbol}/${endpoint}?feed=iex`, { headers, signal: globalThis.AbortSignal.timeout(15000) })
      const body = await response.json()
      const time = body.bar?.t ?? body.trade?.t ?? null
      console.log(JSON.stringify({ symbol, endpoint, source:'alpaca', feed:'iex', status:response.status, marketTime:time, receivedAt:new Date().toISOString(), ageMs:time ? Date.now()-Date.parse(time) : null, rateLimit:response.headers.get('x-ratelimit-limit'), remaining:response.headers.get('x-ratelimit-remaining') }))
    }
  }
}
main().catch(() => { console.error('Market probe failed: transport or response error'); process.exitCode = 1 })
