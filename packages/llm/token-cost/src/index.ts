/**
 * Token-cost plugin: registers the `tokenCost` projection fold with the
 * deployment's per-model pricing. Theoretical prices default to the DeepSeek
 * open platform's official off-peak CNY rates ([model & pricing](https://api-docs.deepseek.com/zh-cn/quick_start/pricing))
 * — peak hours (Beijing 09:00–12:00, 14:00–18:00) bill at double, and prices
 * may change; override via `pricing` for other models or updated rates.
 * @module @deepseek-ai/dsh-token-cost
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { createTokenCostProjection } from './projection.ts'
import type { ModelPricing } from './types.ts'

export type * from './types.ts'

/** Cordis companion plugin name. */
export const name = 'token-cost'
/** The projection registry is the plugin's whole purpose. */
export const inject = ['sessionProjections']

/** Default currency for the built-in DeepSeek price table. */
export const DEFAULT_CURRENCY = 'CNY'

/** Official off-peak rates per 1M tokens, DeepSeek open platform ([source](https://api-docs.deepseek.com/zh-cn/quick_start/pricing)). */
export const DEFAULT_PRICING: Record<string, ModelPricing> = {
  'deepseek-v4-flash': {
    currency: DEFAULT_CURRENCY,
    inputPerMillion: 1.5,
    outputPerMillion: 4.5,
    cacheReadPerMillion: 0.05,
    cacheWritePerMillion: 0,
  },
  'deepseek-chat': {
    currency: DEFAULT_CURRENCY,
    inputPerMillion: 1.5,
    outputPerMillion: 4.5,
    cacheReadPerMillion: 0.05,
    cacheWritePerMillion: 0,
  },
  'deepseek-v4-pro': {
    currency: DEFAULT_CURRENCY,
    inputPerMillion: 4.5,
    outputPerMillion: 13.5,
    cacheReadPerMillion: 0.15,
    cacheWritePerMillion: 0,
  },
  'deepseek-reasoner': {
    currency: DEFAULT_CURRENCY,
    inputPerMillion: 4.5,
    outputPerMillion: 13.5,
    cacheReadPerMillion: 0.15,
    cacheWritePerMillion: 0,
  },
}

/** One model's per-million-token price table. */
const modelPricingSchema = z.object({
  currency: z.string().default(DEFAULT_CURRENCY),
  inputPerMillion: z.number().min(0),
  outputPerMillion: z.number().min(0),
  cacheReadPerMillion: z.number().min(0),
  cacheWritePerMillion: z.number().min(0),
})

/** Plugin configuration. */
export interface Config {
  /**
   * Model id → price table, merged over {@link DEFAULT_PRICING}. A model
   * without an entry is unpriced (its steps count toward `unpricedSteps`).
   */
  pricing?: Record<string, ModelPricing>
}

/** Schemastery configuration for the token-cost plugin. */
export const Config: z<Config> = z.object({
  pricing: z.dict(modelPricingSchema),
})

/**
 * Register the tokenCost projection over the merged pricing table.
 * @param ctx - registrant context carrying the projection registry.
 * @param config - validated plugin configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const pricing = new Map<string, ModelPricing>(Object.entries({ ...DEFAULT_PRICING, ...config.pricing }))
  ctx.sessionProjections.register(createTokenCostProjection(pricing))
}
