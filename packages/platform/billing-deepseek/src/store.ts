/**
 * Local balance history (append-only JSONL) and window-consumption computation.
 * @module @deepseek-ai/dsh-billing-deepseek/store
 */

import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { BalanceInfo, BalanceSnapshot, ConsumptionReport, WindowConsumption, WindowKey } from './types.ts'

/** Parse one persisted JSONL line back into a snapshot. */
function parseLine(line: string): BalanceSnapshot {
  let json: unknown
  try {
    json = JSON.parse(line)
  } catch {
    throw new Error('billing-deepseek: history line is not valid JSON')
  }
  if (typeof json !== 'object' || json === null) {
    throw new Error('billing-deepseek: history line must be an object')
  }
  const { at, available, infos } = json as Record<string, unknown>
  if (typeof at !== 'number') {
    throw new Error('billing-deepseek: history line lacks a numeric `at` timestamp')
  }
  if (typeof available !== 'boolean') {
    throw new Error('billing-deepseek: history line needs a boolean `available`')
  }
  if (!Array.isArray(infos)) {
    throw new Error('billing-deepseek: history line needs an `infos` array')
  }
  const parsedInfos = infos.map((value): BalanceInfo => {
    if (typeof value !== 'object' || value === null) {
      throw new Error('billing-deepseek: history infos entries must be objects')
    }
    const { currency, totalBalance, grantedBalance, toppedUpBalance } = value as Record<string, unknown>
    for (const [field, amount] of [
      ['currency', currency],
      ['totalBalance', totalBalance],
      ['grantedBalance', grantedBalance],
      ['toppedUpBalance', toppedUpBalance],
    ] as const) {
      if (typeof amount !== 'string' || amount.length === 0) {
        throw new Error(`billing-deepseek: history infos ${field} must be a non-empty string`)
      }
    }
    return {
      currency: currency as string,
      totalBalance: totalBalance as string,
      grantedBalance: grantedBalance as string,
      toppedUpBalance: toppedUpBalance as string,
    }
  })
  return { at, available, infos: parsedInfos }
}

/**
 * Append-only balance history persisted as one JSON line per snapshot. A torn trailing
 * line (a crash during append) is dropped on load; corruption anywhere else fails loud.
 */
export class BillingHistory {
  /**
   * @param path - absolute history file path.
   */
  constructor(private readonly path: string) {}

  /**
   * Read every stored snapshot, oldest first.
   * @returns the parsed snapshots; an empty list when the file does not exist yet.
   */
  async load(): Promise<BalanceSnapshot[]> {
    let raw: string
    try {
      raw = await readFile(this.path, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
    const lines = raw.split('\n')
    if (lines.at(-1) === '') lines.pop()
    const snapshots: BalanceSnapshot[] = []
    for (const [index, line] of lines.entries()) {
      if (line.trim() === '') continue
      try {
        snapshots.push(parseLine(line))
      } catch (error) {
        if (index === lines.length - 1) break
        throw error
      }
    }
    return snapshots
  }

  /**
   * Persist one snapshot by appending a line.
   * @param snapshot - the snapshot to record.
   */
  async append(snapshot: BalanceSnapshot): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true })
    await appendFile(this.path, `${JSON.stringify(snapshot)}\n`, 'utf8')
  }

  /**
   * The most recent stored snapshot.
   * @returns the latest snapshot, or undefined when history is empty.
   */
  async latest(): Promise<BalanceSnapshot | undefined> {
    const all = await this.load()
    return all.at(-1)
  }
}

/**
 * Round a number to two decimals, matching the platform's cent-like amounts.
 * @param value - the raw computed delta.
 * @returns the value rounded to two decimal places.
 */
export function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/** Parse a decimal-string amount; malformed strings fail loud. */
function amount(value: string): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    throw new Error(`billing-deepseek: amount ${JSON.stringify(value)} is not finite`)
  }
  return parsed
}

/** Pick the named currency's line, falling back to the first line for mixed histories. */
function balanceOf(snapshot: BalanceSnapshot, currency: string): BalanceInfo | undefined {
  return snapshot.infos.find(info => info.currency === currency) ?? snapshot.infos[0]
}

