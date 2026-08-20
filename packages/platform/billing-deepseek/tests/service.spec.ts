import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BillingHistory } from '../src/store.ts'
import { createBillingUsageService } from '../src/service.ts'
import type { BalanceSnapshot } from '../src/types.ts'

let root: string | undefined

afterEach(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

async function history(): Promise<BillingHistory> {
  root = await mkdtemp(join(tmpdir(), 'dsh-billing-service-'))
  return new BillingHistory(join(root, 'history.jsonl'))
}

function snapshot(at: number, total: string): BalanceSnapshot {
  return {
    at,
    available: true,
    infos: [{ currency: 'CNY', totalBalance: total, grantedBalance: '10.00', toppedUpBalance: '100.00' }],
  }
}

describe('createBillingUsageService', () => {
  it('reports zeros and null windows for an empty history', async () => {
    const service = createBillingUsageService(await history(), undefined)
    const value = await service.usage()
    expect(value.ok).toBe(true)
    expect(value.report?.historyCount).toBe(0)
    expect(value.report?.currentTotal).toBe(0)
    expect(value.report?.windows.every(w => w.consumed === null)).toBe(true)
  })

  it('reports the computed consumption over the stored history', async () => {
    const store = await history()
    await store.append(snapshot(new Date(2026, 7, 19, 23, 0).getTime(), '120.00'))
    await store.append(snapshot(new Date(2026, 7, 20, 13, 0).getTime(), '110.00'))
    const service = createBillingUsageService(store, undefined)
    const report = (await service.usage()).report
    expect(report?.historyCount).toBe(2)
    expect(report?.currentTotal).toBe(110)
    expect(report?.windows.find(w => w.key === 'today')?.consumed).toBe(10)
    expect(report?.platformLifetimeConsumption).toBe(10) // oldest 120 − current 110
  })

  it('falls back to the platform first currency when no filter is configured', async () => {
    const store = await history()
    const multi: BalanceSnapshot = {
      at: Date.now(),
      available: true,
      infos: [
        { currency: 'CNY', totalBalance: '110.00', grantedBalance: '10.00', toppedUpBalance: '100.00' },
        { currency: 'USD', totalBalance: '7.50', grantedBalance: '0.00', toppedUpBalance: '8.00' },
      ],
    }
    await store.append(multi)
    const report = (await createBillingUsageService(store, undefined).usage()).report
    expect(report?.currency).toBe('CNY')
    const filtered = (await createBillingUsageService(store, 'USD').usage()).report
    expect(filtered?.currency).toBe('USD')
  })
})
