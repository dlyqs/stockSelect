import TitleBar from '../components/TitleBar'
import ErrorBoundary from '../components/ErrorBoundary'
import { usePaper } from './hooks/usePaper'
import { pages, useNavigation, nyTime, type Page } from './state'
import InstrumentsPage from './pages/InstrumentsPage'
import ConnectionPage from './pages/ConnectionPage'
import CreatePage from './pages/CreatePage'
import ComparePage from './pages/ComparePage'
import DataPage from './pages/DataPage'
import BackupPage from './pages/BackupPage'
import OverviewPage from './pages/OverviewPage'
import StrategiesPage from './pages/StrategiesPage'
import HelpPage from './pages/HelpPage'
import DetailPage from './pages/DetailPage'
import Icon from './components/Icon'
import { reasonSummary } from './presentation'
import './workbench.css'

const serviceText = { initializing: '运行服务初始化中', ready: '运行服务已就绪', suspended: '系统暂停', halted: '运行服务已停止', unavailable: '账本服务不可用' }
const pageMeta: Record<Page, { label: string; description: string }> = {
  overview: { label: 'WORKSPACE OVERVIEW', description: '查看运行摘要、待关注事项与最近动态。' },
  strategies: { label: 'YOUR STRATEGIES', description: '搜索与筛选独立账户，创建策略或进入详情管理。' },
  instruments: { label: 'INSTRUMENT UNIVERSE', description: '精选股票与 ETF，构建你的策略观察范围。' },
  compare: { label: 'PERFORMANCE LAB', description: '在共同观察区间内，理解策略之间的差异。' },
  data: { label: 'DATA & RECONCILIATION', description: '核对行情质量与公司行动，让观察有据可依。' },
  settings: { label: 'WORKSPACE SETTINGS', description: '连接行情服务，妥善管理你的凭证与账本。' },
  help: { label: 'GETTING STARTED', description: '从连接行情到观察策略，开启你的模拟研究。' },
  create: { label: 'STRATEGY BUILDER', description: '从一个想法出发，创建独立的模拟策略账户。' },
  detail: { label: 'STRATEGY INSIGHTS', description: '查看账户、持仓与完整观察期内的运行表现。' },
}

