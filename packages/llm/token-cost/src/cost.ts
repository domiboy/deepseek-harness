/**
 * Pure cost arithmetic for the token-cost domain.
 * @module @deepseek-ai/dsh-token-cost/cost
 */

import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import type { ModelPricing } from './types.ts'

/**
 * Round a cost to micro-currency precision (six decimals) so projection
 * values stay free of binary float noise while keeping sub-cent per-call
 * costs intact (typical DeepSeek calls cost thousandths of a yuan).
 * @param value - the raw computed cost.
 * @returns the value rounded to six decimal places.
 */
export function roundCost(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}

/**
 * Compute the theoretical cost of one usage record at one model's pricing.
 *
 * The provider reports disjoint buckets: `inputTokens` excludes cache-hit
 * input (the DeepSeek adapter subtracts `cacheReadTokens` from the prompt
 * total), so each bucket is priced independently and summed.
 * @param usage - provider-reported token usage for one call.
 * @param pricing - the model's per-million-token prices.
 * @returns the cost in the pricing currency.
 */
export function costOfUsage(usage: TokenUsage, pricing: ModelPricing): number {
  const input = usage.inputTokens * pricing.inputPerMillion
  const output = usage.outputTokens * pricing.outputPerMillion
  const cacheRead = (usage.cacheReadTokens ?? 0) * pricing.cacheReadPerMillion
  const cacheWrite = (usage.cacheWriteTokens ?? 0) * pricing.cacheWritePerMillion
  return (input + output + cacheRead + cacheWrite) / 1_000_000
}
