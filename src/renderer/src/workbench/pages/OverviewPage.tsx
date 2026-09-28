import type { WorkbenchState } from '../../../../shared/paper/workbench'
import { nyTime, statusText, useNavigation, type Page } from '../state'
import { needsAttention, qualityText, runName, reasonSummary, selectStrategyRuns } from '../presentation'
import Icon from '../components/Icon'

export default function OverviewPage({ state }: { state: WorkbenchState }): JSX.Element {
  const { navigate, openStrategies } = useNavigation()
  const attention = selectStrategyRuns(state, 'attention')
  const active = selectStrategyRuns(state, 'active')
  const events = state.runs.flatMap(r => state.summaries[r.id]?.latestEvent ? [{ run: r, event: state.summaries[r.id].latestEvent! }] : []).sort((a, b) => b.event.at - a.event.at).slice(0, 10)
  const go = (page: Page): void => { if (page === 'strategies') openStrategies(); else navigate(page) }
  const permissionsReady = state.readiness.iex === 'OK' && state.readiness.assets === 'OK'
  const steps = [
    { title: '连接行情', detail: '保存凭证并检查权限', done: state.configured && permissionsReady, page: 'settings' },
    { title: '选择标的', detail: '添加股票或 ETF', done: state.instruments.length > 0, page: 'instruments' },
    { title: '前往策略', detail: '审阅后单独启动', done: state.runs.length > 0, page: 'strategies' },
  ] as const

  return <>
    <section className="wb-metrics" aria-label="工作台关键指标">
      <div className="wb-metric"><div className="wb-metric-label">运行 / 预热实例<Icon name="activity" /></div><div className="wb-metric-value">{active.length.toString().padStart(2, '0')}<span>个实例</span></div><div className="wb-metric-foot"><span className={`wb-dot ${active.length ? 'is-ready' : ''}`} />{active.length ? '包含运行、预热与数据不足状态' : '等待策略启动'}<span className="wb-metric-total">共 {state.runs.length} 个</span></div></div>
      <div className="wb-metric"><div className="wb-metric-label">需要查看<Icon name="alert" /></div><div className={`wb-metric-value ${attention.length ? 'wb-warning' : ''}`}>{attention.length.toString().padStart(2, '0')}<span>个实例</span></div><div className="wb-metric-foot">检查状态、数据与公司行动<button className="wb-inline-link" onClick={() => openStrategies('attention')}>查看<Icon name="arrow" /></button></div></div>
      <div className="wb-metric"><div className="wb-metric-label">标的池<Icon name="instruments" /></div><div className="wb-metric-value">{state.instruments.length.toString().padStart(2, '0')}<span>/ 10 个标的</span></div><div className="wb-metric-foot"><div className="wb-capacity" aria-label={`已选 ${state.instruments.length} 个，最多 10 个`}>{Array.from({ length: 10 }, (_, i) => <span key={i} className={i < state.instruments.length ? 'is-filled' : ''} />)}</div><button className="wb-inline-link" onClick={() => navigate('instruments')}>管理<Icon name="arrow" /></button></div></div>
    </section>

    {!state.configured && state.runs.length > 0 && <section className="wb-connect-banner"><span className="wb-icon-tile"><Icon name="connection" /></span><div><h2>连接模拟行情</h2><p className="wb-muted">历史仍可查看。启动策略前，请保存 Alpaca 凭证并检查权限。</p></div><button onClick={() => navigate('settings')}>配置行情<Icon name="arrow" /></button></section>}

    <div className="wb-dashboard-grid">
      <div className="wb-dashboard-main">
        {!state.runs.length ? <section className="wb-card wb-welcome">
          <div className="wb-welcome-art" aria-hidden="true"><div className="wb-orbit wb-orbit-outer" /><div className="wb-orbit wb-orbit-inner" /><div className="wb-orbit-core"><Icon name="strategies" /></div><span className="wb-orbit-point" /></div>
          <div className="wb-welcome-copy"><span className="wb-eyebrow">YOUR NEXT IDEA STARTS HERE</span><h2>把投资想法，<br />变成可观察的策略。</h2><p>从精选标的到独立账户，在模拟环境中<br className="wb-wide-break" />记录每一次决策，逐步建立自己的判断。</p><button className="primary" onClick={() => go(steps.find(s => !s.done)?.page ?? 'strategies')}>{!steps[0].done ? '连接行情，开始探索' : !steps[1].done ? '选择你的标的' : '前往策略管理'}<Icon name="arrow" /></button><span className="wb-welcome-note"><Icon name="shield" />仅模拟交易，创建后需单独启动</span></div>
          <ol className="wb-onboarding">{steps.map((step, i) => <li key={step.page} className={step.done ? 'is-complete' : ''}><button onClick={() => go(step.page)}><span className="wb-step-number">{step.done ? <Icon name="check" /> : `0${i + 1}`}</span><span>{step.title}<small>{step.detail}</small></span><Icon name="chevron" /></button></li>)}</ol>
        </section> : <section className="wb-card wb-overview-summary">
          <div className="wb-section-heading"><div><span className="wb-eyebrow">AT A GLANCE</span><h2>运行摘要</h2></div><button className="wb-inline-link" onClick={() => openStrategies()}>管理全部策略<Icon name="arrow" /></button></div>
          <div className="wb-summary-links">{([
            { filter: 'active', label: '运行 / 预热', detail: '包含数据不足状态', icon: 'activity' },
            { filter: 'created', label: '等待启动', detail: '创建后需单独启动', icon: 'strategies' },
            { filter: 'paused', label: '已暂停', detail: '保留账户与持仓', icon: 'clock' },
            { filter: 'history', label: '历史策略', detail: '已结束或已归档', icon: 'data' },
          ] as const).map(item => <button key={item.filter} onClick={() => openStrategies(item.filter)}><Icon name={item.icon} /><span>{item.label}<small>{item.detail}</small></span><strong>{selectStrategyRuns(state, item.filter).length}</strong><Icon name="chevron" /></button>)}</div>
          <div className="wb-section-heading wb-attention-heading"><div><h2>需要查看<span className="wb-count">{attention.length}</span></h2><p className="wb-muted">优先关注未归档账户的状态与数据质量</p></div>{attention.length > 0 && <button className="wb-inline-link" onClick={() => openStrategies('attention')}>查看全部<Icon name="arrow" /></button>}</div>
          {attention.length ? <div className="wb-attention-list">{attention.slice(0, 4).map(run => <button key={run.id} onClick={() => navigate('detail', run.id)}><span><span className="wb-attention-name">{runName(run)}</span><small>{statusText[run.status]} · {state.summaries[run.id]?.liquidating ? '清仓等待新价' : !state.summaries[run.id]?.reviewed ? '公司行动未核对' : state.valuations[run.id] ? qualityText[state.valuations[run.id].quality] : '尚无估值'}</small></span><Icon name="chevron" /></button>)}</div> : <p className="wb-muted">当前没有需要查看的未归档实例。可以前往策略页查看完整账户与历史。</p>}
        </section>}

        <section className="wb-card wb-universe"><div className="wb-section-heading"><div><span className="wb-eyebrow">YOUR UNIVERSE</span><h2>专注你的观察范围</h2></div><button className="wb-inline-link" onClick={() => navigate('instruments')}>管理标的<Icon name="arrow" /></button></div>{state.instruments.length ? <div className="wb-instrument-chips">{state.instruments.map(i => <span className="wb-instrument-chip" key={i.symbol}><span className="wb-symbol-icon">{i.symbol.slice(0, 1)}</span><span>{i.symbol}<small>{i.kind === 'etf' ? 'ETF' : '股票'}</small></span></span>)}</div> : <div className="wb-universe-empty"><span className="wb-icon-tile"><Icon name="instruments" /></span><div><h3>好的研究，从精选标的开始</h3><p className="wb-muted">手选最多 10 个股票或 ETF，供不同策略使用。</p></div><button onClick={() => navigate('instruments')}><Icon name="plus" />添加标的</button></div>}</section>
      </div>

      <aside className="wb-card wb-activity-panel" aria-label="待处理与最近活动"><div className="wb-section-heading"><div><span className="wb-eyebrow">ACTIVITY</span><h2>运行动态</h2></div><Icon name="activity" /></div>{state.halted && <p className="wb-error">账本或服务已停止，操作受限。请保留账本并检查诊断日志。</p>}{state.session === 'unknown' && <p className="wb-warning">日历范围未知，不能确认交易时段。请检查支持年份。</p>}{!events.length ? <div className="wb-empty wb-activity-empty"><span className="wb-empty-orbit"><Icon name="activity" /></span><h3>静候第一条动态</h3><p>策略启动后，运行与数据变化<br />将记录在这里。</p><span className="wb-empty-caption">暂无活动记录</span></div> : <div className="wb-timeline">{events.map(({ run, event }) => <div className="wb-activity" key={run.id}><span className={`wb-timeline-dot ${needsAttention(run, state) ? 'is-warning' : ''}`} /><div className="wb-activity-heading"><button className="wb-inline-link" onClick={() => navigate('detail', run.id)}>{runName(run)}</button><span className="wb-muted">{statusText[run.status]}</span></div><p>{reasonSummary(event.reason)}</p><time>{nyTime(event.at)}</time><details><summary>原因码</summary><p>{event.type} · {event.reason}</p></details></div>)}</div>}<button className="wb-activity-more" onClick={() => navigate('data')}>数据问题与公司行动核对<Icon name="arrow" /></button></aside>
    </div>
  </>
}
