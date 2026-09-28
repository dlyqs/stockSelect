import { pages, useNavigation, type Page } from '../state'
import Icon from '../components/Icon'

const steps: Array<{ title: string; description: string; page: Page; action: string }> = [
  { title: '连接行情', description: '在“设置与备份”输入 Alpaca API Key 和 Secret，保存后点击“只读检查 IEX 与资产权限”。两项检查通过后再添加标的；保存凭证不等于权限通过，也不代表当前价格实时。', page: 'settings', action: '前往设置' },
  { title: '选择股票或 ETF', description: '在“标的池”输入证券代码（如 AAPL 或 SPY），选择类型，点击“验证并添加”。最多 10 个标的；ETF 类型需自行核对。被非归档实例占用的标的不能移除。', page: 'instruments', action: '前往标的池' },
  { title: '创建独立策略', description: '进入“策略”，点击右上角“新建策略”。依次选择模板、标的与参数、本金与成本，最后审阅创建。跨页保留草稿；再次点击“新建策略”可继续，点击“放弃草稿”会清除草稿。', page: 'strategies', action: '前往策略管理' },
  { title: '启动与持续观察', description: '创建成功后自动进入详情，点击“启动 / 恢复”。策略先预热，再根据新鲜行情决策。从总览查看运行摘要和待关注事项；从策略列表搜索、筛选并进入详情查看持仓、成交与绩效。', page: 'overview', action: '查看总览' },
]
const destinations: Array<{ page: Page; purpose: string }> = [
  { page: 'overview', purpose: '运行数量、待关注事项、最近动态与开始引导。' },
  { page: 'strategies', purpose: '完整账户列表、搜索筛选、创建入口与策略详情。' },
  { page: 'instruments', purpose: '验证、添加与移除股票 / ETF。' },
  { page: 'compare', purpose: '选择 2–10 个实例，按共同观察区间比较收益。' },
  { page: 'data', purpose: '检查数据问题，人工录入及核对公司行动。' },
  { page: 'settings', purpose: '凭证、权限检查、账本导出和备份恢复。' },
]

export default function HelpPage(): JSX.Element {
  const { navigate, openStrategies } = useNavigation()
  const go = (page: Page): void => { if (page === 'strategies') openStrategies(); else navigate(page) }
  return <>
    <section className="wb-card"><div className="wb-section-heading"><div><span className="wb-eyebrow">QUICK START</span><h2>第一次使用，按这四步开始</h2></div><Icon name="help" /></div><p className="wb-muted">本工作台仅执行本机模拟交易，每个策略拥有独立账户。创建后不会自动启动。</p>
      <ol className="wb-guide-steps">{steps.map((step, index) => <li key={step.title}><span className="wb-step-number">{index + 1}</span><div><h3>{step.title}</h3><p>{step.description}</p><button className="wb-inline-link" onClick={() => go(step.page)}>{step.action}<Icon name="arrow" /></button></div></li>)}</ol>
    </section>
    <section className="wb-card"><h2>每个页面负责什么</h2><div className="wb-destination-grid">{destinations.map(item => <button key={item.page} onClick={() => go(item.page)}><span>{pages[item.page]}<small>{item.purpose}</small></span><Icon name="chevron" /></button>)}</div></section>
    <section className="wb-card"><h2>策略操作说明</h2><dl className="wb-guide-definitions">
      <div><dt>启动 / 恢复</dt><dd>先预热，再使用新鲜行情决策；不会补做过去或中断期间的交易。</dd></div>
      <div><dt>暂停（保留仓位）</dt><dd>停止策略决策，保留已有仓位。之后可以恢复。</dd></div>
      <div><dt>请求清仓</dt><dd>交易时段内等待新鲜价格卖出；最多等待 60 秒，可能部分成交或保留仓位。清仓不会恢复策略，完成后请核对持仓与成交。</dd></div>
      <div><dt>结束策略 / 归档</dt><dd>结束后不能恢复，持仓可能保留；符合条件时仍可请求清仓。归档保留历史，归档后不能清仓，请先核对持仓。</dd></div>
      <div><dt>复制为新实例</dt><dd>使用当前模板版本进入创建流程，重新审阅后创建独立账户。原实例配置、账户和历史保留。</dd></div>
    </dl></section>
    <section className="wb-card"><h2>日常查看与数据处理</h2><ul className="wb-guide-notes">
      <li>总览的摘要卡会跳转到对应筛选后的策略列表；需要查看统计未归档实例，不代表自动故障判定。进入详情后，点击“返回策略列表”会保留筛选与搜索。</li>
      <li>“休市”是正常状态。预热、数据不足、陈旧价格和暂停含义不同，请结合采样时间、数据质量和活动原因判断。</li>
      <li>详情的完整观察期绩效不受下方历史日期筛选影响；历史筛选使用纽约日期，包含截止日。不同起点收益不构成排名。</li>
      <li>比较页至少选择两个实例；没有有效共同观察区间时无法比较。公司行动需人工核对，确认标记不会自动补记账或修复行情。</li>
      <li>CSV 用于查看成交；JSON / SQLite 用于完整备份和恢复。恢复成功后须退出并重启，取消文件选择不算恢复成功。</li>
      <li>切换页面不会暂停策略；完全退出或电脑休眠会中断本机运行。账本不可用时请保留原文件，在高级终端 SET 查看或导出诊断。</li>
    </ul></section>
  </>
}
