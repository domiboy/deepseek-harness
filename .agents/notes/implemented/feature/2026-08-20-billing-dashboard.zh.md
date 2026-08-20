# Agent Note: DeepSeek 计费仪表盘

Status: implemented

[English](2026-08-20-billing-dashboard.md) | 中文

## Problem

DeepSeek 开放平台只暴露余额接口，没有逐次或按对话的账单 API；此前 Web 界面也完全没有余额或消费视图。唯一的消费信号是账号的余额推导累计值，无法按对话归因。

## Decision

`billing-deepseek` 插件拥有平台数据：可配置轮询器把 `/user/balance` 快照写入追加式本地历史，`query_api_usage` 工具报告由该历史推导的余额与窗口消费，插件提供 `ctx.billing` 服务以及使设置页分发其卡片的空 `billing-deepseek` 设置命名空间。宿主 apiproxy 提供 `billing.usage` RPC，wire 类型在契约层本地声明，使浏览器安全的 `api/` 类型图保持无宿主包导入。

Web 卡片（`dsh-client-ui-billing`）是插件设置区的纯数字仪表盘：账户可用状态、当前/赠送/充值余额、平台累计消费、由快照历史推导的今日/本周/本月消费，以及快照数。每 30 秒刷新，失败保留上次成功值。

平台实际消费是全局口径（余额推导、全账号），由计费卡片展示；逐次理论花费由 `token-cost` 功能的独立投影负责（[2026-08-20-token-cost-display](2026-08-20-token-cost-display.md)）。

## Alternatives considered

- **把实时报告写进设置命名空间。** 设置写入会持久化到用户文档，波动中的余额数据会污染设置文件；只读 RPC 才是干净的数据通路。
- **让 apiproxy 直接读历史文件。** 让网关耦合插件的存储；服务接缝把所有权留在插件侧。
- **从平台取逐次实际花费。** 不可行：平台只有余额推导的累计值，没有逐请求账单。

## Verification

包测试覆盖余额客户端（状态映射、窄 wire 校验）、历史存储与窗口计算、轮询器生命周期，以及真实 Loader 组合；apiproxy 路由在未装配插件时返回 `ok: false`、装配时原样返回报告。一次真实 web 探测创建会话并确认 `billing.usage` 端到端提供服务。

## Consequences

部署无需依赖对话活动即可获得常驻的余额/消费仪表盘。卡片只在宿主服务命名空间（插件已装配）且浏览器注册了卡片时出现（设置卡片配对规则）。理论价与实际消费刻意分离：平台数值是全局口径、无法按对话归因；理论投影是"用量 × 配置单价"。
