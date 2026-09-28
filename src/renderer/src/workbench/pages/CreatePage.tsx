import { useRef, useState } from 'react'
import type { WorkbenchState } from '../../../../shared/paper/workbench'
import { runConfigSchema } from '../../../../shared/paper/schemas'
import { parameterSchemas, templateInfo, templateFields, type TemplateKind } from '../../../../shared/paper/templates'
import type { RunConfig } from '../../../../shared/paper/types'
import { decimalUnits, draftSchema, emptyDraft, readDraft, useNavigation, type Draft } from '../state'
import { usePaperAction } from '../hooks/usePaper'
import Confirm from '../components/Confirm'
import Icon from '../components/Icon'
export const DRAFT_KEY = 'paper-workbench-draft-v1'
export function configFromDraft(draft: Draft, state: Pick<WorkbenchState,'templates'|'instruments'>): RunConfig {
  const template = state.templates.find(t=>t.id===draft.template)
  if (!template || !(template.kind in templateInfo)) throw new Error('template:请选择当前可用模板；历史版本只能复制到当前版本')
  const parameters = Object.fromEntries(Object.entries(draft.parameters).map(([k,v])=>[k, v.trim() ? Number(v) : NaN]))
  const parsed = parameterSchemas[template.kind as TemplateKind].safeParse(parameters)
  if (!parsed.success) throw new Error(`${parsed.error.issues[0].path[0]}:${parsed.error.issues[0].message}`)
  const convert = (key: 'cash'|'fee'|'position', digits: number): number => { try { return decimalUnits(draft[key],digits) } catch(e) { throw new Error(`${key}:${(e as Error).message}`, { cause: e }) } }
  if (!draft.symbols.length || draft.symbols.some(s=>!state.instruments.some(i=>i.symbol===s))) throw new Error('symbols:请选择池中 1–10 个标的')
  const result = runConfigSchema.safeParse({ strategyVersion:template.id, symbols:draft.symbols, parameters:parsed.data, initialCash:convert('cash',6), fee:convert('fee',6), slippageBps:/^\d+$/.test(draft.slippage)?Number(draft.slippage):NaN, maxPositionBps:convert('position',2) })
  if (!result.success) { const issue=result.error.issues[0]; const names: Record<string,string>={initialCash:'cash',maxPositionBps:'position',slippageBps:'slippage'}; throw new Error(`${names[String(issue.path[0])] ?? issue.path[0]}:${issue.message}`) }
  return result.data
}
export default function CreatePage({ state }: { state: WorkbenchState }): JSX.Element {
  const [draft,setDraft] = useState<Draft>(()=>{try {return readDraft(localStorage.getItem(DRAFT_KEY))}catch{return readDraft(null)}})
  const [error,setError] = useState(''), [storageError,setStorageError] = useState(() => { try { const raw = localStorage.getItem(DRAFT_KEY); if (raw && !draftSchema.safeParse(JSON.parse(raw)).success) return '创建草稿格式无效，已恢复默认；已有账本和旧工作区不受影响。'; return '' } catch { return '无法读取创建草稿，已使用默认值。' } }), [discard,setDiscard] = useState(false)
  const submitting = useRef(false), action = usePaperAction()
  const selected=state.templates.find(t=>t.id===draft.template)
  const kind = selected?.kind as TemplateKind | undefined
  const info = kind && templateInfo[kind]
  function update(patch: Partial<Draft>): void { const next={...draft,...patch}; if (!('requestId' in patch) && Object.keys(patch).some(k=>k!=='step')) delete next.requestId; setDraft(next); setError(''); try { localStorage.setItem(DRAFT_KEY,JSON.stringify(next)); setStorageError('') } catch { setStorageError('无法保存草稿；离开本页可能丢失，请检查本地存储。') } }
  function choose(id: string, kind: TemplateKind): void { update({template:id,parameters:Object.fromEntries(templateInfo[kind].fields.map(k=>[k,String(templateFields[k].default)]))}) }
  function validate(): RunConfig | null {
    try { return configFromDraft(draft,state) } catch(e) { const message=(e as Error).message; setError(message); const field=message.split(':')[0]; const step=field==='template'?0:field==='symbols'||(info?.fields as readonly string[]|undefined)?.includes(field)?1:2; if (draft.step!==step) update({step}); setError(message); requestAnimationFrame(()=>document.getElementById(`create-${field}`)?.focus()); return null }
  }
  async function submit(): Promise<void> {
    if (submitting.current) return
    const config=validate(); if (!config) return
    submitting.current=true
    const requestId = draft.requestId ?? crypto.randomUUID()
    update({requestId})
    try { const result=await action.mutateAsync({type:'create',config,requestId}); if (!result?.id) throw new Error('创建响应缺少实例 ID，请在策略列表核对后再操作'); try { localStorage.removeItem(DRAFT_KEY) } catch { /* navigation still follows the committed result */ } useNavigation.getState().navigate('detail',result.id) } catch(e) { setError((e as Error).message) } finally {submitting.current=false}
  }
  const textField = (name:'cash'|'fee'|'slippage'|'position', label:string, hint:string): JSX.Element => <label>{label}<input id={`create-${name}`} inputMode="decimal" value={draft[name]} onChange={e=>update({[name]:e.target.value})} aria-invalid={error.startsWith(name+':')}/><span className="wb-muted">{hint}</span></label>
  return <><section className="wb-card wb-builder"><ol className="wb-builder-steps" aria-label="创建进度">{['选择模板','标的与参数','本金与成本','审阅并创建'].map((label, index)=><li key={label} aria-current={draft.step===index?'step':undefined} className={draft.step>index?'is-complete':''}><span className="wb-step-number">{draft.step>index?<Icon name="check"/>:index+1}</span><span>{label}</span></li>)}</ol>{storageError && <p role="alert" className="wb-warning">{storageError}</p>}{error && <p role="alert" className="wb-error">{error}</p>}
    {draft.step===0 && <div id="create-template" tabIndex={-1} className="wb-template-grid">{state.templates.map(t=>{const meta=templateInfo[t.kind as TemplateKind]; return <section className={`wb-card wb-template ${draft.template===t.id?'is-selected':''}`} key={t.id}><span className="wb-icon-tile"><Icon name={t.kind==='sma'?'activity':t.kind==='rsi'?'strategies':'compare'}/></span><span className="wb-eyebrow">{t.kind.toUpperCase()} STRATEGY</span><h2>{meta.name}</h2><p>{meta.description}</p><button aria-pressed={draft.template===t.id} className={draft.template===t.id?'primary':''} onClick={()=>choose(t.id,t.kind as TemplateKind)}>{draft.template===t.id?'已选择':'选择模板'}</button></section>})}</div>}
    {draft.step===1 && <><h2>标的与参数</h2><div id="create-symbols" tabIndex={-1} className="wb-row">{state.instruments.map(i=><label className="wb-check" key={i.symbol}><input type="checkbox" checked={draft.symbols.includes(i.symbol)} onChange={e=>update({symbols:e.target.checked?[...draft.symbols,i.symbol]:draft.symbols.filter(s=>s!==i.symbol)})}/>{i.symbol}</label>)}</div>{!state.instruments.length && <button onClick={()=>useNavigation.getState().navigate('instruments')}>先添加标的（保留草稿）</button>}<p className="wb-muted">{info?.description}</p><div className="wb-fields">{info?.fields.map(k=>{const f=templateFields[k];return <label key={k}>{f.label}（{f.unit}）<input id={`create-${k}`} type="number" min={f.min} max={f.max} step={f.step} value={draft.parameters[k]??''} aria-invalid={error.startsWith(k+':')} onChange={e=>update({parameters:{...draft.parameters,[k]:e.target.value}})}/><span className="wb-muted">范围 {f.min}–{f.max}；默认 {f.default}</span></label>})}</div></>}
    {draft.step===2 && <><h2>独立账户与成本</h2><div className="wb-fields">{textField('cash','初始本金（USD）','大于 0，精确到 0.000001 USD')}{textField('fee','每笔费用（USD）','非负，精确到 0.000001 USD')}{textField('slippage','滑点（bps）','整数 0–9999；1 bps = 0.01%')}{textField('position','单标的仓位上限（%）','0.01–100%，以初始本金的购入成本计')}</div></>}
    {draft.step===3 && <><h2>审阅冻结配置</h2><p>{info?.name} · {draft.symbols.join('、')}</p><p>独立本金 {draft.cash} USD · 每笔费用 {draft.fee} USD · 滑点 {draft.slippage} bps · 单标的上限 {draft.position}%</p><p>{info?.fields.map(k=>`${templateFields[k].label}：${draft.parameters[k]}`).join('；')}</p><p className="wb-warning">仅模拟交易。创建后不会启动；配置将冻结。以后调整配置需复制为新实例，原账户和历史保留。</p><details><summary>高级参数原值</summary><pre>{JSON.stringify({strategyVersion:draft.template,parameters:draft.parameters},null,2)}</pre></details></>}
    <div className="wb-row wb-builder-actions"><button disabled={action.isPending} onClick={()=>setDiscard(true)}>放弃草稿</button>{draft.step>0 && <button disabled={action.isPending} onClick={()=>update({step:draft.step-1})}>上一步</button>}{draft.step<3 ? <button className="primary" disabled={!selected} onClick={()=>{if(draft.step===2){if(validate())update({step:3})}else update({step:draft.step+1})}}>下一步</button> : <button className="primary" disabled={action.isPending || state.halted || state.restorePending} onClick={()=>void submit()}>{action.isPending?'正在创建…':'创建独立实例'}</button>}</div>
  </section>{discard && <Confirm title="放弃创建草稿？" onClose={()=>setDiscard(false)} onConfirm={()=>{update({...emptyDraft,symbols:[],parameters:{}});setDiscard(false);useNavigation.getState().navigate('strategies')}}><p>仅清除当前草稿，不影响已有账户。</p></Confirm>}</>
}
