/**
 * BillingCardController: single-flight refresh semantics, success/error/not-
 * composed states, and the inject face.
 */
import { describe, expect, it, vi } from 'vitest'
import { BillingCardController, type BillingCardState, type BillingUsageCall } from '../src/client/billing-card-controller.ts'

const OK_VALUE = {
  ok: true as const,
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

function snapshot(controller: BillingCardController): BillingCardState {
  return controller.inject().hooks.billingUsage.getSnapshot()
}

describe('BillingCardController', () => {
  it('starts loading and settles with the report on success', async () => {
    const usage = vi.fn<BillingUsageCall>(async () => ({ result: { ok: true, value: OK_VALUE } }))
    const controller = new BillingCardController(usage)
    expect(snapshot(controller).loading).toBe(true)

    controller.refresh()
    await vi.waitFor(() => {
      const state = snapshot(controller)
      expect(state.loading).toBe(false)
      expect(state.value).toEqual(OK_VALUE)
      expect(state.error).toBeUndefined()
      expect(state.refreshedAt).toBeGreaterThan(0)
    })
  })

  it('records the failure reason and keeps the previous value', async () => {
    const usage = vi.fn<BillingUsageCall>()
    usage
      .mockResolvedValueOnce({ result: { ok: true, value: OK_VALUE } })
      .mockRejectedValueOnce(new Error('boom'))
    const controller = new BillingCardController(usage)
    controller.refresh()
    await vi.waitFor(() => { expect(snapshot(controller).value).toEqual(OK_VALUE) })

    controller.refresh()
    await vi.waitFor(() => {
      const state = snapshot(controller)
      expect(state.error).toBe('boom')
      expect(state.loading).toBe(false)
      expect(state.value).toEqual(OK_VALUE)
    })
  })

  it('maps an RPC failure into the error text', async () => {
    const usage = vi.fn<BillingUsageCall>(async () => ({
      result: { ok: false, error: { code: 'internal', message: 'nope' } },
    }))
    const controller = new BillingCardController(usage)
    controller.refresh()
    await vi.waitFor(() => { expect(snapshot(controller).error).toContain('billing.usage failed: internal: nope') })
  })

  it('stringifies a non-Error rejection', async () => {
    const usage = vi.fn<BillingUsageCall>(async () => { throw 'raw-failure' })
    const controller = new BillingCardController(usage)
    controller.refresh()
    await vi.waitFor(() => { expect(snapshot(controller).error).toBe('raw-failure') })
  })

  it('stores the not-composed value without an error', async () => {
    const usage = vi.fn<BillingUsageCall>(async () => ({
      result: { ok: true, value: { ok: false, reason: '未装配 billing-deepseek 插件' } },
    }))
    const controller = new BillingCardController(usage)
    controller.refresh()
    await vi.waitFor(() => {
      const state = snapshot(controller)
      expect(state.error).toBeUndefined()
      expect(state.value).toEqual({ ok: false, reason: '未装配 billing-deepseek 插件' })
    })
  })

  it('skips overlapping refreshes while one is in flight', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const usage = vi.fn<BillingUsageCall>(async () => {
      await gate
      return { result: { ok: true, value: OK_VALUE } }
    })
    const controller = new BillingCardController(usage)
    controller.refresh()
    controller.refresh()
    expect(usage).toHaveBeenCalledTimes(1)
    release()
    await vi.waitFor(() => { expect(snapshot(controller).loading).toBe(false) })
    expect(usage).toHaveBeenCalledTimes(1)
  })

  it('exposes a refresh action on the inject face', () => {
    const usage = vi.fn<BillingUsageCall>(async () => ({ result: { ok: true, value: OK_VALUE } }))
    const controller = new BillingCardController(usage)
    const face = controller.inject()
    expect(face.hooks.billingUsage).toBeDefined()
    face.refresh()
    expect(usage).toHaveBeenCalledTimes(1)
  })
})
