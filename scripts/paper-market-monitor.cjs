// Headless, read-only evidence recorder. No order endpoints, account writes, or credentials in output.
require('dotenv').config({ quiet: true })
const { appendFileSync, writeFileSync } = require('node:fs')
const { resolve } = require('node:path')
const { setTimeout: delay } = require('node:timers/promises')
async function main() {
  const key=process.env.ALPACA_API_KEY,split=key?.indexOf(':') ?? -1
  if(!key || split<=0) { console.log(JSON.stringify({verified:false,reason:'NO_KEY',unblock:'Set authorized ALPACA_API_KEY=KEY_ID:SECRET; run in regular US session for at least 60 minutes'})); return }
  const minutes=Number(process.argv[2] ?? 60),symbols=(process.argv[3] ?? 'AAPL,SPY').split(',')
  if(!Number.isInteger(minutes) || minutes<60 || minutes>390 || symbols.length>10 || !symbols.length || new Set(symbols).size!==symbols.length || symbols.some(s=>!/^\b[A-Z][A-Z0-9.-]{0,14}$/.test(s))) throw new Error('INVALID_ARGUMENTS')
  const start=Date.now(),duration=minutes*60000
  const formatter=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'})
  const parts=formatter.formatToParts(start),part=k=>parts.find(p=>p.type===k).value
  const date=`${part('year')}-${part('month')}-${part('day')}`,minute=Number(part('hour'))*60+Number(part('minute'))
  const holidays=['2026-01-01','2026-01-19','2026-02-16','2026-04-03','2026-05-25','2026-06-19','2026-07-03','2026-09-07','2026-11-26','2026-12-25']
  const close=['2026-11-27','2026-12-24'].includes(date)?780:960
  if(part('year')!=='2026' || ['Sat','Sun'].includes(part('weekday')) || holidays.includes(date) || minute<570 || minute+minutes>=close) {
    console.log(JSON.stringify({verified:false,reason:'INSUFFICIENT_REGULAR_SESSION',date,minutes,unblock:'Start after 09:30 America/New_York with more than the requested minutes remaining before close; calendar covers 2026 only'}));return
  }
  const output=resolve(process.argv[4] ?? `paper-market-evidence-${start}.jsonl`)
  writeFileSync(output,'',{flag:'wx'})
  const emit=record=>appendFileSync(output,JSON.stringify(record)+'\n')
  const headers={'APCA-API-KEY-ID':key.slice(0,split),'APCA-API-SECRET-KEY':key.slice(split+1)}
  let requests=0,errors=0,gaps=0,cycles=0,lastCycle=0
  const seen=new Set(),tradeSymbols=new Set()
  emit({type:'start',at:start,source:'alpaca',feed:'iex',adjustment:'raw',symbols,minutes})
  while(Date.now()-start<duration) {
    const cycle=Date.now();if(lastCycle && cycle-lastCycle>90000) {gaps++;emit({type:'interruption',since:lastCycle,until:cycle})}lastCycle=cycle;cycles++
    for(const endpoint of ['bars','trades/latest']) {
      const now=Date.now(),marketMinute=Math.floor(now/60000)*60000-60000
      const url=new URL(`https://data.alpaca.markets/v2/stocks/${endpoint}`)
      url.searchParams.set('feed','iex');url.searchParams.set('symbols',symbols.join(','))
      if(endpoint==='bars')for(const [k,v] of Object.entries({timeframe:'1Min',adjustment:'raw',start:new Date(marketMinute).toISOString(),end:new Date(marketMinute+59999).toISOString(),limit:'10000'}))url.searchParams.set(k,v)
      try {
        requests++
        const response=await fetch(url,{headers,signal:globalThis.AbortSignal.timeout(10000)}),receivedAt=Date.now()
        emit({type:'request',endpoint,status:response.status,receivedAt,remaining:response.headers.get('x-ratelimit-remaining')})
        if(!response.ok) {errors++;if([401,403,429].includes(response.status))throw new Error('STOP_PERMISSION_OR_RATE_LIMIT');continue}
        const body=await response.json()
        for(const symbol of symbols) {
          const records=endpoint==='bars'?(body.bars?.[symbol] ?? []):body.trades?.[symbol]?[body.trades[symbol]]:[]
          const times=records.map(r=>Date.parse(r.t)).filter(Number.isFinite)
          const valid=times.filter(t=>endpoint==='bars'?t===marketMinute && receivedAt>=t+60000 && receivedAt<=t+120000:t<=receivedAt && receivedAt-t<=60000)
          if(endpoint==='bars' && valid.length && marketMinute>=Math.ceil(start/60000)*60000)seen.add(`${symbol}:${marketMinute}`)
          if(endpoint!=='bars' && valid.length)tradeSymbols.add(symbol)
          emit({type:'observation',endpoint,symbol,receivedAt,marketTimes:times,valid:valid.length>0})
        }
      } catch(error) {if(error.message==='STOP_PERMISSION_OR_RATE_LIMIT'){emit({type:'summary',verified:false,reason:error.message,requests,errors});console.log(JSON.stringify({verified:false,output,reason:error.message}));return}errors++;emit({type:'transport_error',endpoint,at:Date.now()})}
    }
    await delay(Math.max(0,Math.min(5000-(Date.now()-cycle),duration-(Date.now()-start))))
  }
  const elapsedMs=Date.now()-start,expected=Math.max(0,Math.floor((Date.now()-5000)/60000)-Math.ceil(start/60000))*symbols.length
  const summary={type:'summary',verified:elapsedMs>=duration && gaps===0 && errors===0 && seen.size>=expected && tradeSymbols.size===symbols.length,elapsedMs,requests,cycles,errors,gaps,freshSymbolMinutes:seen.size,minimumExpected:expected,freshTradeSymbols:tradeSymbols.size,source:'alpaca',feed:'iex'}
  emit(summary);console.log(JSON.stringify({...summary,output}))
}
main().catch(()=>{console.error('Market monitor failed; no credentials or raw responses were logged');process.exitCode=1})
