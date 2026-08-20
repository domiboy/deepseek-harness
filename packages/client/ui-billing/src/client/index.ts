/**
 * Billing dashboard plugin, browser half: registers the numbers-only balance
 * card into the plugin configuration section (`settings.plugin.item`, keyed by
 * the host `billing-deepseek` settings namespace), refreshes the report from
 * the `billing.usage` RPC on a 30s interval, and exposes a manual refresh.
 */

// Type-only: the carrier types and the ctx.remote/connection merges.
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the settings card slot declaration lives in ui-settings-plugins.
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import { BillingCard } from './BillingCard.tsx'
import { BillingCardController } from './billing-card-controller.ts'
import { en, NS, zh, type BillingKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The billing dashboard card's copy. */
    'billing-deepseek': BillingKey
  }
}

/** Required services: the presentation registries and the connection api. */
export const inject = ['slots', 'locale', 'connection']

/** Poll cadence for the card's balance refresh. */
export const REFRESH_INTERVAL_MS = 30_000

/**
 * Client plugin body: register the dictionaries, the 30s refresher, and the card.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-billing: dictionaries')

  const api = (ctx.get('connection') as ConnectionHandle).api
  const controller = new BillingCardController(() => api.billing.usage({}))

  ctx.effect(() => {
    const timer = setInterval(() => { controller.refresh() }, REFRESH_INTERVAL_MS)
    controller.refresh()
    return () => { clearInterval(timer) }
  }, 'ui-billing: 30s balance refresh')

  ctx.slots.inject('settings.plugin.item', function* () {
    yield ctx.slots.register(
      { name: 'settings.plugin.item', key: NS, locale: NS, inject: () => controller.inject() },
      BillingCard,
    )
  })
}
