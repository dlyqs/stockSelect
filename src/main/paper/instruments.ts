import { z } from 'zod'
// Metadata-only endpoint; never calls the order API. Alpaca classifies ETFs as us_equity too.
export async function validateInstrument(symbol: string, key: string | null): Promise<void> {
  const split=key?.indexOf(':') ?? -1
  if (!key || split<=0) throw new Error('NO_KEY')
  const response=await fetch(`https://paper-api.alpaca.markets/v2/assets/${encodeURIComponent(symbol)}`,{headers:{'APCA-API-KEY-ID':key.slice(0,split),'APCA-API-SECRET-KEY':key.slice(split+1)},signal:AbortSignal.timeout(10000)})
  if (!response.ok) throw new Error(response.status===401 || response.status===403 ? 'PERMISSION' : 'INSTRUMENT_UNAVAILABLE')
  const asset=z.object({symbol:z.string(),class:z.literal('us_equity'),status:z.literal('active'),tradable:z.literal(true),exchange:z.string()}).parse(await response.json())
  if (asset.symbol!==symbol || !['NYSE','NASDAQ','ARCA','AMEX','BATS','NYSEARCA'].includes(asset.exchange)) throw new Error('UNSUPPORTED_INSTRUMENT')
}
