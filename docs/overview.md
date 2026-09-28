# 项目开发入口

更新日期：2026-09-28。本文件描述当前已实现代码；实时模拟策略的契约、账本、分钟采集和运行器（Phase 1–4）已实现；配置界面、绩效查询和最终真实链路验收仍待后续阶段。

## 当前项目概况

OpenTerminal 1.1.2 是 Electron 桌面行情终端，采用 React、TypeScript、Zustand、React Query 和 lightweight-charts。主进程负责外部网络、凭证、服务和本地存储；renderer 通过受限 IPC 调用服务，不直接访问供应商或持有密钥。已新增独立模拟成交、SQLite 账本、raw IEX 采集与策略 worker，并接入应用生命周期。用户界面尚未实现，当前服务入口仅供后续主进程管理接口使用。

## 文件组织与修改入口

| 位置 | 职责 |
| --- | --- |
| `src/main/index.ts` | 应用启动、窗口和托盘、电源及流生命周期 |
| `src/main/ipc.ts` | 服务组装、IPC 请求校验与处理；当前集中度较高，新增业务宜拆成服务模块 |
| `src/preload/index.ts`、`src/shared/channels.ts` | contextBridge 和允许调用的通道 |
| `src/shared/types.ts` | 跨进程数据契约 |
| `src/main/providers/` | 行情供应商、路由、缓存、限流与错误分类 |
| `src/main/stream/StreamManager.ts` | Finnhub WebSocket、订阅引用计数、批量推送、断线重连 |
| `src/main/candles.ts` | 图表历史 K 线的优先队列、供应商切换、内存及磁盘缓存 |
| `src/main/portfolios.ts` | 手工组合和当前持仓保存、JSON 导入导出 |
| `src/main/alerts.ts`、`alertLogic.ts` | 价格条件判定、有限长度提醒日志、系统通知 |
| `src/main/watchlists.ts` | 自选列表持久化 |
| `src/main/migrations.ts`、`migrationCore.ts` | electron-store 工厂、JSON 损坏备份与迁移 |
| `src/main/logger.ts` | 分类日志、文件轮转、密钥脱敏与诊断环形缓存 |
| `src/shared/functionRegistry.ts` | 终端功能、自动补全与帮助的共同注册表 |
| `src/shared/marketHours.ts` | 美国交易时段、时区、节假日；当前节假日表限定 2026 年 |
| `src/renderer/src/panels/` | 功能面板；组合 `PortPanel`、筛选 `EqsPanel`、图表 `ChartPanel` |
| `src/renderer/src/lib/live.ts` | renderer 内存行情缓存与组件订阅，依赖页面帧调度 |
| `src/renderer/src/lib/indicators/` | 指标计算及测试；后续服务端复用宜抽出纯函数，不能依赖 renderer 生命周期 |
| `src/renderer/src/state/workspace.ts` | 面板与工作区状态 |
| `src/main/exportService.ts` | 原生对话框和 CSV/JSON 导出 |

## 核心链路与当前限制

### 行情与图表

组件经 IPC 订阅 → `StreamManager` 合并上游订阅 → Finnhub 推送 → 批量 IPC → `live.ts` 更新组件。窗口不可见时存在暂停逻辑，提醒引擎有特殊后台订阅处理；未来策略不能依赖面板是否打开来决定运行。

历史 K 线经 `CandleService` 获取，Twelve Data 为主，Alpaca IEX 为美股备用。Alpaca 当前接口使用 `feed=iex`，历史 bars 使用拆股调整；不能不经口径设计就将调整后的历史价格混入实时现金成交。图表缓存与报价容错允许旧数据展示，不代表这些数据适合触发模拟成交。

### 筛选

`EqsPanel` → `screener:*` IPC → FMP。筛选按行业、交易所、市值、价格、成交量和股息；返回最多 100 个标的，部分本地细筛只处理前 50 个。当前没有 ETF 杠杆倍数/反向属性筛选模型。手选不超过 10 个标的的首版不需要重建全市场筛选器。

### 组合与收益

`PortPanel` → `portfolio:*` IPC → `PortfolioManager` → electron-store JSON。当前保存现金、数量、平均成本、币种和开仓日期，没有完整成交/资金流水。`PerfChart` 使用当前持仓和历史日线重建曲线，不能作为策略运行期间的持久净值事实。新模拟系统应有独立账本，不把已有手工持仓伪装成历史模拟成交。

