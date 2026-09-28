import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { WorkbenchState } from '../../../../shared/paper/workbench'
import type { EquitySeries } from '../../panels/PaperEquityChart'
import PaperEquityChart from '../../panels/PaperEquityChart'
import { invoke } from '../../lib/ipc'
import { nyTime } from '../state'
import { percent,runName } from '../presentation'
import { Metrics,useHistory } from './DetailPage'
function Sample({id,name}:{id:string;name:string}):JSX.Element {
  const query=useHistory(id)
  return <section className="wb-card"><h2>{name}</h2><p className="wb-muted">该实例完整观察期指标；与上方共同区间收益口径不同。</p>{query.isPending&&<p>读取中…</p>}{query.isError&&<p role="alert">指标读取失败 <button onClick={()=>void query.refetch()}>重试</button></p>}{query.data&&<Metrics data={query.data}/>}</section>
}
export default function ComparePage({state}:{state:WorkbenchState}):JSX.Element {
  const [selected,setSelected]=useState<string[]>([])
  const ids=selected.filter(id=>state.runs.some(r=>r.id===id)).sort()
  const query=useQuery({queryKey:['paper-compare',ids],enabled:ids.length>=2,queryFn:()=>invoke<{from:number;to:number;returns:Array<EquitySeries&{returnPct:number;incomplete:boolean}>}|null>('paper:compare',ids),staleTime:30000,refetchInterval:60000,refetchIntervalInBackground:false})
  return <><section className="wb-card"><h2>选择 2–10 个独立实例</h2><p>按共同起点净值归一为收益率，已包含账本费用与滑点；不按绝对盈亏排名。不足两个相同时间采样时不比较。</p><div className="wb-fields">{state.runs.map(r=><label className="wb-check" key={r.id}><input type="checkbox" checked={ids.includes(r.id)} disabled={!ids.includes(r.id)&&ids.length>=10} onChange={e=>setSelected(e.target.checked?[...ids,r.id]:ids.filter(id=>id!==r.id))}/>{runName(r)}</label>)}</div>{ids.length<2&&<p>请选择至少两个实例；归档历史也可参与。</p>}</section>{ids.length>=2&&<section className="wb-card">{query.isPending&&<p role="status">正在计算共同观察区间…</p>}{query.isError&&<p role="alert">比较失败：{query.error.message}<button onClick={()=>void query.refetch()}>重试</button></p>}{query.data===null&&<p>暂无有效共同观察区间，不能给出可比收益。</p>}{query.data&&<><h2>共同观察区间</h2><p>{nyTime(query.data.from)} — {nyTime(query.data.to)}</p>{query.data.returns.map(r=><p key={r.id}>{runName(state.runs.find(run=>run.id===r.id)!)}：{percent(r.returnPct)} · {r.incomplete?'数据不完整 / 公司行动未核对':'请结合覆盖率判断'}</p>)}<PaperEquityChart label="共同起点归一收益率 %" series={query.data.returns}/><p className="wb-muted">每条曲线最多约 2000 个展示点，收益使用原始观察值计算。缺口和旧价不连线；不表示同期具备完整市场覆盖。</p></>}</section>}{ids.map(id=><Sample key={id} id={id} name={runName(state.runs.find(r=>r.id===id)!)}/>)}</>
}
