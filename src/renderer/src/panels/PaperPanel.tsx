import { useNavigation } from '../workbench/state'
export default function PaperPanel():JSX.Element {
  const navigate=useNavigation(s=>s.navigate)
  return <div className="p-4 text-term-text"><h2>PAPER · 模拟策略工作台</h2><p>策略、持仓、成交和备份已集中到工作台。页面切换不影响主进程策略运行。</p><button className="mt-4 border border-term-border p-2" onClick={()=>navigate('strategies')}>打开策略工作台</button></div>
}
