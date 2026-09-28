import { describe, expect, it, vi } from 'vitest'
import { ReadinessChecker } from './readiness'
const response = (status: number, body: unknown = {}): Response => new Response(JSON.stringify(body), {status})
describe('paper readiness', () => {
  it('keeps missing credentials separate from success without issuing requests', async () => {
    const fetcher=vi.fn()
    const checker=new ReadinessChecker(()=>null,fetcher,()=>42)
    expect(checker.state().checkedAt).toBeNull()
    expect(await checker.check()).toEqual({checkedAt:42,iex:'NO_KEY',assets:'NO_KEY'})
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('reports IEX and asset permissions independently, deduplicating concurrent checks', async () => {
    const fetcher=vi.fn(async (url: string | URL | Request)=>String(url).includes('data.alpaca')?response(429):response(403))
    const checker=new ReadinessChecker(()=>'id:secret',fetcher)
    const first=checker.check(), second=checker.check()
    expect(first).toBe(second)
    expect(await first).toMatchObject({iex:'RATE_LIMIT',assets:'PERMISSION'})
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
  it('discards an in-flight result when credentials change', async () => {
    let release!: (value: Response)=>void
    const promise=new Promise<Response>(resolve=>{release=resolve})
    const checker=new ReadinessChecker(()=>'id:secret',()=>promise)
    const check=checker.check()
    checker.invalidate()
    release(response(403))
    expect(await check).toEqual({checkedAt:null,iex:'UNVERIFIED',assets:'UNVERIFIED'})
  })
  it('distinguishes malformed response and network error without retaining response bodies', async () => {
    const checker=new ReadinessChecker(()=>'id:secret',async url=>{if(String(url).includes('data.alpaca')) return response(200,{unexpected:'secret'}); throw new Error('credential-containing-network-message')})
    const result=await checker.check()
    expect(result).toMatchObject({iex:'INVALID_RESPONSE',assets:'NETWORK'})
    expect(JSON.stringify(result)).not.toContain('secret')
  })
  it('validates both response contracts without claiming a fresh quote', async () => {
    const checker=new ReadinessChecker(()=>'id:secret',async url=>response(200,String(url).includes('data.alpaca')?{trades:{}}:{symbol:'SPY',class:'us_equity'}))
    expect(await checker.check()).toMatchObject({iex:'OK',assets:'OK'})
    checker.invalidate()
    expect(checker.state().iex).toBe('UNVERIFIED')
  })
})
