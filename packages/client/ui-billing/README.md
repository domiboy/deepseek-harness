# @deepseek-ai/dsh-client-ui-billing

English | [中文](README.zh.md)

A numbers-only DeepSeek open-platform balance dashboard card inside the web plugin configuration section.

## What it does

Registers one card into the `settings.plugin.item` slot, keyed by the `billing-deepseek` settings namespace the host plugin serves — the plugin-configuration tab shows the card exactly when the host composes `@deepseek-ai/dsh-billing-deepseek`. The card reads the `billing.usage` RPC (via the connection api) and renders the balance readout: account availability, current/granted/topped-up balance, platform lifetime consumption, today/week/month consumption from the locally tracked snapshots, and the snapshot count. It refreshes on a 30-second interval (configurable only by editing `REFRESH_INTERVAL_MS`) and exposes a manual refresh button; a failed refresh keeps the last successful value and shows the reason.

The card is read-only: it renders data from the host API and edits no settings. When the host does not compose the billing plugin, the RPC answers `ok: false` with a reason and the card shows it.

## Rendering

- Loading → 「加载中…」; failure → 「获取失败：<reason>」; not composed → the host reason; empty history → 「暂无计费数据」.
- Balance rows use the `¥` symbol and two decimals; an unattributable window (no snapshot before the window start) renders 「—」.
- The footer shows the last refresh time and the refresh button (disabled while a refresh is in flight).

## Export shape

A function/namespace plugin: `inject` / `apply` and NO default; the browser half ships through `exports["./client"]` per the `dsh.client` declaration. Node half is an empty `apply` so the Loader row resolves.

## Model Experience

The card is a user-facing settings surface; it is never model-visible and emits no session events, so there is no tool schema, no token effect, and no KV-cache effect to document.

## Known Limitations and Deferred Work

- **Numbers only** — no charts; the time series is visible only through the tool's text report.
- **Fixed 30s cadence** — the refresh interval is a module constant, not a per-deployment config; changing it requires editing `REFRESH_INTERVAL_MS`.
- **Data freshness is host-side** — the card shows whatever history the host plugin has polled or fetched on demand; a fresh `refresh` does not itself hit the platform when the host history is empty (it surfaces the host report as-is).
- **Single currency display** — the report shows the host plugin's configured or first currency.
