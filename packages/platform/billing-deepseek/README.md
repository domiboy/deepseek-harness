# @deepseek-ai/dsh-billing-deepseek

English | [中文](README.zh.md)

Tracks the current balance and API consumption of a DeepSeek open-platform account, and exposes them to the agent as the `query_api_usage` tool.

## What it does

The DeepSeek open platform exposes one billing endpoint, [`GET /user/balance`](https://api-docs.deepseek.com/api/get-user-balance/), which returns the current per-currency balance plus the cumulative granted and topped-up amounts. This plugin:

- polls that endpoint into an append-only local history (JSONL) at a configurable interval, so snapshots accumulate even between agent turns;
- registers the model-facing tool `query_api_usage(window?, refresh?)` that reports the current balance, the platform lifetime consumption (`granted + topped-up − total`), and the consumption attributed to the requested window (`today` / `week` / `month` / `all`), derived from balance deltas over the stored history.

The platform has no consumption-history API, so all window consumption is derived locally: for each window, the latest snapshot at or before the window start is the baseline, and consumption is `baseline balance − current balance`. A window that predates all tracking reports `consumed: null` (it cannot be attributed). A negative value means a top-up outpaced spending.

## Configuration

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

The API key resolves through the credentials seam first (`ctx.credentials`), falling back to the launching environment (including `.env`). The reference name is configurable via `apiKeyEnv`. Without a key, the tool fails loud with `billing-deepseek: no API key; store <ref> through the credentials service, or export it in the launching environment`.

All amounts arrive as decimal strings from the platform, are narrow-validated at the wire boundary, and are parsed to numbers only for consumption arithmetic; values in tool results are rounded to two decimals.

## Tool

`query_api_usage(window = 'today', refresh = false)`

- `refresh: true` queries the platform immediately (and appends the snapshot); otherwise the latest polled snapshot is used, and an empty history triggers a fetch anyway.
- Returns `{ fetchedAt, available, currency, currentTotal, grantedBalance, toppedUpBalance, platformLifetimeConsumption, windows: [{ key, since, consumed }], historySince, historyCount }`.

The result renders as a compact text table (`card: 'generic'`, `kind: 'other'`). The call never includes the API key.

## Service seam and settings section

The plugin provides `ctx.billing` (a `BillingUsageService` with `usage()`) for the host `billing.usage` RPC that the web UI card reads, and registers the empty `billing-deepseek` settings namespace through `installSettingsSection` — the settings tab dispatches the plugin card only for namespaces the Host serves, so this registration is what makes the web dashboard card appear (the card is read-only; the namespace carries no fields).

## Export shape

A function/namespace plugin: it exports `name` / `inject` / `Config` / `apply` and NO default. A stray `export default` would collapse the module via the Loader's `unwrapExports` and drop `inject` (see [docs/postmortem/0001](../../../docs/postmortem/0001-acp-default-export-drops-inject.md)). Subpath exports: `./client` (balance client), `./store` (history + report computation), `./invariant` (explained-empty companion).

## Model Experience

### Tool schema

#### What the model sees

The model sees the generated `query_api_usage` schema: `window` is an enum (`today` / `week` / `month` / `all`, default `today`) and `refresh` a boolean (default `false`).

#### Token effect

Fixed schema cost on every request where the tool is visible.

#### KV Cache effect

Prefix-stable while the definition and visibility are unchanged.

### Tool-call history and result

#### What the model sees

Each assistant tool call carries the requested window and refresh flag. Success returns the text report; the structured value is the canonical `ConsumptionReport`. Stable failures are `billing-deepseek: no API key; …`, `billing-deepseek: unknown window …`, and the platform errors (`401` rejected key, `402` no available balance, HTTP status, network, malformed body). Snapshot data is plugin-local history, not a session event.

#### Token effect

The report is small and fixed-shape; it does not grow with history size (only `historyCount` does).

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

- **No platform consumption history** — the open platform exposes only the current balance, so window consumption is a local balance-delta estimate, not an official per-request billing breakdown; balances rounded to two decimals can drift from the platform's exact ledger over many small transactions.
- **Top-ups look like negative consumption** — a window delta is `baseline − current`, so a recharge that outpaces spending renders negative; there is no separate refill signal.
- **Windows are local-time based** — `today` / `week` / `month` boundaries follow the host machine's local timezone.
- **No per-session attribution** — the plugin tracks the whole account, not which session consumed what; per-session token cost stays with [`dsh-token-meter`](../../llm/token-meter/README.md).
