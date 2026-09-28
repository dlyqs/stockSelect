import type { StrategyFilter } from './state'
import type { PaperRun } from '../../../shared/paper/types'
import type { WorkbenchState } from '../../../shared/paper/workbench'
import { templateInfo, type TemplateKind } from '../../../shared/paper/templates'
export const money=(n:number|null|undefined):string=>n==null?'尚无有效估值':(n/1e6).toLocaleString('en-US',{style:'currency',currency:'USD',maximumFractionDigits:4})
export const percent=(n:number|null|undefined):string=>n==null?'—':`${n.toFixed(3)}%`
export const runName=(r:PaperRun):string=>`${templateInfo[r.config.strategyVersion.split(':')[0] as TemplateKind]?.name??'历史模板'} · ${r.id.slice(0,8)}`
export const qualityText={fresh:'新鲜采样',stale:'陈旧价格',missing:'价格缺失'}
export type Control='start'|'pause'|'liquidate'|'end'|'archive'|'review'
export const controlText:Record<Control,string>={start:'启动 / 恢复',pause:'暂停（保留仓位）',liquidate:'请求清仓',end:'结束策略',archive:'归档',review:'确认公司行动已核对'}
export function allowedControls(run:PaperRun,state:WorkbenchState):Control[] {
  if(state.halted || state.restorePending || state.service!=='ready')return []
  const terminal=['ended','archived'].includes(run.status), liquidating=state.summaries[run.id]?.liquidating
  const actions:Control[]=['review']
  if(!terminal) {
    if(!liquidating && !['running','warming','data_insufficient'].includes(run.status))actions.push('start')
    actions.push('pause','end')
  }
  if(run.status==='ended' && !liquidating)actions.push('archive')
  if(!liquidating && !['archived','error'].includes(run.status) && state.session==='open' && run.account.positions.length)actions.push('liquidate')
  return actions
}
export function needsAttention(run:PaperRun,state:WorkbenchState):boolean {
  return !state.summaries[run.id]?.reviewed || ['error','data_insufficient'].includes(run.status) || state.valuations[run.id]?.quality!=='fresh' || !!state.summaries[run.id]?.liquidating || run.status==='paused'
}
export function matchesStrategyFilter(run: PaperRun, state: WorkbenchState, filter: StrategyFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'active') return ['running', 'warming', 'data_insufficient'].includes(run.status)
  if (filter === 'attention') return run.status !== 'archived' && needsAttention(run, state)
  if (filter === 'history') return ['ended', 'archived'].includes(run.status)
  return run.status === filter
}
export function selectStrategyRuns(state: WorkbenchState, filter: StrategyFilter, search = ''): PaperRun[] {
  const term = search.trim().toLocaleLowerCase()
  return state.runs.filter(run => matchesStrategyFilter(run, state, filter)
    && (!term || [runName(run), run.id, ...run.config.symbols].some(value => value.toLocaleLowerCase().includes(term))))
}
/** Resolve NY midnight using the zone itself; DST days may contain 23 or 25 hours. */
function midnight(date:string):number {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new Error('请选择有效日期')
  const target=Date.parse(date+'T00:00:00Z')
  if(!Number.isFinite(target)||new Date(target).toISOString().slice(0,10)!==date)throw new Error('日期无效')
  const fmt=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'})
  let value=target
  for(let i=0;i<3;i++) {const p=Object.fromEntries(fmt.formatToParts(value).map(x=>[x.type,x.value]));value+=target-Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute,+p.second)}
  return value
}
export function dateRange(from:string,to:string):{from:number;to:number} {
  const start=from?midnight(from):0
  const end=to?midnight(new Date(Date.parse(to+'T00:00:00Z')+86400000).toISOString().slice(0,10))-1:Number.MAX_SAFE_INTEGER
  if(to)midnight(to)
  if(start>end)throw new Error('开始日期不能晚于截止日期')
  return {from:start,to:end}
}
export function reasonSummary(reason:string):string {
  const labels:Record<string,string>={NO_KEY:'未配置凭证，请到设置连接行情',PERMISSION:'行情权限不足，运行可能暂停；请检查凭证与订阅',RATE_LIMIT:'请求被限流，采集受限；请稍后查看数据覆盖',NETWORK:'网络异常，行情可能中断；请检查网络后核对数据',FRESH:'已记录新鲜行情',WARMUP_ONLY:'仅预热数据，不用于补做历史成交',WARMUP_REQUIRED:'正在预热，尚未进入实时决策',WARMUP_COMPLETE:'预热完成',WARMUP_INSUFFICIENT:'预热数据不足，暂不生成交易；请检查数据覆盖',USER_PAUSE:'用户已暂停，持仓保留',USER_END:'策略已结束，持仓可能保留',POSITIONS_RETAINED:'策略已结束，剩余仓位保留',USER_ARCHIVE:'实例已归档，历史保留',CORPORATE_ACTION_REVIEW:'价格异常或公司行动待核对，策略暂停；请进入数据与核对',USER_LIQUIDATION:'已请求清仓，等待新鲜价格',LIQUIDATION_ONLY:'仅执行清仓，不恢复策略',LIQUIDATION_FINISHED_OR_EXPIRED:'清仓完成或等待到期；请核对成交与剩余持仓',SYSTEM_SUSPEND:'系统暂停，恢复后需重新预热',SHUTDOWN:'应用退出时已暂停',CALENDAR_UNCOVERED:'日历年份未覆盖，采集停止；请更新日历',USER_CONFIRMED_CORPORATE_ACTIONS:'用户已声明核对公司行动'}
  return labels[reason]??'已记录运行或数据变化；请进入实例活动查看原因及影响后决定是否恢复'
}
