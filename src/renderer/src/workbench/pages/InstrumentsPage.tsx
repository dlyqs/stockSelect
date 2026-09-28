import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { InstrumentHit } from '../../../../shared/paper/instruments'
import { invoke } from '../../lib/ipc'
import QuotePanel from '../../panels/QuotePanel'
import TerminalChart, { defaultChartSettings } from '../../components/chart/TerminalChart'
import type { WorkbenchState } from '../../../../shared/paper/workbench'
import { usePaperAction } from '../hooks/usePaper'
import { nyTime, useNavigation } from '../state'
import { runName } from '../presentation'
import Icon from '../components/Icon'

export default function InstrumentsPage({ state }: { state: WorkbenchState }): JSX.Element {
  const [symbol, setSymbol] = useState(''), [query, setQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [chart, setChart] = useState(() => defaultChartSettings('GP'))
  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(symbol.trim()), 250)
    return () => window.clearTimeout(timer)
  }, [symbol])
  const search = useQuery({
    queryKey: ['paper-instrument-search', query],
    queryFn: () => invoke<InstrumentHit[]>('paper:instruments:search', { query }),
    enabled: !!query && searchOpen, staleTime: 3600_000, retry: false
  })
  const [error, setError] = useState(''), [notice, setNotice] = useState('')
  const { navigate, openStrategies } = useNavigation()
  const action = usePaperAction(), pending = useRef(false)
  const disabled = action.isPending || state.halted || state.restorePending
  async function submit(payload: { type: 'add'; symbol: string; kind: 'stock' | 'etf' } | { type: 'remove'; symbol: string }): Promise<void> {
    if (pending.current) return
    pending.current = true
    setError(''); setNotice('')
    try {
      await action.mutateAsync(payload)
      if (payload.type === 'add') { setSymbol(''); setQuery(''); setSearchOpen(false) }
      setNotice(payload.type === 'add' ? `${payload.symbol} 已添加到标的池，可在策略中选择。` : `${payload.symbol} 已从标的池移除。`)
    } catch (e) { setError(e instanceof Error ? e.message : '操作失败') } finally { pending.current = false }
  }
  if (selected) return <>
    <section className="wb-card">
      <div className="wb-section-heading"><div><h2>{selected} · 行情</h2><p className="wb-muted">报价来自 Alpaca IEX，自动刷新；休市时显示最近行情。</p></div><button onClick={() => setSelected(null)}><Icon name="arrow" className="wb-back-icon" />返回标的池首页</button></div>
      <QuotePanel key={selected} ticker={selected} paper />
    </section>
    <section className="wb-card"><h2>价格走势</h2><div className="wb-instrument-chart"><TerminalChart key={selected} symbol={selected} settings={chart} onSettings={setChart} variant="GP" isActivePanel /></div></section>
  </>
  return <>
    <section className="wb-card">
      <h2>手选标的 · {state.instruments.length} / 10</h2>
      <p className="wb-muted">输入证券代码或名称，点击匹配结果即可添加。股票 / ETF 类型由 Nasdaq 证券目录识别，添加时由 Alpaca 验证可交易性。</p>
      {!state.configured && <div className="wb-form-notice"><span>添加前需配置 Alpaca 凭证。</span><button className="wb-inline-link" onClick={() => navigate('settings')}>前往设置<Icon name="arrow" /></button></div>}
      <div className="wb-instrument-search" onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) setSearchOpen(false) }}>
        <label htmlFor="instrument-search">证券代码或名称</label>
        <input id="instrument-search" value={symbol} onChange={e => { setSymbol(e.target.value); setSearchOpen(true); setError(''); setNotice('') }} onFocus={() => setSearchOpen(true)} onKeyDown={e => { if (e.key === 'Escape') setSearchOpen(false) }} placeholder="例如 AAPL / SPY" autoComplete="off" maxLength={80} disabled={disabled} aria-expanded={searchOpen && !!symbol.trim()} aria-controls="instrument-results" />
        {searchOpen && !!symbol.trim() && <div id="instrument-results" className="wb-instrument-results" aria-label="匹配的证券">
          {query !== symbol.trim() || search.isFetching ? <p role="status">正在搜索…</p> : search.isError ? <p role="alert">搜索失败：{search.error.message} <button onClick={() => void search.refetch()}>重试</button></p> : search.data?.length ? search.data.map(hit => {
            const added = state.instruments.some(i => i.symbol === hit.symbol)
            return <button key={hit.symbol} disabled={added || disabled || !state.configured || state.instruments.length >= 10} onClick={() => void submit({ type: 'add', symbol: hit.symbol, kind: hit.kind })}>
              <strong>{hit.symbol}</strong><span className="wb-instrument-name">{hit.name}</span><span className="wb-instrument-kind">{hit.kind === 'etf' ? 'ETF' : '股票'}</span>{added && <span>已添加</span>}
            </button>
          }) : <p role="status">未找到匹配的证券，请检查代码或名称。</p>}
        </div>}
      </div>
      {state.instruments.length >= 10 && <p className="wb-muted">标的池已满。移除未被实例占用的标的后，可以继续添加。</p>}
      {error && <p role="alert" className="wb-error">{error}。请检查代码、凭证与权限后重试。</p>}
      {notice && <p role="status" className="wb-positive">{notice}</p>}
    </section>
    <section className="wb-card">
      <div className="wb-section-heading"><div><h2>已选标的</h2><p className="wb-muted">点击标的查看行情；供各策略共享选择，添加不会自动启动策略</p></div><button className="wb-inline-link" onClick={() => openStrategies()}>前往策略管理<Icon name="arrow" /></button></div>
      <div className="wb-table"><table><thead><tr><th>标的</th><th>类型</th><th>使用情况</th><th>操作</th></tr></thead><tbody>{state.instruments.map(i => {
        const owners = state.runs.filter(r => r.status !== 'archived' && r.config.symbols.includes(i.symbol))
        return <tr key={i.symbol}><td><button className="wb-inline-link" onClick={() => { setSelected(i.symbol); setSearchOpen(false); setChart(defaultChartSettings('GP')) }} aria-label={`查看 ${i.symbol} 行情`}>{i.symbol}<Icon name="arrow" /></button></td><td>{i.kind === 'etf' ? 'ETF' : '股票'}</td><td>{owners.length ? <div className="wb-row">{owners.map(r => <button key={r.id} className="wb-inline-link" onClick={() => navigate('detail', r.id)}>{runName(r)}</button>)}</div> : '未被使用'}</td><td><button disabled={!!owners.length || disabled} title={owners.length ? '使用中的实例（含已结束未归档）占用此标的' : '移除标的'} onClick={() => void submit({ type: 'remove', symbol: i.symbol })}>移除</button></td></tr>
      })}</tbody></table></div>
      {!state.instruments.length && <p>尚未选择标的。在上方搜索并点击结果添加股票或 ETF。</p>}
      <p className="wb-muted">最近采集记录：{state.market ? `${state.market.symbol} · ${state.market.reason} · ${nyTime(state.market.marketTime)}` : '无最近记录'}。这不是每个标的的实时价格。</p>
    </section>
  </>
}
