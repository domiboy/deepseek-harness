/**
 * The `billing.usage` route: a composition without the billing-deepseek plugin
 * answers `ok: false` with a reason, and one with the service composed returns
 * the plugin's report verbatim.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import SessionStore from '@deepseek-ai/dsh-session'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import type { RpcRequest } from '@deepseek-ai/dsh-host-apiproxy/api'
import { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import { createApiProxy } from '@deepseek-ai/dsh-host-apiproxy'
import type { BillingUsageService, BillingUsageValue } from '@deepseek-ai/dsh-billing-deepseek'

let nextRpc = 1
function request(): RpcRequest<Record<string, never>> {
  return { rpcId: RpcId(`billing-${String(nextRpc++)}`), payload: {} }
}

const REPORT: NonNullable<BillingUsageValue['report']> = {
  fetchedAt: 1700000000000,
  available: true,
  currency: 'CNY',
  currentTotal: 110,
  grantedBalance: 10,
  toppedUpBalance: 100,
  platformLifetimeConsumption: 0,
  windows: [
    { key: 'today', since: '2026-08-20T00:00:00.000Z', consumed: 10 },
    { key: 'week', since: '2026-08-17T00:00:00.000Z', consumed: 40 },
    { key: 'month', since: '2026-08-01T00:00:00.000Z', consumed: 90 },
    { key: 'all', since: '2026-07-31T15:00:00.000Z', consumed: 90 },
  ],
  historySince: 1700000000000,
  historyCount: 4,
}

function apiProxy(ctx: Context) {
  return createApiProxy(ctx, { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp' })
}

/** Compose the baseline services createApiProxy reads at construction. */
async function baseline(ctx: Context): Promise<void> {
  await ctx.plugin(SessionStore)
  await ctx.plugin(UserQuestionService)
  await ctx.plugin(AgentRegistry)
  const session = ctx.sessions.create()
  ctx.agents.register({
    id: session.id,
    session,
    inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
    status: 'idle',
    ctx,
  } as never)
}

describe('billing.usage route', () => {
  it('answers an ok:false value with a reason when the billing plugin is not composed', async () => {
    const ctx = new Context()
    await baseline(ctx)
    const response = await apiProxy(ctx).billing.usage(request())
    expect(response.result.ok).toBe(true)
    if (!response.result.ok) throw new Error('expected a successful RPC envelope')
    const value = response.result.value
    expect(value.ok).toBe(false)
    expect(value.reason).toContain('billing-deepseek')
  })

  it('returns the composed billing service report verbatim', async () => {
    const ctx = new Context()
    await baseline(ctx)
    const service: BillingUsageService = {
      usage: async () => ({ ok: true, report: REPORT }),
    }
    await ctx.plugin(() => { ctx.provide('billing', service) })
    const response = await apiProxy(ctx).billing.usage(request())
    expect(response.result.ok).toBe(true)
    if (!response.result.ok) throw new Error('expected a successful RPC envelope')
    expect(response.result.value).toEqual({ ok: true, report: REPORT })
  })
})
