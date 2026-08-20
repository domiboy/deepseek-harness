/**
 * Shared type surface for `@deepseek-ai/dsh-billing-deepseek`. Types only — no runtime code.
 * @module @deepseek-ai/dsh-billing-deepseek/types
 */

/** A consumption window key, relative to the report's `now`. */
export type WindowKey = 'today' | 'week' | 'month' | 'all'

/**
 * One per-currency balance line as reported by the DeepSeek open platform. The platform
 * returns amounts as decimal strings (e.g. `"110.00"`); they stay strings on the wire
 * boundary and are parsed to numbers only for consumption arithmetic.
 */
export interface BalanceInfo {
  /** ISO 4217 currency code, e.g. `CNY`. */
  currency: string
  /** Current remaining balance. */
  totalBalance: string
  /** Cumulative granted (promotional) balance. */
  grantedBalance: string
  /** Cumulative topped-up balance. */
  toppedUpBalance: string
}

/** One point-in-time reading of the platform account. */
export interface BalanceSnapshot {
  /** Epoch milliseconds when the platform was queried. */
  at: number
  /** Whether the account may currently make API calls. */
  available: boolean
  /** Per-currency balance lines, in platform order. */
  infos: BalanceInfo[]
}

/** Consumption attributed to one window. */
export interface WindowConsumption {
  /** The window key. */
  key: WindowKey
  /** ISO timestamp of the window start used as the baseline. */
  since: string
  /**
   * Baseline balance minus the current balance, rounded to two decimals. Null when no
   * snapshot predates the window start, so the window cannot be attributed. Negative
   * when the balance rose over the window (a top-up outpaced consumption).
   */
  consumed: number | null
}

/** The model-facing usage report a `query_api_usage` call returns. */
export interface ConsumptionReport {
  /** Epoch milliseconds when the latest balance was read. */
  fetchedAt: number
  /** Whether the account may currently make API calls. */
  available: boolean
  /** The reported currency (config filter, or the platform's first currency). */
  currency: string
  /** Current remaining balance for {@link currency}, parsed to a number. */
  currentTotal: number
  /** Cumulative granted balance for {@link currency}, parsed to a number. */
  grantedBalance: number
  /** Cumulative topped-up balance for {@link currency}, parsed to a number. */
  toppedUpBalance: number
  /** Platform-side lifetime consumption: granted + topped-up − total. */
  platformLifetimeConsumption: number
  /** Per-window consumption since the tracked baseline. */
  windows: WindowConsumption[]
  /** Epoch milliseconds of the oldest tracked snapshot, or null when history is empty. */
  historySince: number | null
  /** Number of tracked snapshots in the local history. */
  historyCount: number
}

/** Wire value of the `billing.usage` RPC: the report, or why it is unavailable. */
export interface BillingUsageValue {
  /** Whether the billing plugin is composed and produced a report. */
  ok: boolean
  /** User-facing reason when `ok` is false (e.g. the plugin is not composed). */
  reason?: string
  /** The usage report when `ok`; absent otherwise. */
  report?: ConsumptionReport
}
