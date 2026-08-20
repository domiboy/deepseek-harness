# Agent Note: DeepSeek billing dashboard

Status: implemented

English | [中文](2026-08-20-billing-dashboard.zh.md)

## Problem

The DeepSeek open platform exposes only the balance endpoint; there is no per-call or per-conversation billing API, and until this change the web UI had no balance or consumption view at all. The only spend signal is the account's cumulative balance-derived consumption, which cannot be attributed per conversation.

## Decision

The `billing-deepseek` plugin owns the platform data: a configurable poller snapshots `/user/balance` into an append-only local history, the `query_api_usage` tool reports balance and window consumption derived from that history, and the plugin provides `ctx.billing` plus the empty `billing-deepseek` settings namespace that makes the settings tab dispatch its card. The host apiproxy serves `billing.usage`, with the wire type declared locally in the contract layer so the browser-safe `api/` graph stays free of host-package imports.

The web card (`dsh-client-ui-billing`) is a numbers-only dashboard in the plugin configuration section: account availability, current/granted/topped-up balance, platform lifetime consumption, today/week/month consumption from the tracked snapshots, and the snapshot count. It refreshes on a 30-second interval and keeps the last good value on failure.

Platform actual consumption is global (balance-derived, whole-account) and is shown by the billing card; theoretical per-call cost is the `token-cost` feature's separate projection ([2026-08-20-token-cost-display](2026-08-20-token-cost-display.md)).

## Alternatives considered

- **Write live report data into a settings namespace.** Settings update persists to the user document, so volatile balance data would pollute the settings file; a read-only RPC is the clean data path.
- **Have apiproxy read the history file directly.** Couples the gateway to the plugin's store; the service seam keeps ownership with the plugin.
- **Per-call actual cost from the platform.** Impossible: the platform exposes no per-request billing, only the balance-derived lifetime figure.

## Verification

Package tests cover the balance client (status mapping, narrow wire validation), the history store and window computation, the poller lifecycle, and a real Loader composition; the apiproxy route answers `ok: false` without the plugin and the report verbatim with it. A live web probe created a session and confirmed `billing.usage` serves the report end to end.

## Consequences

Deployments get a persistent balance/consumption dashboard without a browser reload dependency on chat activity. The card appears only when the host serves the namespace (plugin composed) and the browser registers the card, per the settings-card pairing. Theoretical and actual consumption stay deliberately separate: the platform figure is global and cannot be per-conversation, and the theoretical projection is usage times configured prices.
