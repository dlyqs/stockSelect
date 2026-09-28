import TitleBar from '../components/TitleBar'
import ErrorBoundary from '../components/ErrorBoundary'
import { usePaper } from './hooks/usePaper'
import { pages, useNavigation, nyTime } from './state'
import InstrumentsPage from './pages/InstrumentsPage'
import ConnectionPage from './pages/ConnectionPage'
import CreatePage from './pages/CreatePage'
import ComparePage from './pages/ComparePage'
import DataPage from './pages/DataPage'
import BackupPage from './pages/BackupPage'
import OverviewPage from './pages/OverviewPage'
import DetailPage from './pages/DetailPage'
import { reasonSummary } from './presentation'
import './workbench.css'
const serviceText={initializing:'运行服务初始化中',ready:'运行服务已就绪',suspended:'系统暂停',halted:'运行服务已停止',unavailable:'账本服务不可用'}
export default function WorkbenchShell(): JSX.Element {
  const {page,navigate,runId,setTerminal}=useNavigation(), query=usePaper(), state=query.data
  const run=state?.runs.find(r=>r.id===runId)
  const nav = (key: keyof typeof pages): JSX.Element => <button key={key} aria-current={page===key||(key==='strategies'&&(page==='detail'||page==='create'))?'page':undefined} onClick={()=>navigate(key)}>{pages[key]}</button>
  return <div className="workbench"><TitleBar/><div className="wb-layout"><nav aria-label="工作台导航">{(['overview','strategies','instruments','compare','data'] as const).map(nav)}<div className="wb-secondary"><button onClick={()=>setTerminal(true)}>高级终端</button>{nav('settings')}{nav('help')}</div></nav><main><header><div><h1>{pages[page]}</h1><span className="wb-muted">模拟模式 · 独立策略账户</span></div>{page!=='create' && <button className="primary" onClick={()=>navigate('create')}>新建策略</button>}</header><ErrorBoundary key={page}>
    {query.isPending && <section className="wb-card" role="status">正在读取模拟账本…</section>}
    {query.isError && <section className="wb-card" role="alert"><h2>无法读取工作台状态</h2><p>{query.error.message}。不会将读取失败显示为空账户。</p><button onClick={()=>void query.refetch()}>重新读取</button><button onClick={()=>navigate('help')}>诊断帮助</button></section>}
    {state && <div className="wb-card wb-muted">{serviceText[state.service]} · {state.session==='open'?'交易时段':state.session==='closed'?'休市（正常状态）':'交易日历未知'} · {state.configured?'凭证已保存':'未配置凭证'}<p>采集记录：{state.market ? `${reasonSummary(state.market.reason)} · ${nyTime(state.market.at)}`:'无最近记录'} · 固定 IEX</p>{state.restorePending && <p className="wb-warning">恢复已提交，必须退出并重启后再管理实例。</p>}</div>}
    {page==='settings' && <><ConnectionPage state={state}/><BackupPage state={state}/></>}
    {page==='help' && <section className="wb-card"><h2>开始模拟观察</h2><p>1. 配置 Alpaca 并分别检查权限。2. 手选最多 10 个股票/ETF。3. 创建独立策略后再启动。</p><p>本工作台不执行实盘交易。服务在主进程运行，切换页面不会暂停策略。休市、未验证权限、陈旧价格与策略暂停含义不同。</p><p>账本不可用时请检查诊断日志与磁盘，勿删除原账本。可进入高级终端 SET 导出诊断。</p><p>从总览进入详情查看持仓、分页成交与完整观察期绩效；比较页仅比较共同观察区间。公司行动在数据与核对页处理，备份在设置页。</p></section>}
    {state && !query.isError && state.service!=='unavailable' && <>
      {page==='compare' && <ComparePage state={state}/>}
      {page==='data' && <DataPage state={state}/>}
      {page==='instruments' && <InstrumentsPage state={state}/>}
      {page==='create' && <CreatePage state={state}/>}
      {(page==='overview'||page==='strategies') && <OverviewPage state={state}/>}
      {page==='detail' && (run ? <DetailPage key={run.id} run={run} state={state}/> : <section className="wb-card">找不到该实例，请返回策略列表重新选择。</section>)}
    </>}
    {state?.service==='unavailable' && page!=='settings' && page!=='help' && <section className="wb-card" role="alert"><h2>账本服务不可用</h2><p>当前无法读取已有实例。请检查诊断日志与存储权限，再重启应用；不会创建空账本覆盖历史。</p><button onClick={()=>navigate('help')}>查看诊断帮助</button></section>}
  </ErrorBoundary></main></div></div>
}
