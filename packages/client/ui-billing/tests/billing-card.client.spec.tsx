// @vitest-environment jsdom
/** Billing card presentation: numbers, dashes, failure reasons, and the refresh action. */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BillingCard, type BillingCardProps } from '../src/client/BillingCard.tsx'
import type { BillingCardState, BillingUsageValue } from '../src/client/billing-card-controller.ts'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

function t(key: keyof typeof zh): string {
  return zh[key]
}

const REPORT = {
  fetchedAt: 1700000000000,
  available: true,
  currency: 'CNY',
  currentTotal: 110,
  grantedBalance: 10,
  toppedUpBalance: 100,
  platformLifetimeConsumption: 0,
  windows: [
    { key: 'today' as const, since: '2026-08-20T00:00:00.000Z', consumed: 12 },
    { key: 'week' as const, since: '2026-08-17T00:00:00.000Z', consumed: 40 },
    { key: 'month' as const, since: '2026-08-01T00:00:00.000Z', consumed: 90 },
    { key: 'all' as const, since: '2026-07-31T15:00:00.000Z', consumed: 90 },
  ],
  historySince: 1700000000000,
  historyCount: 4,
}

function valueOf(value: BillingUsageValue): BillingCardProps {
  const refresh = vi.fn()
  const props = {
    t,
    refresh,
    useBillingUsage: (selector: (state: BillingCardState) => unknown) => selector({
      loading: false,
      value,
      refreshedAt: 1700000000000,
    }),
  } as unknown as BillingCardProps
  return { ...props, refresh }
}

describe('BillingCard', () => {
  it('shows the loading state', () => {
    render(<BillingCard {...{
      t,
      refresh: vi.fn(),
      useBillingUsage: (selector: (state: BillingCardState) => unknown) => selector({ loading: true, refreshedAt: 0 }),
    } as unknown as BillingCardProps} />)
    expect(screen.getByText('加载中…')).toBeTruthy()
  })

  it('shows the failure reason from a rejected RPC', () => {
    render(<BillingCard {...{
      t,
      refresh: vi.fn(),
      useBillingUsage: (selector: (state: BillingCardState) => unknown) => selector({ loading: false, error: 'billing.usage failed: boom', refreshedAt: 1 }),
    } as unknown as BillingCardProps} />)
    expect(screen.getByText('获取失败：billing.usage failed: boom')).toBeTruthy()
  })

  it('shows the not-composed reason when value.ok is false', () => {
    render(<BillingCard {...valueOf({ ok: false, reason: '未装配 billing-deepseek 插件' })} />)
    expect(screen.getByText('未装配 billing-deepseek 插件')).toBeTruthy()
  })

  it('shows the empty hint when value.ok is false without a reason', () => {
    render(<BillingCard {...valueOf({ ok: false })} />)
    expect(screen.getByText('暂无计费数据')).toBeTruthy()
  })

  it('renders the balance numbers, window consumption, and snapshot count', () => {
    render(<BillingCard {...valueOf({ ok: true, report: REPORT })} />)
    expect(screen.getByText('DeepSeek API 消费')).toBeTruthy()
    expect(screen.getByText('可用')).toBeTruthy()
    expect(screen.getByText('¥110.00')).toBeTruthy()
    expect(screen.getByText('¥12.00')).toBeTruthy()
    expect(screen.getByText('¥40.00')).toBeTruthy()
    expect(screen.getByText('¥90.00')).toBeTruthy()
    expect(screen.getByText('4 条')).toBeTruthy()
  })

  it('renders a dash for an unattributable window', () => {
    const report = { ...REPORT, windows: REPORT.windows.map(w => ({ ...w, consumed: null })) }
    render(<BillingCard {...valueOf({ ok: true, report })} />)
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(3)
  })

  it('renders the unavailable account state', () => {
    render(<BillingCard {...valueOf({ ok: true, report: { ...REPORT, available: false } })} />)
    expect(screen.getByText('不可用')).toBeTruthy()
  })

  it('shows the empty hint when the report itself is absent', () => {
    render(<BillingCard {...valueOf({ ok: true })} />)
    expect(screen.getByText('暂无计费数据')).toBeTruthy()
  })

  it('shows the empty hint when the history has no snapshots yet', () => {
    const report = { ...REPORT, historyCount: 0, currentTotal: 0, windows: REPORT.windows.map(w => ({ ...w, consumed: null })) }
    render(<BillingCard {...valueOf({ ok: true, report })} />)
    expect(screen.getByText('暂无计费数据')).toBeTruthy()
  })

  it('disables the refresh button while loading', () => {
    render(<BillingCard {...{
      t,
      refresh: vi.fn(),
      useBillingUsage: (selector: (state: BillingCardState) => unknown) => selector({ loading: true, refreshedAt: 0 }),
    } as unknown as BillingCardProps} />)
    const button = document.querySelector('button') as HTMLButtonElement
    expect(button.disabled).toBe(true)
  })

  it('refresh button triggers a refresh when idle', () => {
    const props = valueOf({ ok: true, report: REPORT })
    render(<BillingCard {...props} />)
    fireEvent.click(screen.getByRole('button'))
    expect(props.refresh).toHaveBeenCalledTimes(1)
  })
})
