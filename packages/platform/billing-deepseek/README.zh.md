# @deepseek-ai/dsh-billing-deepseek

[English](README.md) | 中文

跟踪 DeepSeek 开放平台账号的当前余额与 API 消费，并通过 `query_api_usage` 工具提供给 agent。

## 功能

DeepSeek 开放平台只有一个计费端点，[`GET /user/balance`](https://api-docs.deepseek.com/api/get-user-balance/)，返回当前各币种余额以及累计赠送与充值金额。本插件：

- 按可配置间隔轮询该端点，把快照写入本地追加式历史文件（JSONL），即使 agent 不在对话期间也会持续累积；
- 注册面向模型的工具 `query_api_usage(window?, refresh?)`，报告当前余额、平台累计消费（`赠送 + 充值 − 余额`），以及指定窗口（`today` / `week` / `month` / `all`）内的消费——消费由本地历史中的余额差值推导。

平台没有消费明细 API，且只返回剩余余额（其 `topped_up_balance` 是当前剩余充值余额），因此所有消费都由本地快照历史推导：对每个窗口，取窗口开始时刻或之前最近的一次快照作为基准，消费 = `基准余额 − 当前余额`。若跟踪记录晚于窗口开始，则回退到最早快照作基准，窗口显示"自跟踪起的消费"；只有历史完全为空时才返回 `consumed: null`。负值表示充值金额超过了消费。`platformLifetimeConsumption` 同样是本地跟踪的累计值（最早快照 − 当前），而非平台报告的数字。

## 配置

```yaml
plugins:
  'deepseek-ai/billing-deepseek':
    config:
      baseUrl: https://api.deepseek.com
      apiKeyEnv: DEEPSEEK_API_KEY
      pollEnabled: true
      pollIntervalMs: 300000
      currency: CNY
      historyPath: ~/.dsh/billing-history.jsonl
```

API 密钥优先通过凭据能力（`ctx.credentials`）解析，回退到启动环境（含 `.env`），引用名由 `apiKeyEnv` 配置。缺少密钥时工具会明确报错：`billing-deepseek: no API key; store <ref> through the credentials service, or export it in the launching environment`。

平台返回的金额均为十进制字符串，在传输边界做窄校验，仅在做消费运算时解析为数字；工具结果中的数值四舍五入到两位小数。

## 工具

`query_api_usage(window = 'today', refresh = false)`

- `refresh: true` 立即查询平台（并追加快照）；否则使用最近一次轮询的快照；历史为空时无论如何都会触发一次抓取。
- 返回 `{ fetchedAt, available, currency, currentTotal, grantedBalance, toppedUpBalance, platformLifetimeConsumption, windows: [{ key, since, consumed }], historySince, historyCount }`。

结果渲染为紧凑文本表格（`card: 'generic'`，`kind: 'other'`）。调用中绝不包含 API 密钥。

## 服务接缝与设置区

插件提供 `ctx.billing`（`BillingUsageService`，含 `usage()`）供宿主的 `billing.usage` RPC 使用（Web 界面卡片读取该接口），并通过 `installSettingsSection` 注册空的 `billing-deepseek` 设置命名空间——设置页只会为宿主服务的命名空间分发卡片，因此该注册正是让 Web 仪表盘卡片出现的原因（卡片只读，命名空间不携带任何字段）。

## 导出形态

函数/命名空间插件：导出 `name` / `inject` / `Config` / `apply`，无 default 导出。若误加 `export default`，Loader 的 `unwrapExports` 会折叠模块并丢掉 `inject`（见 [docs/postmortem/0001](../../../docs/postmortem/0001-acp-default-export-drops-inject.md)）。子路径导出：`./client`（余额客户端）、`./store`（历史与报告计算）、`./invariant`（说明性空伴随插件）。

## Model Experience

### 工具 schema

#### 模型看到什么

模型看到生成的 `query_api_usage` schema：`window` 为枚举（`today` / `week` / `month` / `all`，默认 `today`），`refresh` 为布尔（默认 `false`）。

#### Token 影响

工具可见的每次请求都有固定的 schema 成本。

#### KV Cache 影响

定义与可见性不变时前缀稳定。

### 工具调用历史与结果

#### 模型看到什么

每次 assistant 工具调用携带所请求的窗口与 refresh 标志。成功时返回文本报告；结构化值为规范的 `ConsumptionReport`。稳定失败信息包括 `billing-deepseek: no API key; …`、`billing-deepseek: unknown window …` 以及平台错误（`401` 密钥被拒、`402` 无可用余额、HTTP 状态、网络、响应格式错误）。快照数据是插件本地历史，不是会话事件。

#### Token 影响

报告体积小且结构固定，不随历史增长（只有 `historyCount` 会变化）。

#### KV Cache 影响

只追加；新可见内容跟在可复用请求前缀之后，不会使既有 KV-cache 条目失效。

## 已知限制与后续工作

- **平台无消费历史**——开放平台只暴露当前余额，因此窗口消费是本地余额差值的估算，不是官方按请求的计费明细；大量小额交易后，两位小数的余额近似可能与平台精确账本产生漂移。
- **充值表现为负消费**——窗口差值定义为 `基准 − 当前`，充值超过消费时为负；没有独立的充值信号。
- **窗口按本地时间计算**——`today` / `week` / `month` 边界跟随宿主机器的本地时区。
- **无会话级归因**——本插件跟踪整个账号，不区分哪个会话消费了多少；会话级 token 成本由 [`dsh-token-meter`](../../llm/token-meter/README.md) 负责。