/** Milliseconds since the local-time start of the day containing `now`. */
function startOfDay(now: number): number {
  const date = new Date(now)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

/** Milliseconds since the local-time start of the Monday-based week containing `now`. */
function startOfWeek(now: number): number {
  const date = new Date(startOfDay(now))
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7))
  return date.getTime()
}

/** Milliseconds since the local-time start of the month containing `now`. */
function startOfMonth(now: number): number {
  const date = new Date(startOfDay(now))
  date.setDate(1)
  return date.getTime()
}

const WINDOW_STARTS: Record<Exclude<WindowKey, 'all'>, (now: number) => number> = {
  today: startOfDay,
  week: startOfWeek,
  month: startOfMonth,
}

/**
 * Consumption attributable to one dated window: the latest baseline snapshot at or before
 * the window start, minus the current snapshot. Null when no snapshot predates the window
 * start (tracking began after the window opened), so the window cannot be attributed.
 * @param sorted - snapshots ascending by `at`.
 * @param windowStart - epoch milliseconds of the window start.
 * @param currency - currency whose totals are compared.
 * @returns the rounded consumed amount, or null when no baseline exists.
 */
function consumptionInWindow(sorted: readonly BalanceSnapshot[], windowStart: number, currency: string): number | null {
  let baseline: BalanceSnapshot | undefined
  for (const snapshot of sorted) {
    if (snapshot.at <= windowStart) baseline = snapshot
    else break
  }
  if (baseline === undefined) return null
  const current = sorted.at(-1) ?? baseline
  const baseTotal = balanceOf(baseline, currency)
  const currentTotal = balanceOf(current, currency)
  if (baseTotal === undefined || currentTotal === undefined) return null
  return round2(amount(baseTotal.totalBalance) - amount(currentTotal.totalBalance))
}

/**
 * Build the usage report from the stored history.
 * @param snapshots - stored snapshots in any order.
 * @param now - report time in epoch milliseconds (injectable for tests).
 * @param currency - the reported currency; absent or missing from the data falls back to
 * the platform's first currency line.
 * @returns the computed {@link ConsumptionReport}.
 */
export function computeReport(snapshots: readonly BalanceSnapshot[], now: number, currency: string): ConsumptionReport {
  const sorted = [...snapshots].sort((a, b) => a.at - b.at)
  const current = sorted.at(-1)
  const oldest = sorted[0]
  const historySince = current === undefined || oldest === undefined ? null : oldest.at
  const effectiveCurrency = current !== undefined ? balanceOf(current, currency)?.currency ?? currency : currency
  const info = current === undefined ? undefined : balanceOf(current, effectiveCurrency)
  const windows: WindowConsumption[] = (['today', 'week', 'month'] as const).map(key => ({
    key,
    since: new Date(WINDOW_STARTS[key](now)).toISOString(),
    consumed: consumptionInWindow(sorted, WINDOW_STARTS[key](now), effectiveCurrency),
  }))
  if (current !== undefined && oldest !== undefined) {
    const firstTotal = balanceOf(oldest, effectiveCurrency)
    const currentInfo = balanceOf(current, effectiveCurrency)
    windows.push({
      key: 'all',
      since: new Date(oldest.at).toISOString(),
      consumed: firstTotal === undefined || currentInfo === undefined
        ? null
        : round2(amount(firstTotal.totalBalance) - amount(currentInfo.totalBalance)),
    })
  } else {
    windows.push({ key: 'all', since: '', consumed: null })
  }
  return {
    fetchedAt: current?.at ?? now,
    available: current?.available ?? false,
    currency: effectiveCurrency,
    currentTotal: info === undefined ? 0 : amount(info.totalBalance),
    grantedBalance: info === undefined ? 0 : amount(info.grantedBalance),
    toppedUpBalance: info === undefined ? 0 : amount(info.toppedUpBalance),
    platformLifetimeConsumption: info === undefined
      ? 0
      : round2(amount(info.grantedBalance) + amount(info.toppedUpBalance) - amount(info.totalBalance)),
    windows,
    historySince,
    historyCount: sorted.length,
  }
}
