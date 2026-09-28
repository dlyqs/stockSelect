# 项目开发入口

更新日期：2026-09-28。本文件描述当前已实现代码；实时模拟策略系统仍处于规划阶段，不应将规划功能视为已有能力。

## 当前项目概况

OpenTerminal 1.1.2 是 Electron 桌面行情终端，采用 React、TypeScript、Zustand、React Query 和 lightweight-charts。主进程负责外部网络、凭证、服务和本地存储；renderer 通过受限 IPC 调用服务，不直接访问供应商或持有密钥。当前没有代码策略运行器、模拟成交引擎或长期交易账本。

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
