/**
 * The `tokenCost` projection fold: attribute every `assistant/message` usage
 * record to the model of the latest preceding `request/header` and multiply
 * by that model's configured pricing.
 * @module @deepseek-ai/dsh-token-cost/projection
 */

import { z } from 'zod'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import { costOfUsage, roundCost } from './cost.ts'
import type { ModelPricing, TokenCostProjection } from './types.ts'

/** Internal fold state; the `view` is the projection's durable payload. */
export interface TokenCostState {
  /** Model of the latest `request/header`; null before the first header. */
  currentModel: string | null
  /** Currency of the last priced step. */
  currency: string
  /** Total theoretical cost. */
  total: number
  /** Cost per turn keyed by turn number. */
  perTurn: Record<string, number>
  /** Cost per step keyed by `"<turn>:<step>"`. */
  perStep: Record<string, number>
  /** Steps multiplied by a configured price. */
  pricedSteps: number
  /** Usage-carrying steps whose model has no configured price. */
  unpricedSteps: number
}

/** The projection's durable payload schema; strict so drift fails loud. */
const projectionSchema = z.object({
  currency: z.string(),
  total: z.number().nonnegative(),
  perTurn: z.record(z.string(), z.number().nonnegative()),
  perStep: z.record(z.string(), z.number().nonnegative()),
  pricedSteps: z.number().int().nonnegative(),
  unpricedSteps: z.number().int().nonnegative(),
}).strict() as unknown as z.ZodType<TokenCostProjection>

const initialState = (): TokenCostState => ({
  currentModel: null,
  currency: 'CNY',
  total: 0,
  perTurn: {},
  perStep: {},
  pricedSteps: 0,
  unpricedSteps: 0,
})

/** Add one cost into a record key, rounding the running sum. */
function addTo(record: Record<string, number>, key: string, cost: number): Record<string, number> {
  return { ...record, [key]: roundCost((record[key] ?? 0) + cost) }
}

/**
 * Build the `tokenCost` projection over one pricing table.
 * @param pricing - model id → per-million-token prices; a model absent here is unpriced.
 * @returns the projection definition to register.
 */
export function createTokenCostProjection(
  pricing: ReadonlyMap<string, ModelPricing>,
): ProjectionDefinition<'tokenCost', TokenCostState> {
  return {
    key: 'tokenCost',
    schema: projectionSchema,
    init: initialState,
    apply: (state, event) => {
      switch (event.type) {
        case 'request/header':
          return { ...state, currentModel: event.data.header.config.model }
        case 'assistant/message': {
          const usage: TokenUsage | undefined = event.data.usage
          if (usage === undefined) return state
          const model = state.currentModel
          const price = model === null ? undefined : pricing.get(model)
          if (price === undefined) {
            return { ...state, unpricedSteps: state.unpricedSteps + 1 }
          }
          const cost = roundCost(costOfUsage(usage, price))
          const turnKey = String(event.data.turn)
          const stepKey = `${event.data.turn}:${event.data.step}`
          return {
            ...state,
            currency: price.currency,
            total: roundCost(state.total + cost),
            perTurn: addTo(state.perTurn, turnKey, cost),
            perStep: addTo(state.perStep, stepKey, cost),
            pricedSteps: state.pricedSteps + 1,
          }
        }
        default:
          return state
      }
    },
    view: (state): TokenCostProjection => ({
      currency: state.currency,
      total: state.total,
      perTurn: state.perTurn,
      perStep: state.perStep,
      pricedSteps: state.pricedSteps,
      unpricedSteps: state.unpricedSteps,
    }),
    stateVersion: 1,
  }
}
