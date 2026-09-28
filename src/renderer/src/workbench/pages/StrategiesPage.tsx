import type { WorkbenchState } from '../../../../shared/paper/workbench'
import { nyTime, statusText, strategyFilters, useNavigation, type StrategyFilter } from '../state'
import { money, percent, qualityText, runName, selectStrategyRuns } from '../presentation'
import Icon from '../components/Icon'

export default function StrategiesPage({ state }: { state: WorkbenchState }): JSX.Element {
  const { navigate, openStrategies, strategyFilter, strategySearch, setStrategyFilter, setStrategySearch } = useNavigation()
  const runs = selectStrategyRuns(state, strategyFilter, strategySearch)
  const active = selectStrategyRuns(state, 'active')
  if (!state.runs.length) return <section className="wb-card wb-empty wb-strategies-empty">
    <span className="wb-empty-orbit"><Icon name="strategies" /></span><h2>你的第一个策略，从这里开始</h2>
    <p>点击右上角“新建策略”，选择模板、标的和资金参数。<br />创建成功后，在详情页单独启动。</p>
    {!state.instruments.length && <div className="wb-setup-hint"><p>还没有标的？先添加股票或 ETF，再回来创建。</p><button onClick={() => navigate('instruments')}>前往标的池<Icon name="arrow" /></button></div>}
  </section>
  return <section className="wb-card wb-strategy-card">
          <div className="wb-section-heading"><div><h2>策略账户<span className="wb-count">{runs.length}</span></h2><p className="wb-muted">筛选账户，进入详情管理运行与持仓</p></div><div className="wb-list-controls"><label className="wb-search"><span className="wb-sr-only">搜索策略名称、实例 ID 或标的</span><input type="search" value={strategySearch} onChange={e => setStrategySearch(e.target.value)} placeholder="搜索策略、ID 或标的" /></label><label className="wb-filter"><span className="wb-sr-only">账户筛选</span><select value={strategyFilter} onChange={e => setStrategyFilter(e.target.value as StrategyFilter)}>{Object.entries(strategyFilters).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label></div></div>
          {!active.length && <p className="wb-table-notice">当前没有运行或预热中的实例。可查看历史，或进入详情启动可恢复的实例。</p>}
          <div className="wb-table"><table><thead><tr><th>实例 / 标的</th><th>账户状态</th><th className="wb-number">净值 USD</th><th className="wb-number">成本后收益</th><th>最近采样 / 观察跨度</th><th>数据质量</th></tr></thead><tbody>{runs.map(r => {
            const v = state.valuations[r.id], s = state.summaries[r.id]
            const returnPct = v?.equity == null ? null : (v.equity / r.config.initialCash - 1) * 100
            return <tr key={r.id}><td><button className="wb-strategy-link" onClick={() => navigate('detail', r.id)}>{runName(r)}<Icon name="chevron" /></button><p className="wb-symbol-line">{r.config.symbols.join(' · ')}</p></td><td><span className={`wb-status-badge status-${r.status}`}><span className="wb-dot" />{statusText[r.status]}</span>{s?.liquidating && <p className="wb-warning">清仓等待新价</p>}</td><td className="wb-number">{money(v?.equity)}</td><td className={`wb-number ${returnPct != null && returnPct > 0 ? 'wb-positive' : returnPct != null && returnPct < 0 ? 'wb-negative' : ''}`}>{percent(returnPct)}</td><td><span className="wb-timestamp">{nyTime(s?.latestSampleAt)}</span><p className="wb-muted">{s?.createdAt != null && s.latestSampleAt != null ? `${(Math.max(0, s.latestSampleAt - s.createdAt) / 3600000).toFixed(2)} 小时` : '暂无观察'}</p></td><td>{v ? qualityText[v.quality] : '尚无估值'}{!s?.reviewed && <p className="wb-warning">公司行动未核对</p>}</td></tr>
          })}</tbody></table></div>
          {!runs.length && <div className="wb-empty"><Icon name="strategies" /><h3>没有符合条件的实例</h3><p>试试其他账户状态，或查看全部策略。</p><button onClick={() => openStrategies()}>清除筛选与搜索</button></div>}
          <p className="wb-table-footnote">每个实例为独立账户；不同起点收益不构成排名。观察时长、完整覆盖率和公司行动核对见详情。</p>
        </section>
}
