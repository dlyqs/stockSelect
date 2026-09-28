import { useCallback, useEffect, useState } from 'react'
import PaperEquityChart, { type EquitySeries } from './PaperEquityChart'
import { invoke } from '../lib/ipc'
import type { PaperState, PaperHistory } from '../../../shared/paper/management'
import { runConfigSchema } from '../../../shared/paper/schemas'
const dollars=(n:number|null|undefined):string=>n==null?'—':(n/1e6).toLocaleString('en-US',{style:'currency',currency:'USD',maximumFractionDigits:4})
const time=(n:number):string=>new Date(n).toLocaleString()
const box='border border-term-border bg-term-bg p-1 text-term-text'
export default function PaperPanel(): JSX.Element {
  const [state,setState]=useState<PaperState>(),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false)
  const [symbol,setSymbol]=useState(''),[kind,setKind]=useState('stock'),[selected,setSelected]=useState<string[]>([])
  const [version,setVersion]=useState(''),[parameters,setParameters]=useState('{}'),[cash,setCash]=useState('10000'),[fee,setFee]=useState('0'),[slippage,setSlippage]=useState('5'),[cap,setCap]=useState('10000')
  const [id,setId]=useState(''),[data,setData]=useState<PaperHistory>(),[from,setFrom]=useState(''),[to,setTo]=useState(''),[offset,setOffset]=useState(0)
  const [compared,setCompared]=useState<string[]>([]),[comparison,setComparison]=useState<{from:number;to:number;returns:Array<{id:string;returnPct:number;incomplete:boolean;points:EquitySeries['points']}>}|null>()
  const [actionId,setActionId]=useState(''),[actionSymbol,setActionSymbol]=useState(''),[actionType,setActionType]=useState('dividend'),[amount,setAmount]=useState('0'),[numerator,setNumerator]=useState('1'),[denominator,setDenominator]=useState('1'),[cashInLieu,setCashInLieu]=useState(''),[actionDate,setActionDate]=useState('')
  const refresh=useCallback(async()=>{setState(await invoke<PaperState>('paper:state'))},[])
  const loadHistory=useCallback(async()=>{if(id) setData(await invoke<PaperHistory>('paper:history',{id,from:from?Date.parse(from):0,to:to?Date.parse(to)+86400000-1:Number.MAX_SAFE_INTEGER,offset,limit:100}))},[id,from,to,offset])
  useEffect(()=>{let alive=true; const update=():void=>{void refresh().catch(e=>{if(alive)setError(String(e))})}; update();const timer=setInterval(update,5000);return()=>{alive=false;clearInterval(timer)}},[refresh])
  useEffect(()=>{void loadHistory().catch(e=>setError(String(e)))},[loadHistory,state])
  async function perform(channel:string,payload?:unknown):Promise<void>{setBusy(true);setError('');try{const result=await invoke<{restartRequired?:boolean;cancelled?:boolean}>(channel,payload);if(result?.restartRequired)setNotice('恢复副本已校验并准备完成。当前运行已暂停，请退出并重新启动应用完成切换。原数据库和恢复前备份均保留。');else if(channel==='paper:export' && !result?.cancelled)setNotice('导出成功');await refresh()}catch(e){setError(String(e))}finally{setBusy(false)}}
  const control=(action:string):void=>{void perform('paper:action',{type:'control',id,action})}
  const run=state?.runs.find(r=>r.id===id), valuation=state?.valuations[id]
  return <div className="h-full overflow-auto p-3 text-xs text-term-text space-y-4">
    <h2 className="text-term-amber font-bold">PAPER · 实时模拟策略</h2>
    <p>Alpaca IEX · 未复权 · 仅美股常规时段 · 分钟信号 / 轮询观察价模拟成交。卖出资金立即可用，不模拟 T+1。无实盘下单。</p>
    <p>设置中配置 Alpaca KEY_ID:SECRET；ETF 类型由你核对。示例策略不代表收益承诺，公司行动未经核对不代表完整总回报。</p>
    {error && <p role="alert" className="text-red-400">{error}</p>}{notice && <p role="status">{notice}</p>}{state?.halted && <p role="alert">账本故障，运行已停止；保留数据库并检查日志。</p>}
    <fieldset disabled={busy} className="space-y-2"><legend>手选标的池（全局最多 10 个）</legend>
      <input aria-label="股票代码" className={box} value={symbol} onChange={e=>setSymbol(e.target.value.toUpperCase())}/><select aria-label="标的类型" className={box} value={kind} onChange={e=>setKind(e.target.value)}><option value="stock">股票</option><option value="etf">ETF</option></select>
      <button className={box} onClick={()=>void perform('paper:action',{type:'add',symbol,kind})}>验证并添加</button>
      <div>{state?.instruments.map(i=><span key={i.symbol} className="inline-block mr-3"><label><input type="checkbox" checked={selected.includes(i.symbol)} onChange={e=>setSelected(e.target.checked?[...selected,i.symbol]:selected.filter(s=>s!==i.symbol))}/>{i.symbol} ({i.kind})</label> <button onClick={()=>void perform('paper:action',{type:'remove',symbol:i.symbol})}>移除</button></span>)}</div>
    </fieldset>
    <fieldset disabled={busy} className="flex flex-wrap gap-2"><legend>创建独立实例（创建后配置冻结；勾选上方标的）</legend>
      <select aria-label="策略版本" className={box} value={version} onChange={e=>{setVersion(e.target.value);setParameters(JSON.stringify(state?.templates.find(t=>t.id===e.target.value)?.parameters ?? {}))}}><option value="">选择策略版本</option>{state?.templates.map(t=><option key={t.id} value={t.id}>{t.kind} {t.id.slice(-10)}</option>)}</select>
      <label>参数 JSON <input className={box} value={parameters} onChange={e=>setParameters(e.target.value)}/></label>
      <label>本金 USD <input type="number" min="0.01" className={box} value={cash} onChange={e=>setCash(e.target.value)}/></label>
      <label>每单费用 USD <input type="number" min="0" className={box} value={fee} onChange={e=>setFee(e.target.value)}/></label>
      <label>滑点 bps <input type="number" min="0" max="9999" className={box} value={slippage} onChange={e=>setSlippage(e.target.value)}/></label>
      <label>单标的成本/初始本金上限 bps <input type="number" min="1" max="10000" className={box} value={cap} onChange={e=>setCap(e.target.value)}/></label>
      <button className={box} onClick={()=>{try {const config=runConfigSchema.parse({symbols:selected,strategyVersion:version,parameters:JSON.parse(parameters),initialCash:Math.round(Number(cash)*1e6),fee:Math.round(Number(fee)*1e6),slippageBps:Number(slippage),maxPositionBps:Number(cap)});void perform('paper:action',{type:'create',config})}catch(e){setError(String(e))}}}>创建</button>
    </fieldset>
    <section><h3>实例与对比</h3>{state?.runs.map(r=><div key={r.id} className="flex gap-2 py-1"><input aria-label={`比较 ${r.id}`} type="checkbox" checked={compared.includes(r.id)} onChange={e=>setCompared(e.target.checked?[...compared,r.id]:compared.filter(i=>i!==r.id))}/><button className={box} onClick={()=>{setId(r.id);setOffset(0)}}>{r.config.strategyVersion.split(':')[0]} · {r.id.slice(0,8)} · {r.status} · {r.config.symbols.join(', ')}</button></div>)}
      <button disabled={busy || compared.length<2} className={box} onClick={()=>{void invoke<typeof comparison>('paper:compare',compared).then(setComparison).catch(e=>setError(String(e)))}}>比较共同观察区间</button>
      {comparison===null && <p>暂无至少两个共同采样时间，不能比较。</p>}{comparison && <div><p>{time(comparison.from)} — {time(comparison.to)}（按共同起点净值归一，不使用绝对盈亏）</p>{comparison.returns.map(r=><p key={r.id}>{r.id.slice(0,8)}: {r.returnPct.toFixed(3)}% {r.incomplete?'数据不完整':''}</p>)}<PaperEquityChart label="共同区间收益率 %（长区间最多约 2000 个展示点）" series={comparison.returns}/><p>公司行动与中断请逐实例核对。</p></div>}
    </section>
    {run && <section className="space-y-2"><h3>{id} · {run.status}</h3><p>版本 {run.config.strategyVersion}；参数 {JSON.stringify(run.config.parameters)}</p><p>初始 {dollars(run.config.initialCash)} · 费用 {dollars(run.config.fee)}/单 · 滑点 {run.config.slippageBps} bps · 仓位上限 {run.config.maxPositionBps} bps</p>
      <fieldset disabled={busy} className="flex flex-wrap gap-2">{(['start','pause','liquidate','end','archive'] as const).map((a,i)=><button className={box} key={a} disabled={a==='archive'?run.status!=='ended':a==='liquidate'?run.status==='archived':['ended','archived'].includes(run.status)} onClick={()=>control(a)}>{['启动 / 恢复','暂停（保留仓位）','请求模拟清仓','结束（保留仓位）','归档'][i]}</button>)}<button className={box} onClick={()=>{setVersion(run.config.strategyVersion);setParameters(JSON.stringify(run.config.parameters));setCash(String(run.config.initialCash/1e6));setFee(String(run.config.fee/1e6));setSlippage(String(run.config.slippageBps));setCap(String(run.config.maxPositionBps));setSelected(run.config.symbols)}}>复制配置到创建表单</button></fieldset>
      <p>结束后不能恢复策略；运行、暂停或已结束实例可单独请求清仓，归档前请核对成交。清仓最多等待 60 秒，失败保留仓位。</p>
      <p>现金 {dollars(run.account.cash)} · 净值 {dollars(valuation?.equity)} · 估值 {valuation?.quality} · 已实现 {dollars(run.account.realizedPnl)} · 未实现 {dollars(valuation?.unrealized)} · 现金收益 {dollars(run.account.income)}</p>
      <table className="w-full text-left"><thead><tr><th>持仓</th><th>股数</th><th>成本</th><th>估值价 / 时间</th></tr></thead><tbody>{run.account.positions.map(p=><tr key={p.symbol}><td>{p.symbol}</td><td>{p.quantity}</td><td>{dollars(p.cost)}</td><td>{dollars(valuation?.prices[p.symbol]?.price)} / {valuation?.prices[p.symbol]?time(valuation.prices[p.symbol].at):'缺失'}</td></tr>)}</tbody></table>
      <h3>历史（每类 100 条/页；日期 UTC；绩效为运行开始至截止日）</h3><label>开始 <input type="date" className={box} value={from} onChange={e=>{setFrom(e.target.value);setOffset(0)}}/></label><label>截止 <input type="date" className={box} value={to} onChange={e=>{setTo(e.target.value);setOffset(0)}}/></label>
      <button className={box} disabled={!offset} onClick={()=>setOffset(Math.max(0,offset-100))}>上一页</button><span>第 {offset/100+1} 页</span><button className={box} disabled={!data || offset+100>=Math.max(...Object.values(data.counts))} onClick={()=>setOffset(offset+100)}>下一页</button>
      {data && <><PaperEquityChart label="当前分页的持久净值 USD" series={[{id:run.id,points:data.snapshots.filter(s=>s.equity!==null).map(s=>({at:s.at,value:s.equity!/1e6,fresh:s.quality==='fresh'}))}]}/><p>观察 {(data.observedMs/3600000).toFixed(2)} 小时 · 常规时段新鲜 bar 覆盖率 {data.coverage.pct?.toFixed(2) ?? '—'}%（{data.coverage.fresh}/{data.coverage.expected<0?'日历未覆盖':data.coverage.expected} 标的分钟，包含暂停时段）</p><p>成本后收益 {data.performance.returnPct?.toFixed(3) ?? '—'}% · 总盈亏 {dollars(data.performance.totalPnl)} · 分钟采样最大回撤 {data.performance.maxDrawdownPct?.toFixed(3) ?? '—'}% · 完整平仓样本 {data.performance.closedTrades} · {data.performance.incomplete?'数据不完整':'请结合覆盖率判断'} · 行情质量记录 {data.qualityCount}</p><p>公司行动：{data.reviewed?'用户已核对':'未核对'} <button className={box} onClick={()=>control('review')}>确认截至现在已核对公司行动</button></p>
      <details open><summary>净值采样（含价格时间和质量）</summary>{data.snapshots.map(s=><div key={s.at}>{time(s.at)} · {dollars(s.equity)} · {s.quality} · {Object.entries(s.prices).map(([k,v])=>`${k} ${dollars(v.price)} @ ${time(v.at)}`).join(' / ')}</div>)}</details>
      <details open><summary>成交 {data.counts.fills}</summary>{data.fills.map(f=><div key={f.id}>{time(f.marketTime)} {f.symbol} {f.side} {f.quantity} @ {dollars(f.price)} · 费用 {dollars(f.fee)}</div>)}</details>
      <details><summary>日 / 月收益（首末期或数据缺口标记不完整）</summary>{[...data.performance.days,...data.performance.months].map(p=><div key={p.period}>{p.period} {p.returnPct?.toFixed(3) ?? '—'}% {p.incomplete?'不完整':''}</div>)}</details>
      <details open><summary>信号、运行事件和中断 {data.counts.events}</summary>{data.events.map(e=><div key={e.eventId}>{time(e.occurredAt)} · {e.type} · {e.reason} · {JSON.stringify(e.summary)}</div>)}</details></>}
    </section>}
    <fieldset disabled={busy} className="flex flex-wrap gap-2"><legend>公司行动（按当前持仓调整所有未结束实例并暂停；结束/归档账本保留终止时结果；唯一 ID 防重复）</legend>
      <label>行动 ID <input className={box} value={actionId} onChange={e=>setActionId(e.target.value)}/></label><label>代码 <input className={box} value={actionSymbol} onChange={e=>setActionSymbol(e.target.value.toUpperCase())}/></label><label>生效时间 <input type="datetime-local" className={box} value={actionDate} onChange={e=>setActionDate(e.target.value)}/></label>
      <select className={box} aria-label="公司行动类型" value={actionType} onChange={e=>setActionType(e.target.value)}><option value="dividend">现金股息</option><option value="split">拆股 / 反向拆股</option></select>
      {actionType==='dividend'?<label>每股 USD <input className={box} type="number" value={amount} onChange={e=>setAmount(e.target.value)}/></label>:<><label>新股数 <input className={box} type="number" value={numerator} onChange={e=>setNumerator(e.target.value)}/></label><label>旧股数 <input className={box} type="number" value={denominator} onChange={e=>setDenominator(e.target.value)}/></label><label>碎股现金替代价 USD <input className={box} type="number" value={cashInLieu} onChange={e=>setCashInLieu(e.target.value)}/></label></>}
      <button className={box} onClick={()=>void perform('paper:action',{type:'corporate',action:{id:actionId,symbol:actionSymbol,occurredAt:Date.parse(actionDate),type:actionType,...(actionType==='dividend'?{perShare:Math.round(Number(amount)*1e6)}:{numerator:Number(numerator),denominator:Number(denominator),...(cashInLieu?{cashInLieuPrice:Math.round(Number(cashInLieu)*1e6)}:{})})}})}>暂停并记账</button>
    </fieldset>
    <fieldset disabled={busy} className="flex gap-2"><legend>导出与恢复（恢复后需重启；不会覆盖原账本）</legend>{['csv','json','sqlite'].map(format=><button key={format} className={box} onClick={()=>void perform('paper:export',{format})}>导出 {format.toUpperCase()}</button>)}<button className={box} onClick={()=>void perform('paper:restore')}>选择 SQLite / JSON 备份并准备恢复</button></fieldset>
  </div>
}
