/**
 * The billing card's staged form over the `billing.usage` RPC: a snapshot
 * store plus a single-flight refresh that never overwrites a settled value
 * with a failure.
 */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'

/**
 * The billing.usage wire value, declared client-side: a browser package must
 * not depend on a Host package, and the connection contract does not re-export
 * `ResponseValue<'billing.usage'>` by name. The host `billing-deepseek`
 * package owns the authoritative shape; keep this mirror in sync.
 */
export interface BillingUsageValue {
  /** Whether the host billing plugin is composed and produced a report. */
  ok: boolean
  /** User-facing reason when `ok` is false. */
  reason?: string
  /** The usage report when `ok`. */
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

/** One billing.usage call outcome, narrowed to what the card reads. */
export type BillingUsageCall = () => Promise<{
  result:
    | { ok: true; value: BillingUsageValue }
    | { ok: false; error: { code: string; message: string } }
}>

/** Card presentation state. */
export interface BillingCardState {
  /** Whether a refresh is in flight. */
  loading: boolean
  /** User-facing failure text when the last refresh produced none. */
  error?: string
  /** The last successful call value (including the ok:false not-composed form). */
  value?: BillingUsageValue
  /** Epoch milliseconds of the last refresh attempt. */
  refreshedAt: number
}

/** The registration-side face the card's slot entry injects. */
export interface BillingCardFace {
  hooks: {
    /** Card snapshot bound by the renderer as useBillingUsage. */
    billingUsage: SnapshotStore<BillingCardState>
  }
  /** Force one platform query now. */
  refresh: () => void
}

/** Bridges the billing.usage RPC onto the card's snapshot. */
export class BillingCardController {
  private readonly store = createSnapshotStore<BillingCardState>({ loading: true, refreshedAt: 0 })
  private inFlight = false

  /**
   * @param usage - thunk issuing one billing.usage call (bound by apply to the connection api).
   */
  constructor(private readonly usage: BillingUsageCall) {}

  /**
   * Run one refresh. A failure keeps the last settled value and records the
   * reason; overlapping calls are skipped.
   */
  refresh(): void {
    if (this.inFlight) return
    this.inFlight = true
    this.store.update((state) => { state.loading = true })
    void (async () => {
      try {
        const { result } = await this.usage()
        if (!result.ok) {
          throw new Error(`billing.usage failed: ${result.error.code}: ${result.error.message}`)
        }
        this.store.set({ loading: false, value: result.value, refreshedAt: Date.now() })
      } catch (error) {
        this.store.update((state) => {
          state.loading = false
          state.error = error instanceof Error ? error.message : String(error)
          state.refreshedAt = Date.now()
        })
      } finally {
        this.inFlight = false
      }
    })()
  }

  /**
   * Build the face the card's slot registration injects.
   * @returns the card's snapshot and refresh action.
   */
  inject(): BillingCardFace {
    return { hooks: { billingUsage: this.store }, refresh: () => { this.refresh() } }
  }
}
