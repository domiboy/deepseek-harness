/**
 * Pure types of the token-cost domain: the ONE home of the `tokenCost`
 * projection-key declaration, free of this package's host-side value imports
 * (cordis context, zod, the fold). Two namespace projections serve it —
 * `./types` for host consumers, `./client` for client aggregates — with zero
 * content duplication.
 *
 * @module @deepseek-ai/dsh-token-cost/types
 */

// Marks this file a module so the declaration below AUGMENTS the projection
// table instead of declaring an ambient module.
export {}

/** One model's price per million tokens, in {@link currency}. */
export interface ModelPricing {
  /** ISO 4217 currency code, e.g. `CNY`. */
  currency: string
  /** Price per 1M uncached input tokens. */
  inputPerMillion: number
  /** Price per 1M output tokens. */
  outputPerMillion: number
  /** Price per 1M cache-hit input tokens (disjoint from `inputPerMillion` input). */
  cacheReadPerMillion: number
  /** Price per 1M cache-written tokens; 0 when the provider bills writes inside input. */
  cacheWritePerMillion: number
}

/**
 * Whole-log theoretical API cost, independent of how much history a client
 * has paged in. The fold attributes every `assistant/message` usage record to
 * the model of the latest preceding `request/header`, multiplies by that
 * model's configured pricing, and sums per conversation, per turn, and per
 * step. A step whose model has no configured price is counted in
 * `unpricedSteps` and contributes nothing.
 */
export interface TokenCostProjection {
  /** Currency of the last priced step; `CNY` before any priced step. */
  currency: string
  /** Total theoretical cost over all priced steps. */
  total: number
  /** Cost per turn, keyed by turn number. */
  perTurn: Record<string, number>
  /** Cost per step, keyed by `"<turn>:<step>"`. */
  perStep: Record<string, number>
  /** Steps whose usage was multiplied by a configured price. */
  pricedSteps: number
  /** Usage-carrying steps whose model has no configured price. */
  unpricedSteps: number
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** Whole-log theoretical API cost; see {@link TokenCostProjection}. */
    tokenCost: TokenCostProjection
  }
}
