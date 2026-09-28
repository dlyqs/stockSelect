export interface EquitySeries { id: string; points: Array<{at:number;value:number;fresh:boolean}> }
/** Plot actual persisted observations; no interpolation across stale data or interruptions. */
export default function PaperEquityChart({series,label}:{series:EquitySeries[];label:string}):JSX.Element {
  const points=series.flatMap(s=>s.points),values=points.map(p=>p.value),times=points.map(p=>p.at)
  if(!points.length)return <p>暂无净值采样</p>
  const min=Math.min(...values),max=Math.max(...values),start=Math.min(...times),end=Math.max(...times)
  const x=(at:number):number=>40+(at-start)/Math.max(1,end-start)*540
  const y=(v:number):number=>140-(v-min)/Math.max(1,max-min)*120
  const colors=['#fbbf24','#22d3ee','#a78bfa','#34d399']
  return <figure><figcaption>{label} · {min.toFixed(2)} 至 {max.toFixed(2)}（仅连接相邻新鲜分钟采样）</figcaption><svg viewBox="0 0 600 165" className="w-full max-h-48" role="img" aria-label={label}>
    {series.map((s,index)=><g key={s.id} fill={colors[index%colors.length]} stroke={colors[index%colors.length]}>{s.points.map((p,i)=><g key={p.at}>{i>0 && p.fresh && s.points[i-1].fresh && p.at-s.points[i-1].at<=90000 && <line x1={x(s.points[i-1].at)} y1={y(s.points[i-1].value)} x2={x(p.at)} y2={y(p.value)}/>}<circle cx={x(p.at)} cy={y(p.value)} r={p.fresh?1.5:3} opacity={p.fresh?1:0.35}><title>{s.id}: {new Date(p.at).toLocaleString()} · {p.value.toFixed(3)} · {p.fresh?'fresh':'stale'}</title></circle></g>)}</g>)}
  </svg><p>{new Date(start).toLocaleString()} — {new Date(end).toLocaleString()}</p><p>{series.map((s,i)=><span key={s.id} style={{color:colors[i%colors.length]}}>{s.id.slice(0,8)} </span>)}</p></figure>
}
