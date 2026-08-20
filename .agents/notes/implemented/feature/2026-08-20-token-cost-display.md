# Agent Note: Per-call and per-conversation API cost display

Status: implemented

English | [中文](2026-08-20-token-cost-display.zh.md)

## Problem

Users want to see what each API call and each conversation costs, but the DeepSeek open platform exposes no per-request billing — only the balance-derived lifetime figure. The harness logs provider token usage per step and the model per request, but nothing turned that into money, and the web UI showed only token counts and wall times.

## Decision

The `token-cost` plugin folds a new `tokenCost` session projection from the durable log: every `assistant/message` usage record is attributed to the model of the latest preceding `request/header`, and the disjoint token buckets (uncached input, cache-hit input, cache-write, output) are multiplied by the model's configured per-million-token prices. The projection value is `{ currency, total, perTurn, perStep, pricedSteps, unpricedSteps }`.

Prices default to the DeepSeek open platform's official off-peak CNY rates for `deepseek-v4-flash`/`deepseek-chat` (input 1.5, output 4.5, cache-hit 0.05) and `deepseek-v4-pro`/`deepseek-reasoner` (input 4.5, output 13.5, cache-hit 0.15), overridable per deployment; peak hours bill at double and are not modeled per request. A model without a configured price counts its usage-carrying steps in `unpricedSteps` and contributes nothing — the UI then shows no cost rather than a misleading zero.

The web UI renders the projection in three places: each settled turn's footer shows that turn's cost, the conversation stats line shows the conversation total, and the session list rows show each conversation's total (the list already carries the per-session projection baseline). Platform actual consumption remains global and is shown by the billing dashboard card ([2026-08-20-billing-dashboard](2026-08-20-billing-dashboard.md)).

## Alternatives considered

- **Compute cost client-side.** The pricing table would have to ship to the browser and the model-per-step attribution would re-implement the log walk; a host projection keeps the computation durable and replayable.
- **Carry prices on the model catalog.** Widens the wire catalog contract for one consumer; the pricing lives with the cost projection's own config instead.
- **Model peak/off-peak pricing per request.** The official rates vary by Beijing peak hours; time-dependent billing is deferred — the defaults document the peak doubling instead.
- **Per-call actual cost from the platform.** Impossible: no per-request billing exists (same constraint as the billing dashboard).

## Verification

Package tests pin the cost arithmetic, the model-attribution fold (per turn and per step, unpriced models, calls before the first header), config overrides, registry drive, and Loader composition. Client tests cover the turn-footer cost, the stats-line total, the session-row chip, and the no-priced-steps suppression. A live web probe with a real DeepSeek call produced `total ¥0.02109`, exactly matching `13958 × 1.5/1M + 34 × 4.5/1M`.

## Consequences

Every settled turn, conversation, and session row now carries a theoretical cost figure computed from logged usage and configured prices. The figures are estimates — real billing may differ (peak surcharges, promotions) — and old sessions' projection caches refresh on their next activity, after which their rows gain the cost. The defaults must be re-verified against the official pricing page when prices change.
