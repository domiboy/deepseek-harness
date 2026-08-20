/**
 * ui-billing browser half: card registration into `settings.plugin.item` keyed
 * by the host `billing-deepseek` namespace, locale dictionaries, the 30s
 * refresh cadence (initial + interval), and fiber-teardown removal (HMR safety)
 * against the real SlotRegistry.
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import type { BillingUsageValue } from '../src/client/billing-card-controller.ts'
import { apply, inject, REFRESH_INTERVAL_MS } from '../src/client/index.ts'
import { en, NS, zh } from '../src/client/locales.ts'

type UsageFn = () => Promise<{ result:
  | { ok: true; value: BillingUsageValue }
  | { ok: false; error: { code: string; message: string } }
}>

const OK_VALUE: BillingUsageValue = {
  ok: true,
  report: {
    fetchedAt: 1700000000000,
    available: true,
    currency: 'CNY',
    currentTotal: 110,
    grantedBalance: 10,
    toppedUpBalance: 100,
    platformLifetimeConsumption: 0,
    windows: [],
    historySince: null,
    historyCount: 0,
  },
}

interface Bench {
  ctx: Context
  slots: SlotRegistry
  usage: ReturnType<typeof vi.fn<UsageFn>>
  locales: Array<{ namespace: string; dictionaries: unknown }>
}

async function bench(): Promise<Bench> {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.slots.register({
    name: 'root',
    children: { 'settings.plugin.item': { kind: 'keyed', scope: 'root' } },
  } as never, () => null)
  const locales: Bench['locales'] = []
  ctx.provide('locale', {
    register(namespace: string, dictionaries: unknown) {
      locales.push({ namespace, dictionaries })
      return () => {}
    },
    bind: () => (key: string) => key,
  })
  const usage = vi.fn<UsageFn>(async () => ({ result: { ok: true, value: OK_VALUE } }))
  ctx.provide('connection', {
    isLoopback: true,
    api: { billing: { usage } },
  } as never)
  await ctx.plugin({ inject, apply }).await()
  return { ctx, slots: ctx.get('slots') as SlotRegistry, usage, locales }
}

describe('ui-billing apply', () => {
  it('declares the services it uses', () => {
    expect(inject).toEqual(['slots', 'locale', 'connection'])
  })

  it('registers the dictionaries, the keyed card, and an immediate refresh', async () => {
    vi.useFakeTimers()
    const benchValue = await bench()
    expect(benchValue.locales.some(entry => entry.namespace === NS
      && (entry.dictionaries as { zh: unknown }).zh === zh
      && (entry.dictionaries as { en: unknown }).en === en)).toBe(true)

    const entries = benchValue.slots.entries('settings.plugin.item')
    expect(entries).toHaveLength(1)
    expect(entries[0]!.options).toMatchObject({ key: NS })
    // The registrant face is injectable on demand.
    const face = entries[0]!.inject?.() as { hooks?: { billingUsage: unknown }; refresh?: () => void } | undefined
    expect(face?.refresh).toBeTypeOf('function')
    expect(face?.hooks?.billingUsage).toBeDefined()

    // The initial refresh fires once at mount.
    await vi.advanceTimersByTimeAsync(0)
    expect(benchValue.usage).toHaveBeenCalledTimes(1)
    await benchValue.ctx.fiber.dispose()
    vi.useRealTimers()
  })

  it('refreshes on the 30s interval and stops on dispose (HMR safety)', async () => {
    vi.useFakeTimers()
    const benchValue = await bench()
    await vi.advanceTimersByTimeAsync(0)
    expect(benchValue.usage).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL_MS)
    expect(benchValue.usage).toHaveBeenCalledTimes(2)

    await benchValue.ctx.fiber.dispose()
    expect(benchValue.slots.entries('settings.plugin.item')).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL_MS * 3)
    expect(benchValue.usage).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })
})
