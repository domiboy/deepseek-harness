# @deepseek-ai/dsh-token-cost

[English](README.md) | 中文

跟踪每次 API 调用的理论花费与整个对话的理论总花费，并通过 `tokenCost` 会话投影提供给 Web 界面。

## 功能

开放平台没有逐次调用的账单接口，因此由本机估算：`tokenCost` 投影折叠持久化会话日志——把每条 `assistant/message` 的用量记录归因到最近一次 `request/header` 的模型——将互不相交的 token 桶（未命中输入、缓存命中输入、缓存写入、输出）乘以该模型的每百万 token 单价，并按对话、回合、步骤求和（`{ currency, total, perTurn, perStep, pricedSteps, unpricedSteps }`）。

Web 客户端从投影渲染：对话统计行显示对话理论总花费，每个已结束回合的尾部显示该回合花费。平台**实际累计消费**（余额推导、全账号口径）由插件设置区的计费卡片单独展示——平台数据无法按对话归因。

## 定价

价格默认使用 DeepSeek 开放平台官方**空闲时段 CNY 单价**（每百万 tokens，[模型 & 价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing)）：`deepseek-v4-flash`/`deepseek-chat`（输入 1.5、输出 4.5、缓存命中 0.05），`deepseek-v4-pro`/`deepseek-reasoner`（输入 4.5、输出 13.5、缓存命中 0.15），缓存写入为 0。高峰时段（北京时间 9:00–12:00、14:00–18:00）按两倍计费，且平台可能调价——可按部署覆盖：

```yaml
plugins:
  'deepseek-ai/token-cost':
    config:
      pricing:
        deepseek-v4-flash:
          currency: CNY
          inputPerMillion: 1.5
          outputPerMillion: 4.5
          cacheReadPerMillion: 0.05
          cacheWritePerMillion: 0
```

未配置价格的模型，其带用量的步骤计入 `unpricedSteps` 且不计花费；界面相应不显示花费分组。

## 导出形态

函数/命名空间插件：导出 `name` / `inject` / `Config` / `apply`，无 default。子路径导出：`./types` / `./client`（`tokenCost` 投影键声明，向两个编译器面投影）、`./cost`（纯成本运算）。

## Model Experience

该投影不进入模型视野，也不追加会话事件；花费数字是基于既有日志用量与定价配置的展示数据。

## 已知限制与后续工作

- **理论值而非实际值**——花费 = 用量 × 配置单价；平台真实计费（高峰加价、促销、折扣）可能不同。平台实际累计消费是全局余额口径，无法逐次或按对话归因。
- **空闲时段默认价**——内置价格为写作时的官方空闲时段 CNY 单价，需定期核对；高峰时段双倍计价未按请求建模。
- **模型归因按请求**——每个步骤按最近一次 `request/header` 的模型计价；首个 header 之前的步骤不计价。
