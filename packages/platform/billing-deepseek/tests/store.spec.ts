import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BillingHistory, computeReport } from '@deepseek-ai/dsh-billing-deepseek/store'
import type {
  BalanceSnapshot,
  ConsumptionReport,
  WindowConsumption,
  WindowKey,
} from '@deepseek-ai/dsh-billing-deepseek'

let root: string | undefined

afterEach(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

/** Index a report's windows by key for assertion convenience. */
function byWindow(report: ConsumptionReport): Record<WindowKey, WindowConsumption> {
  return Object.fromEntries(report.windows.map(w => [w.key, w] as const)) as Record<WindowKey, WindowConsumption>
}

async function historyPath(): Promise<string> {
  root = await mkdtemp(join(tmpdir(), 'dsh-billing-store-'))
  return join(root, 'nested', 'billing-history.jsonl')
}

function snapshot(at: number, total: string, overrides: Partial<BalanceSnapshot> = {}): BalanceSnapshot {
  return {
    at,
    available: true,
    infos: [{ currency: 'CNY', totalBalance: total, grantedBalance: '10.00', toppedUpBalance: '100.00' }],
    ...overrides,
  }
}

describe('BillingHistory', () => {
  it('round-trips appended snapshots in order', async () => {
    const path = await historyPath()
    const history = new BillingHistory(path)
    const first = snapshot(1000, '200.00')
    const second = snapshot(2000, '150.00')
    await history.append(first)
    await history.append(second)
    expect(await history.load()).toEqual([first, second])
    expect((await history.latest())?.at).toBe(2000)
  })

  it('returns an empty history when the file does not exist yet', async () => {
    const history = new BillingHistory(await historyPath())
    expect(await history.load()).toEqual([])
    expect(await history.latest()).toBeUndefined()
  })

  it('drops a torn trailing line but fails loud on mid-file corruption', async () => {
    const path = await historyPath()
    const history = new BillingHistory(path)
    await history.append(snapshot(1000, '200.00'))
    await writeFile(path, `${JSON.stringify(snapshot(1000, '200.00'))}\n{"at": 2`, 'utf8')
    expect((await history.load()).length).toBe(1)
    await writeFile(path, `${JSON.stringify(snapshot(1000, '200.00'))}\nnot-json\n${JSON.stringify(snapshot(2000, '150.00'))}`, 'utf8')
    await expect(history.load()).rejects.toThrow(/not valid JSON/)
  })
})

describe('computeReport', () => {
  // Local-time fixtures: Monday 2026-08-17 opens the report week.
  const s0 = snapshot(new Date(2026, 6, 31, 23, 0).getTime(), '200.00') // Fri Jul 31
  const s1 = snapshot(new Date(2026, 7, 1, 10, 0).getTime(), '150.00')  // Sat Aug 1
  const s2 = snapshot(new Date(2026, 7, 19, 23, 0).getTime(), '120.00') // Wed Aug 19
  const s3 = snapshot(new Date(2026, 7, 20, 13, 0).getTime(), '110.00') // Thu Aug 20
  const now = new Date(2026, 7, 20, 14, 0).getTime()

  it('computes window consumption from the latest baseline at or before each window start', () => {
    const report = computeReport([s0, s1, s2, s3], now, 'CNY')
    expect(report.currency).toBe('CNY')
    expect(report.currentTotal).toBe(110)
    expect(report.grantedBalance).toBe(10)
    expect(report.toppedUpBalance).toBe(100)
    expect(report.platformLifetimeConsumption).toBe(90) // oldest 200 − current 110, tracked locally
    expect(report.historySince).toBe(s0.at)
    expect(report.historyCount).toBe(4)
    const byKey = byWindow(report)
    expect(byKey.today.consumed).toBe(10)   // s2 (120) − s3 (110)
    expect(byKey.week.consumed).toBe(40)    // s1 (150) − s3 (110)
    expect(byKey.month.consumed).toBe(90)   // s0 (200) − s3 (110)
    expect(byKey.all.consumed).toBe(90)     // s0 (200) − s3 (110)
  })

  it('falls back to the earliest snapshot when tracking began after the window opened', () => {
    const sameDay = [
      snapshot(new Date(2026, 7, 20, 10, 0).getTime(), '120.00'),
      s3,
    ]
    const report = computeReport(sameDay, now, 'CNY')
    const byKey = byWindow(report)
    expect(byKey.today.consumed).toBe(10) // earliest 120 − current 110
    expect(byKey.week.consumed).toBe(10)
    expect(byKey.month.consumed).toBe(10)
    expect(byKey.all.consumed).toBe(10)
    expect(report.platformLifetimeConsumption).toBe(10)
  })

  it('honours the configured currency and falls back to the first line otherwise', () => {
    const multi = [
      snapshot(new Date(2026, 7, 19, 23, 0).getTime(), '120.00', {
        infos: [
          { currency: 'CNY', totalBalance: '120.00', grantedBalance: '10.00', toppedUpBalance: '100.00' },
          { currency: 'USD', totalBalance: '8.00', grantedBalance: '0.00', toppedUpBalance: '8.00' },
        ],
      }),
      snapshot(new Date(2026, 7, 20, 13, 0).getTime(), '110.00', {
        infos: [
          { currency: 'CNY', totalBalance: '110.00', grantedBalance: '10.00', toppedUpBalance: '100.00' },
          { currency: 'USD', totalBalance: '7.50', grantedBalance: '0.00', toppedUpBalance: '8.00' },
        ],
      }),
    ]
    expect(computeReport(multi, now, 'CNY').currency).toBe('CNY')
    expect(computeReport(multi, now, 'USD').currentTotal).toBe(7.5)
    expect(computeReport(multi, now, 'USD').windows.find(w => w.key === 'today')?.consumed).toBe(0.5)
    const fallback = computeReport(multi, now, 'EUR')
    expect(fallback.currency).toBe('CNY')
  })

  it('rounds window deltas to two decimals', () => {
    const base = snapshot(new Date(2026, 7, 19, 23, 0).getTime(), '10.005')
    const later = snapshot(new Date(2026, 7, 20, 13, 0).getTime(), '9.995')
    const report = computeReport([base, later], now, 'CNY')
    expect(report.windows.find(w => w.key === 'today')?.consumed).toBe(0.01)
  })

  it('reports an empty report for an empty history', () => {
    const report = computeReport([], now, 'CNY')
    expect(report.historySince).toBeNull()
    expect(report.historyCount).toBe(0)
    expect(report.currentTotal).toBe(0)
    expect(report.windows.every(w => w.consumed === null)).toBe(true)
  })
})
