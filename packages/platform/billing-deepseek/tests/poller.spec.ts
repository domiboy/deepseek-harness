import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { startPoller } from '@deepseek-ai/dsh-billing-deepseek/poller'
import type { BalanceSnapshot } from '@deepseek-ai/dsh-billing-deepseek'

let context: Context | undefined

afterEach(async () => {
  vi.useRealTimers()
  await context?.fiber.dispose()
  context = undefined
})

function snapshot(at: number): BalanceSnapshot {
  return {
    at,
    available: true,
    infos: [{ currency: 'CNY', totalBalance: '110.00', grantedBalance: '10.00', toppedUpBalance: '100.00' }],
  }
}

describe('startPoller', () => {
  it('polls immediately, then on every interval, and stops on dispose', async () => {
    vi.useFakeTimers()
    context = new Context()
    const captured: BalanceSnapshot[] = []
    const fetchOnce = vi.fn(async () => snapshot(Date.now()))
    const onError = vi.fn()
    startPoller(context, {
      intervalMs: 1000,
      fetchOnce,
      onSnapshot: async (value) => { captured.push(value) },
      onError,
    })

    await vi.advanceTimersByTimeAsync(0)
    expect(fetchOnce).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1000)
    expect(fetchOnce).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(3000)
    expect(fetchOnce).toHaveBeenCalledTimes(5)

    await context.fiber.dispose()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(fetchOnce).toHaveBeenCalledTimes(5)
    expect(captured).toHaveLength(5)
    expect(onError).not.toHaveBeenCalled()
  })

  it('skips overlapping ticks while a fetch is in flight', async () => {
    vi.useFakeTimers()
    context = new Context()
    const captured: BalanceSnapshot[] = []
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    let inFlight = 0
    let maxInFlight = 0
    const fetchOnce = vi.fn(async () => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await gate
      inFlight--
      return snapshot(Date.now())
    })
    startPoller(context, {
      intervalMs: 1000,
      fetchOnce,
      onSnapshot: async (value) => { captured.push(value) },
      onError: vi.fn(),
    })

    await vi.advanceTimersByTimeAsync(3000)
    expect(fetchOnce).toHaveBeenCalledTimes(1)
    expect(maxInFlight).toBe(1)

    release()
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchOnce).toHaveBeenCalledTimes(1)
    expect(captured).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1000)
    expect(fetchOnce).toHaveBeenCalledTimes(2)
    expect(captured).toHaveLength(2)
  })

  it('keeps polling after a failed fetch, reporting the error', async () => {
    vi.useFakeTimers()
    context = new Context()
    const captured: BalanceSnapshot[] = []
    const onError = vi.fn()
    const fetchOnce = vi.fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(snapshot(Date.now()))
    startPoller(context, {
      intervalMs: 1000,
      fetchOnce,
      onSnapshot: async (value) => { captured.push(value) },
      onError,
    })

    await vi.advanceTimersByTimeAsync(0)
    expect(onError).toHaveBeenCalledWith(expect.any(Error))
    await vi.advanceTimersByTimeAsync(1000)
    expect(fetchOnce).toHaveBeenCalledTimes(2)
    expect(captured).toHaveLength(1)
  })
})