### 提醒与社交内容

`AlertEngine` 订阅价格，调用纯判定函数，写入最近 200 条提醒记录并发送系统通知。`SOCL` 是读取 Reddit 内容，不是社交媒体消息发送适配器。拟议模拟系统首版不接任何通知发送链路；未来扩展应消费持久化策略事件，与账户记账解耦。

## 维护与验证约定

- 用户明确禁止为前端改动自行启动页面、Playwright 或相关技能；人工外观检查交用户执行。禁止使用 GitNexus，除非选定技能明确要求。
- 常规无界面检查为 `npm run typecheck`、`npm run lint`、`npm test`；按改动选择有意义的检查。只有文档改动不要求运行应用测试。
- 保持网络/密钥位于主进程、IPC 白名单和 zod 校验、renderer 隔离边界。
- 现有 logger 可复用；新增策略事件日志不应记录凭证、完整行情载荷或逐 tick 噪声。
- 涉及账户的持久化失败必须明确停止写入和报告，不应套用“损坏后新建空设置文件”语义继续交易。
- 每个实施阶段结束同步本文件，标明实际新增模块与链路；阶段进度只在对应计划主表维护。
- 当前 `.idea/` 是既有未跟踪内容，不属于本次文档或后续功能实施的默认范围。

## 模拟交易核心（Phase 1–2）

- `src/shared/paper/` 定义运行配置、状态、行情、意图、成交、事件及检查点。USD 使用安全整数微美元，中间计算 bigint，比例 half-up 舍入；拒绝溢出、非法数量和负现金。
- `src/main/paper/storage/` 提供 userData SQLite 工厂和单写入 repository；决策状态与成交账务各自原子提交，持久事件 cursor、暂停/恢复语义及一致性备份可供后续服务使用。故障停止写入，禁止清空旧账本重试。
- `accounting.ts`、`execution.ts`、`corporateActions.ts` 负责费用/滑点、先卖后买、现金和购入成本仓位上限、平均成本、股息/拆股/碎股现金替代。公司行动要求运行已暂停；调用方应暂停该标的涉及的全部运行。
- `npm run paper:rebuild:electron` 后执行 `npm run paper:probe:sqlite` 可无页面验证 Electron worker 的原生 SQLite。Node 测试前切回 `npm run paper:rebuild:node`。当前机器已完成两种运行时验证，完整测试 190 项通过。
- `npm run paper:probe:market` 只读检查已授权的环境变量/.env Alpaca 凭证，当前未提供，不代表真实行情已验证。打包的解包驱动加载已通过，完整应用打包/签名尚未验收。
- Phase 3–4 已补充行情持久接口、日历、调度、策略 worker 和恢复接线；真实行情及实际应用后台行为尚待 Phase 7 验收。阶段状态与具体证据只在 paper-trading-plan.md 维护。

## 分钟行情服务（Phase 3）

独立 marketSource/marketData 固定 raw IEX，共享最多 10 标的，串行请求、受控重试和配额。calendar 仅允许有明确覆盖的 2026 年；未知年份停止。SQLite v2 记录行情修订与质量/缺口；预热和补拉仅供指标，不重放交易。离线测试已通过，真实 IEX 待凭证。

## 策略运行链路（Phase 4）

- `src/strategies/` 提供有类型参数的 SMA、简单窗口 RSI 和突破模板；保存原始 TS 源码、哈希、构建及状态版本。旧运行不自动切换策略版本。
- `paper/service.ts` 串联共享预热、分钟数据、隔离 worker、原子决策与成交；每账户独立状态，缺数据跳过，异常价格跳变暂停核对。`strategyWorker.ts` 限时、限输出、独立故障处理。
- `runtime.ts` 通过 `ipc.ts` 服务组装复用凭证，并由 `index.ts` 接入电源和退出生命周期；调度不绑定页面。退出排空写入，重启/唤醒取消旧意图并预热，持久心跳帮助定位中断。存储错误停止调度，绝不重置账本。
- 现有提醒服务保持独立，新链路无任何通知发送。配置与控制 UI、历史/绩效查询留 Phase 5–6；实际后台/休眠操作、真实 IEX 和完整打包留 Phase 7。
- 本批新增 15 项测试；全套 205 项、typecheck、lint、build 均通过。生产构建策略体经独立 worker 探针验证。未启动页面，未提交推送。Phase 1–4 授权已完成，计划恢复 manual。
