/**
 * Billing usage API: the composed billing plugin's current DeepSeek
 * open-platform balance/consumption report, served to the web UI card.
 * @module dsh-host-apiproxy/api/billing
 */

import type { RpcRequest, RpcResponse } from './rpc.ts'

/**
 * The billing.usage wire value. Declared here rather than imported from
 * `@deepseek-ai/dsh-billing-deepseek`: this api/ layer stays zero-dependency
 * and browser-safe, so the host plugin's module must never enter its type
 * graph. The billing plugin owns the authoritative shape; keep in sync.
 */
export interface BillingUsageValue {
  /** Whether the host billing plugin is composed and produced a report. */
  ok: boolean
  /** User-facing reason when `ok` is false (e.g. the plugin is not composed). */
  reason?: string
  /** The usage report when `ok`; absent otherwise. */
  report?: {
    fetchedAt: number
    available: boolean
    currency: string
    currentTotal: number
    grantedBalance: number
    toppedUpBalance: number
    platformLifetimeConsumption: number
    windows: Array<{ key: 'today' | 'week' | 'month' | 'all'; since: string; consumed: number | null }>
    historySince: number | null
    historyCount: number
  }
}

/** Billing usage domain. */
export interface BillingApi {
  /**
   * Query the composed billing plugin's current usage report.
   * @param request - empty payload envelope.
   * @returns the report, or `ok: false` with a reason when the plugin is not composed.
   */
  usage(request: RpcRequest<Record<string, never>>): Promise<RpcResponse<BillingUsageValue>>
}
