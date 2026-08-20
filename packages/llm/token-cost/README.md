# @deepseek-ai/dsh-token-cost

English | [中文](README.zh.md)

Tracks the theoretical cost of every API call and of the whole conversation, and serves it to the web UI through the `tokenCost` session projection.

## What it does

The open platform exposes no per-call billing, so the harness estimates cost locally: the `tokenCost` projection folds the durable session log — every `assistant/message` usage record attributed to the model of the latest preceding `request/header` — multiplies the disjoint token buckets (uncached input, cache-hit input, cache-write, output) by the model's per-million-token prices, and sums per conversation, per turn, and per step (`{ currency, total, perTurn, perStep, pricedSteps, unpricedSteps }`).

The web client renders the totals from the projection: the conversation stats line shows the conversation's total theoretical cost, and each settled turn's footer shows that turn's cost. The platform's ACTUAL accumulated consumption (balance-derived, global) is shown separately by the billing plugin card in the plugin settings section — it cannot be attributed per conversation.

## Pricing

Prices default to the DeepSeek open platform's official **off-peak CNY rates** per million tokens ([model & pricing](https://api-docs.deepseek.com/zh-cn/quick_start/pricing)) for `deepseek-v4-flash`/`deepseek-chat` (input 1.5, output 4.5, cache-hit 0.05) and `deepseek-v4-pro`/`deepseek-reasoner` (input 4.5, output 13.5, cache-hit 0.15), with cache writes at 0. Peak hours (Beijing 09:00–12:00, 14:00–18:00) bill at double, and the platform may change prices — override per deployment:

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

A model without a configured price counts its usage-carrying steps in `unpricedSteps` and contributes no cost; the UI then shows no cost group.

## Export shape

A function/namespace plugin: `name` / `inject` / `Config` / `apply` and NO default. Subpath exports: `./types` / `./client` (the `tokenCost` projection-key declaration, projected to both compiler faces), `./cost` (pure cost arithmetic).

## Model Experience

The projection is not model-visible and appends no session events; the cost figures are presentation data over the existing logged usage and the pricing config.

## Known Limitations and Deferred Work

- **Theoretical, not actual** — cost is usage × configured prices; the platform's real billing (peak-hour surcharges, promotions, discounts) may differ. The platform's actual accumulated consumption is a global balance figure, not per-call or per-conversation.
- **Off-peak defaults** — the built-in prices are the official off-peak CNY rates at the time of writing and must be re-verified; peak hours bill at double and are not modeled per-request.
- **Model attribution is request-scoped** — each step is priced at the model of the latest preceding `request/header`; a step before the first header is unpriced.
