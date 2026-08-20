/** The DeepSeek billing dashboard card: numbers-only balance/consumption readout. */

import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { BillingCardFace, BillingUsageValue } from './billing-card-controller.ts'
import type { BillingKey } from './locales.ts'
import styles from './BillingCard.module.css'

/** Props the renderer binds for the billing card. */
export type BillingCardProps =
  PropsRuntime<'settings.plugin.item'>
  & PropsLocale<'billing-deepseek'>
  & InjectFace<BillingCardFace>

/** Format a CNY amount for display. */
function yuan(value: number): string {
  return `¥${value.toFixed(2)}`
}

/** One stat row: label on the left, value on the right. */
function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.row}>
      <span className={styles.label}>{label}</span>
      <span className={styles.value}>{value}</span>
    </div>
  )
}

/** Consumption of one window, or the not-available dash. */
function windowValue(report: NonNullable<BillingUsageValue['report']>, t: (key: BillingKey) => string, key: 'today' | 'week' | 'month'): string {
  const consumed = report.windows.find(w => w.key === key)?.consumed
  return consumed === undefined || consumed === null ? t('value.na') : yuan(consumed)
}

/**
 * Render the billing card.
 * @param props - locale copy, the card snapshot, and its refresh action.
 * @returns the card.
 */
export function BillingCard(props: BillingCardProps) {
  const { t } = props
  const state = props.useBillingUsage(snapshot => snapshot)
  const report = state.value?.ok === true ? state.value.report : undefined
  return (
    <section className={styles.card}>
      <header className={styles.header}>
        <h3 className={styles.title}>{t('card.title')}</h3>
        <span className={styles.pollHint}>{t('card.pollHint')}</span>
      </header>

      {state.loading && <p className={styles.status}>{t('card.loading')}</p>}

      {!state.loading && state.error !== undefined && (
        <p className={styles.status} data-error>{t('card.error')}{state.error}</p>
      )}

      {!state.loading && state.error === undefined && state.value !== undefined && !state.value.ok && (
        <p className={styles.status} data-error>{state.value.reason ?? t('card.empty')}</p>
      )}

      {!state.loading && state.error === undefined && state.value?.ok === true && report === undefined && (
        <p className={styles.status}>{t('card.empty')}</p>
      )}

      {!state.loading && state.error === undefined && report !== undefined && (
        <>
          <div className={styles.grid}>
            <StatRow
              label={t('field.available')}
              value={report.available ? t('field.availableYes') : t('field.availableNo')}
            />
            <StatRow label={t('field.balance')} value={yuan(report.currentTotal)} />
            <StatRow label={t('field.granted')} value={yuan(report.grantedBalance)} />
            <StatRow label={t('field.toppedUp')} value={yuan(report.toppedUpBalance)} />
            <StatRow label={t('field.lifetime')} value={yuan(report.platformLifetimeConsumption)} />
            <StatRow label={t('field.today')} value={windowValue(report, t, 'today')} />
            <StatRow label={t('field.week')} value={windowValue(report, t, 'week')} />
            <StatRow label={t('field.month')} value={windowValue(report, t, 'month')} />
            <StatRow
              label={t('field.snapshots')}
              value={`${report.historyCount} ${t('value.snapshotsUnit')}`.trim()}
            />
          </div>
          {report.historyCount === 0 && <p className={styles.status}>{t('card.empty')}</p>}
        </>
      )}

      <footer className={styles.footer}>
        <span className={styles.updated}>
          {t('card.refreshedAt')} {state.refreshedAt > 0 ? new Date(state.refreshedAt).toLocaleTimeString() : '—'}
        </span>
        <button
          type="button"
          className={styles.refresh}
          onClick={() => { props.refresh() }}
          disabled={state.loading}
        >
          {t('card.refresh')}
        </button>
      </footer>
    </section>
  )
}
