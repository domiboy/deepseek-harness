/**
 * Pure cost arithmetic: disjoint-bucket pricing and micro-currency rounding.
 */

import { describe, expect, it } from 'vitest'
import { costOfUsage, roundCost } from '../src/cost.ts'
import type { ModelPricing } from '../src/types.ts'

const PRICING: ModelPricing = {
  currency: 'CNY',
  inputPerMillion: 1.5,
  outputPerMillion: 4.5,
  cacheReadPerMillion: 0.05,
  cacheWritePerMillion: 0,
}

describe('costOfUsage', () => {
  it('prices disjoint input, output, and cache-read buckets', () => {
    // input 1000×1.5 + output 500×4.5 + cacheRead 200×0.05, per million.
    const cost = costOfUsage(
      { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 200 },
      PRICING,
    )
    expect(cost).toBeCloseTo(0.0015 + 0.00225 + 0.00001, 12)
  })

  it('prices cache writes when the model charges them', () => {
    const withWrites = { ...PRICING, cacheWritePerMillion: 0.5 }
    const cost = costOfUsage({ inputTokens: 0, outputTokens: 0, cacheWriteTokens: 1000 }, withWrites)
    expect(cost).toBeCloseTo(0.0005, 12)
  })

  it('costs zero for a zero-usage record', () => {
    expect(costOfUsage({ inputTokens: 0, outputTokens: 0 }, PRICING)).toBe(0)
  })
})

describe('roundCost', () => {
  it('keeps sub-cent precision and drops float noise beyond six decimals', () => {
    expect(roundCost(0.1 + 0.2)).toBe(0.3)
    expect(roundCost(0.00123456789)).toBe(0.001235)
  })
})
