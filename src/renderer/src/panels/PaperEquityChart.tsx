import { nyTime } from '../workbench/state'
export interface EquitySeries { id: string; points: Array<{at:number;value:number|null;fresh:boolean}> }
/** Plot actual persisted observations; no interpolation across stale data or interruptions. */
export default function PaperEquityChart({series,label}:{series:EquitySeries[];label:string}):JSX.Element {
  const points=series.flatMap(s=>s.points).filter((p):p is {at:number;value:number;fresh:boolean}=>p.value!==null),values=points.map(p=>p.value),times=points.map(p=>p.at)
  if(!points.length)return <p>暂无净值采样</p>
  const min=Math.min(...values),max=Math.max(...values),start=Math.min(...times),end=Math.max(...times)
  const x=(at:number):number=>40+(at-start)/Math.max(1,end-start)*540
  const y=(v:number):number=>140-(v-min)/Math.max(1,max-min)*120
  const colors=['var(--wb-chart-1, #fbbf24)','var(--wb-chart-2, #22d3ee)','var(--wb-chart-3, #a78bfa)','var(--wb-chart-4, #34d399)']
  return <figure className="paper-equity-chart"><figcaption>{label} · {min.toFixed(2)} 至 {max.toFixed(2)}（仅连接相邻新鲜分钟采样）</figcaption><svg viewBox="0 0 600 165" className="w-full max-h-48" role="img" aria-label={label}>
    <g className="paper-chart-grid" aria-hidden="true" stroke="currentColor" opacity="0.12">{[20,60,100,140].map(y=><line key={y} x1="40" y1={y} x2="580" y2={y} strokeDasharray="3 5"/>)}</g>
    {series.map((s,index)=><g key={s.id} fill={colors[index%colors.length]} stroke={colors[index%colors.length]}>{s.points.map((p,i)=>p.value===null?null:<g key={p.at}>{i>0 && s.points[i-1].value!==null && p.fresh && s.points[i-1].fresh && p.at-s.points[i-1].at<=90000 && <line x1={x(s.points[i-1].at)} y1={y(s.points[i-1].value!)} x2={x(p.at)} y2={y(p.value)}/>}<circle cx={x(p.at)} cy={y(p.value)} r={p.fresh?1.5:3} opacity={p.fresh?1:0.35}><title>{s.id}: {nyTime(p.at)} · {p.value.toFixed(3)} · {p.fresh?'新鲜采样':'陈旧采样'}</title></circle></g>)}</g>)}
  </svg><p>{nyTime(start)} — {nyTime(end)}</p><p>{series.map((s,i)=><span key={s.id} style={{color:colors[i%colors.length]}}>{s.id.slice(0,8)} </span>)}</p></figure>
}
