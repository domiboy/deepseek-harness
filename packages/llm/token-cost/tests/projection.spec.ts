/**
 * The `tokenCost` projection: mounts beside the projection registry, folds
 * per-request model attribution and per-call usage into conversation/turn/step
 * theoretical costs, and unmounts cleanly. Wall math runs against the exported
 * definition directly, where events are crafted.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import * as TokenCostPlugin from '@deepseek-ai/dsh-token-cost'
import { createTokenCostProjection } from '../src/projection.ts'
import type { ModelPricing, TokenCostProjection } from '../src/types.ts'

const FLASH: ModelPricing = {
  currency: 'CNY',
  inputPerMillion: 1.5,
  outputPerMillion: 4.5,
  cacheReadPerMillion: 0.05,
  cacheWritePerMillion: 0,
}

const PRO: ModelPricing = {
  currency: 'CNY',
  inputPerMillion: 4.5,
  outputPerMillion: 13.5,
  cacheReadPerMillion: 0.15,
  cacheWritePerMillion: 0,
}

let seq = 0
function header(model: string, reason: 'initial' | 'change' = 'initial'): SessionEvent {
  return {
    type: 'request/header',
    seq: seq++,
    time: 0,
    data: { header: { config: { provider: 'deepseek', model } }, reason },
  }
}

function call(turn: number, step: number, usage?: unknown): SessionEvent {
  return {
    type: 'assistant/message',
    seq: seq++,
    time: 0,
    data: {
      turn,
      step,
      message: createMessage({
        role: 'assistant',
        content: [{ type: 'text', text: 'ok' }],
        source: { kind: 'model', provider: 'deepseek', model: 'deepseek-v4-flash' },
      }),
      ...usage === undefined ? {} : { usage },
    },
  } as SessionEvent
}

function fold(events: readonly SessionEvent[], pricing: ReadonlyMap<string, ModelPricing>): TokenCostProjection {
  const definition = createTokenCostProjection(pricing)
  let state = definition.init()
  for (const event of events) state = definition.apply(state, event)
  return definition.view(state)
}

const PRICING = new Map<string, ModelPricing>([
  ['deepseek-v4-flash', FLASH],
  ['deepseek-v4-pro', PRO],
])

describe('tokenCost projection fold', () => {
  it('reports zero costs on the empty log', () => {
    const value = fold([], PRICING)
    expect(value.total).toBe(0)
    expect(value.pricedSteps).toBe(0)
    expect(value.unpricedSteps).toBe(0)
    expect(value.currency).toBe('CNY')
  })

  it('attributes each call to the latest request/header model and sums per turn and step', () => {
    const value = fold([
      header('deepseek-v4-flash'),
      call(1, 0, { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 200 }),
      header('deepseek-v4-pro', 'change'),
      call(1, 1, { inputTokens: 100, outputTokens: 100 }),
    ], PRICING)
    const first = (1000 * 1.5 + 500 * 4.5 + 200 * 0.05) / 1_000_000
    const second = (100 * 4.5 + 100 * 13.5) / 1_000_000
    expect(value.pricedSteps).toBe(2)
    expect(value.unpricedSteps).toBe(0)
    expect(value.perStep['1:0']).toBeCloseTo(first, 9)
    expect(value.perStep['1:1']).toBeCloseTo(second, 9)
    expect(value.perTurn['1']).toBeCloseTo(first + second, 9)
    expect(value.total).toBeCloseTo(first + second, 9)
  })

  it('counts usage-carrying steps with no configured price as unpriced', () => {
    const value = fold([
      header('mystery-model'),
      call(1, 0, { inputTokens: 1000, outputTokens: 500 }),
    ], PRICING)
    expect(value.pricedSteps).toBe(0)
    expect(value.unpricedSteps).toBe(1)
    expect(value.total).toBe(0)
  })

  it('ignores calls without a usage record and calls before any header', () => {
    const value = fold([call(1, 0), header('deepseek-v4-flash'), call(2, 0, { inputTokens: 1000, outputTokens: 0 })], PRICING)
    expect(value.pricedSteps).toBe(1)
    expect(value.unpricedSteps).toBe(0)
    expect(value.total).toBeCloseTo(1000 * 1.5 / 1_000_000, 12)
  })

  it('keeps per-step keys distinct across turns', () => {
    const value = fold([
      header('deepseek-v4-flash'),
      call(1, 0, { inputTokens: 1000, outputTokens: 0 }),
      call(2, 0, { inputTokens: 2000, outputTokens: 0 }),
    ], PRICING)
    expect(value.perStep['1:0']).toBeCloseTo(0.0015, 12)
    expect(value.perStep['2:0']).toBeCloseTo(0.003, 12)
    expect(value.perTurn['1']).toBeCloseTo(0.0015, 12)
    expect(value.perTurn['2']).toBeCloseTo(0.003, 12)
  })
})

describe('tokenCost projection unit (registry drive)', () => {
  async function harness(withCostPlugin: boolean): Promise<{ ctx: Context; session: Session }> {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    if (withCostPlugin) await ctx.plugin(TokenCostPlugin)
    return { ctx, session: ctx.sessions.create(SessionId('costed')) }
  }

  it('serves the folded costs to registry consumers', async () => {
    const { ctx, session } = await harness(true)
    session.append('request/header', { header: { config: { provider: 'deepseek', model: 'deepseek-v4-flash' } }, reason: 'initial' })
    session.append('assistant/message', {
      turn: 1,
      step: 0,
      message: createMessage({
        role: 'assistant',
        content: [{ type: 'text', text: 'ok' }],
        source: { kind: 'model', provider: 'deepseek', model: 'deepseek-v4-flash' },
      }),
      usage: { inputTokens: 1000, outputTokens: 500 },
    }, { surfaceOp: 'append', sourceEventSeqs: [] })

    const value = ctx.sessionProjections.snapshot(session).values.tokenCost
    expect(value).toBeDefined()
    if (value === undefined) throw new Error('tokenCost projection missing')
    expect(value.pricedSteps).toBe(1)
    expect(value.total).toBeCloseTo((1000 * 1.5 + 500 * 4.5) / 1_000_000, 12)
  })

  it('has no tokenCost key without the plugin, and drops it when the plugin unloads (HMR safety)', async () => {
    const { ctx, session } = await harness(false)
    expect('tokenCost' in ctx.sessionProjections.snapshot(session).values).toBe(false)
    const fiber = await ctx.plugin(TokenCostPlugin)
    session.append('request/header', { header: { config: { provider: 'deepseek', model: 'deepseek-v4-flash' } }, reason: 'initial' })
    session.append('assistant/message', {
      turn: 1,
      step: 0,
      message: createMessage({
        role: 'assistant',
        content: [{ type: 'text', text: 'ok' }],
        source: { kind: 'model', provider: 'deepseek', model: 'deepseek-v4-flash' },
      }),
      usage: { inputTokens: 1000, outputTokens: 500 },
    }, { surfaceOp: 'append', sourceEventSeqs: [] })
    expect(ctx.sessionProjections.snapshot(session).values.tokenCost).toBeDefined()

    await fiber.dispose()
    expect('tokenCost' in ctx.sessionProjections.snapshot(session).values).toBe(false)
  })
})