export default function WorkbenchShell(): JSX.Element {
  const { page, navigate, runId, setTerminal, openStrategies } = useNavigation()
  const query = usePaper(), state = query.data
  const run = state?.runs.find(r => r.id === runId)
  const nav = (key: 'overview' | 'strategies' | 'instruments' | 'compare' | 'data' | 'settings' | 'help'): JSX.Element => {
    const selected = page === key || (key === 'strategies' && (page === 'detail' || page === 'create'))
    return <button key={key} className="wb-nav-item" title={pages[key]} aria-current={selected ? 'page' : undefined} onClick={() => key === 'strategies' ? openStrategies() : navigate(key)}>
      <Icon name={key} /><span>{pages[key]}</span>
      {key === 'strategies' && state && <span className="wb-nav-count">{state.runs.length}</span>}
    </button>
  }
  return <div className="workbench">
    <TitleBar />
    <div className="wb-layout">
      <nav className="wb-sidebar" aria-label="工作台导航">
        <div className="wb-brand"><span className="wb-brand-mark"><Icon name="terminal" /></span><div>OpenTerminal<span>策略研究工作台</span></div></div>
        <div className="wb-nav-label">工作空间</div>
        <div className="wb-nav-group">{(['overview', 'strategies', 'instruments', 'compare', 'data'] as const).map(nav)}</div>
        <div className="wb-secondary"><div className="wb-nav-label">偏好与支持</div>{nav('settings')}{nav('help')}</div>
        <div className="wb-sidebar-bottom">
          <div className="wb-mode-card"><Icon name="shield" /><div>模拟研究环境<span>独立账户 · 仅模拟交易</span></div></div>
          <button className="wb-terminal-link" title="高级终端" onClick={() => setTerminal(true)}><Icon name="terminal" /><span>高级终端</span><Icon name="arrow" /></button>
        </div>
      </nav>
      <div className="wb-main-layout">
        <div className="wb-topbar"><div className="wb-breadcrumb"><span>工作空间</span><Icon name="chevron" />{(page === 'detail' || page === 'create') && <><button className="wb-inline-link" onClick={() => navigate('strategies')}>策略</button><Icon name="chevron" /></>}<span>{pages[page]}</span></div><span className="wb-environment"><span className="wb-dot" />PAPER TRADING</span></div>
        <main id="wb-main" aria-label={pages[page]}>
          <div className="wb-content">
            <header className="wb-page-header"><div><span className="wb-eyebrow">{pageMeta[page].label}</span><h1>{page === 'overview' ? '工作台总览' : pages[page]}</h1><p className="wb-muted">{pageMeta[page].description}</p></div>{page === 'strategies' && <button className="primary" disabled={!state || query.isError || state.service === 'unavailable' || state.halted || state.restorePending} onClick={() => navigate('create')}><Icon name="plus" />新建策略</button>}{(page === 'detail' || page === 'create') && <button onClick={() => navigate('strategies')}><Icon name="arrow" className="wb-back-icon" />返回策略列表</button>}</header>
            {state && <section className="wb-service-strip" aria-label="服务状态">
              <div className="wb-service-items"><span><span className={`wb-dot ${query.isError ? 'is-warning' : state.service === 'ready' ? 'is-ready' : state.service === 'halted' || state.service === 'unavailable' ? 'is-error' : 'is-warning'}`} />{query.isError ? '状态更新失败 · 显示上次记录' : serviceText[state.service]}</span><span><Icon name="clock" />{state.session === 'open' ? '交易时段' : state.session === 'closed' ? '休市（正常状态）' : '交易日历未知'}</span><span><Icon name="connection" />{state.configured ? '凭证已保存' : '未配置凭证'}</span><span className="wb-feed-label">ALPACA / IEX</span></div>
              <p className="wb-service-record">采集记录：{state.market ? `${reasonSummary(state.market.reason)} · ${nyTime(state.market.at)}` : '无最近记录'} · 固定 IEX</p>
              {state.restorePending && <p className="wb-warning">恢复已提交，必须退出并重启后再管理实例。</p>}
            </section>}
            <ErrorBoundary key={page}><div className="wb-page-enter" key={page}>
              {query.isPending && <section className="wb-card wb-loading" role="status"><span className="wb-loading-ring" />正在读取模拟账本…</section>}
              {query.isError && <section className="wb-card" role="alert"><h2>无法读取工作台状态</h2><p>{query.error.message}。不会将读取失败显示为空账户。</p><div className="wb-row"><button onClick={() => void query.refetch()}>重新读取</button><button onClick={() => navigate('help')}>诊断帮助</button></div></section>}
              {page === 'settings' && <><ConnectionPage state={state} /><BackupPage state={state} /></>}
              {page === 'help' && <HelpPage />}
              {state && !query.isError && state.service !== 'unavailable' && <>
                {page === 'compare' && <ComparePage state={state} />}
                {page === 'data' && <DataPage state={state} />}
                {page === 'instruments' && <InstrumentsPage state={state} />}
                {page === 'create' && <CreatePage state={state} />}
                {page === 'overview' && <OverviewPage state={state} />}
                {page === 'strategies' && <StrategiesPage state={state} />}
                {page === 'detail' && (run ? <DetailPage key={run.id} run={run} state={state} /> : <section className="wb-card">找不到该实例，请返回策略列表重新选择。</section>)}
              </>}
              {state?.service === 'unavailable' && page !== 'settings' && page !== 'help' && <section className="wb-card" role="alert"><h2>账本服务不可用</h2><p>当前无法读取已有实例。请检查诊断日志与存储权限，再重启应用；不会创建空账本覆盖历史。</p><button onClick={() => navigate('help')}>查看诊断帮助</button></section>}
            </div></ErrorBoundary>
            <footer className="wb-footer"><span>OpenTerminal<span className="wb-footer-divider">/</span>为独立思考而建</span><span>模拟模式 · 独立策略账户</span></footer>
          </div>
        </main>
      </div>
    </div>
  </div>
}
