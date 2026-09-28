import type { Valuation, Performance } from '../../shared/paper/management'
import type { Fill, CorporateAction } from '../../shared/paper/types'
export function performance(initial: number, snapshots: Valuation[], fills: Fill[], interrupted = false, actions: CorporateAction[] = []): Performance {
  const valid = snapshots.filter((s): s is Valuation & { equity: number } => s.equity !== null)
  const incomplete = interrupted || snapshots.some(s => s.quality !== 'fresh')
  let peak = initial; let drawdown = 0
  for (const s of valid) { peak = Math.max(peak,s.equity); if (peak > 0) drawdown = Math.max(drawdown,(peak-s.equity)/peak*100) }
  const periods = (length: number): Performance['days'] => {
    let previous = initial
    const groups = new Map<string, number>()
    const formatter=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'})
    for (const s of valid) {
      const date = formatter.format(new Date(s.at)).slice(0,length)
      groups.set(date,s.equity)
    }
    return [...groups].map(([period, end],index,all) => { const returnPct = previous ? (end/previous-1)*100 : null; previous=end; return { period, returnPct, incomplete: incomplete || index===0 || index===all.length-1 } })
  }
  let closedTrades=0
  const quantities=new Map<string,number>()
  const transactions=[...fills.map(f=>({at:f.marketTime,fill:f,action:undefined as CorporateAction|undefined})),...actions.map(action=>({at:action.occurredAt,fill:undefined as Fill|undefined,action}))].sort((a,b)=>a.at-b.at)
  for(const transaction of transactions) {
    const f=transaction.fill, a=transaction.action
    if(f) {const previous=quantities.get(f.symbol) ?? 0;const next=previous+(f.side==='buy'?f.quantity:-f.quantity);if(f.side==='sell' && previous>0 && next===0)closedTrades++;quantities.set(f.symbol,next)}
    else if(a?.type==='split') quantities.set(a.symbol,Math.floor((quantities.get(a.symbol) ?? 0)*a.numerator/a.denominator))
  }
  const last = snapshots.at(-1)
  return { totalPnl: last?.equity == null ? null : last.equity-initial, returnPct: last?.equity == null ? null : (last.equity/initial-1)*100, maxDrawdownPct: valid.length ? drawdown : null, closedTrades, days:periods(10), months:periods(7), incomplete }
}
export function compare(series: Array<{ id: string; snapshots: Valuation[]; incomplete?: boolean }>): { from: number; to: number; returns: Array<{ id: string; returnPct: number; incomplete: boolean; points: Array<{at:number;value:number;fresh:boolean}> }> } | null {
  if (series.length < 2 || series.some(s => !s.snapshots.length)) return null
  // Only identical recorded timestamps form an honest common observation interval.
  const indexes=series.map(s=>new Map(s.snapshots.filter(p=>p.equity!==null).map(p=>[p.at,p])))
  const times = [...indexes[0].keys()].filter(t=>indexes.every(index=>index.has(t))).sort((a,b)=>a-b)
  if (times.length < 2) return null
  const from=times[0], to=times.at(-1)!
  if(indexes.some(index=>index.get(from)!.equity!<=0)) return null
  return { from,to,returns:series.map(s=>{ const first=s.snapshots.find(p=>p.at===from)!, last=s.snapshots.find(p=>p.at===to)!; return { id:s.id,returnPct:first.equity! > 0 ? (last.equity!/first.equity!-1)*100 : 0,points:s.snapshots.filter(p=>p.at>=from && p.at<=to && p.equity!==null).filter((_,i,points)=>i===0 || i===points.length-1 || i%Math.max(1,Math.ceil(points.length/2000))===0).map(p=>({at:p.at,value:first.equity!>0?(p.equity!/first.equity!-1)*100:0,fresh:p.quality==='fresh'})),incomplete:!!s.incomplete || s.snapshots.some(p=>p.at>=from && p.at<=to && p.quality!=='fresh') } }) }
}
