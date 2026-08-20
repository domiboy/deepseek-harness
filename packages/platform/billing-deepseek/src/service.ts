/**
 * The `billing` service seam: the usage report the web UI card consumes.
 * @module @deepseek-ai/dsh-billing-deepseek/service
 */

import { computeReport, type BillingHistory } from './store.ts'
import type { BillingUsageValue } from './types.ts'

/** The billing service surface registered as `ctx.billing`. */
export interface BillingUsageService {
  /**
   * Resolve the current usage report from the plugin-owned history.
   * @returns the report; an empty history reports zeros and null windows.
   */
  usage(): Promise<BillingUsageValue>
}

/**
 * Build the service over one shared history.
 * @param history - the plugin's balance history (the poller and the tool share it too).
 * @param currency - optional currency filter; falls back to the platform's first currency.
 * @returns the service instance.
 */
export function createBillingUsageService(
  history: BillingHistory,
  currency: string | undefined,
): BillingUsageService {
  return {
    async usage() {
      const snapshots = await history.load()
      const effectiveCurrency = currency
        ?? snapshots.at(-1)?.infos[0]?.currency
        ?? 'CNY'
      return { ok: true, report: computeReport(snapshots, Date.now(), effectiveCurrency) }
    },
  }
}
