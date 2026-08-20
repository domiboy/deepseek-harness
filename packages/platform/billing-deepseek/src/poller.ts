/**
 * Configurable balance poller: keeps the local history fresh between tool calls.
 * @module @deepseek-ai/dsh-billing-deepseek/poller
 */

import type { Context } from '@deepseek-ai/cordis'
import type { BalanceSnapshot } from './types.ts'

/** Poller wiring: what to fetch and where each snapshot goes. */
export interface PollerOptions {
  /** Milliseconds between polls; the first poll runs immediately at start. */
  intervalMs: number
  /** Fetch one fresh snapshot; failures surface through {@link onError}. */
  fetchOnce: () => Promise<BalanceSnapshot>
  /** Persist a successfully fetched snapshot. */
  onSnapshot: (snapshot: BalanceSnapshot) => Promise<void>
  /** Observe one failed poll; the poller keeps running. */
  onError: (error: unknown) => void
}

/**
 * Start the poller under the context's lifecycle. An initial fetch runs immediately, then
 * every `intervalMs`; overlapping ticks are skipped while a fetch is in flight.
 * @param ctx - registrant context; disposal stops the interval.
 * @param options - polling wiring.
 * @returns the disposer that stops the interval.
 */
export function startPoller(ctx: Context, options: PollerOptions): () => void {
  let busy = false
  const tick = async (): Promise<void> => {
    if (busy) return
    busy = true
    try {
      const snapshot = await options.fetchOnce()
      await options.onSnapshot(snapshot)
    } catch (error) {
      options.onError(error)
    } finally {
      busy = false
    }
  }
  void tick()
  const timer = setInterval(() => {
    void tick()
  }, options.intervalMs)
  const stop = (): void => { clearInterval(timer) }
  ctx.effect(() => stop, `billing-deepseek: balance poller (${options.intervalMs}ms)`)
  return stop
}
