# Agent Note: 每次调用与每对话的 API 花费显示

Status: implemented

[English](2026-08-20-token-cost-display.md) | 中文

## Problem

用户想看到每次 API 调用和每个对话花了多少钱，但 DeepSeek 开放平台没有逐请求账单——只有余额推导的累计值。harness 已在日志里记录每步的 provider token 用量与每请求的模型，但没人把它们换算成金额，Web 界面只显示 token 数与耗时。

## Decision

`token-cost` 插件从持久化日志折叠出新的 `tokenCost` 会话投影：每条 `assistant/message` 用量记录归因到最近一次 `request/header` 的模型，互不相交的 token 桶（未命中输入、缓存命中输入、缓存写入、输出）乘以该模型配置的每百万 token 单价。投影值为 `{ currency, total, perTurn, perStep, pricedSteps, unpricedSteps }`。

价格默认使用 DeepSeek 开放平台官方空闲时段 CNY 单价：`deepseek-v4-flash`/`deepseek-chat`（输入 1.5、输出 4.5、缓存命中 0.05）与 `deepseek-v4-pro`/`deepseek-reasoner`（输入 4.5、输出 13.5、缓存命中 0.15），可按部署覆盖；高峰时段双倍计价、未按请求建模。未配置价格的模型，其带用量步骤计入 `unpricedSteps` 且不计花费——界面不显示而非显示误导性的 0。

Web 界面在三个位置渲染投影：每个已结束回合尾部显示该回合花费，对话统计行显示对话总花费，会话列表行显示每对话总花费（列表本就携带每会话投影基线）。平台实际消费仍为全局口径，由计费仪表盘卡片展示（[2026-08-20-billing-dashboard](2026-08-20-billing-dashboard.md)）。

## Alternatives considered

- **客户端算价。** 需要把价格表下发到浏览器、并在客户端重做按步模型归因；宿主投影让计算持久且可重放。
- **价格挂在模型目录上。** 为单一消费方扩大 wire 目录契约；价格放在成本投影自己的配置里更内聚。
- **按请求建模高峰/空闲分时计价。** 官方价格随北京高峰时段变化；按时间计费推迟——默认值文档注明高峰翻倍。
- **从平台取逐次实际花费。** 不可行：没有逐请求账单（与计费仪表盘同一约束）。

## Verification

包测试覆盖成本运算、模型归因折叠（按回合与步骤、无价格模型、首个 header 之前的调用）、配置覆盖、registry 驱动与 Loader 组合。客户端测试覆盖回合尾部花费、统计行总额、会话行徽标与"无计价步骤则不显示"。一次真实 DeepSeek 调用实测得到 `total ¥0.02109`，与 `13958 × 1.5/1M + 34 × 4.5/1M` 完全吻合。

## Consequences

每个已结束回合、每个对话、每个会话行都带上了由日志用量与配置单价计算的理论花费。这些是估算值——真实计费可能不同（高峰加价、促销）——旧会话的投影缓存会在下次活动后刷新，之后其行才出现花费。价格变动时需要按官方定价页重新核对默认值。
