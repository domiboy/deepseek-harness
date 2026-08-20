/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-billing-deepseek`.
 * @module @deepseek-ai/dsh-billing-deepseek/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-billing-deepseek'

/** Cordis companion plugin name. */
export const name = 'billing-deepseek-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: balance snapshots are plugin-owned history-file data validated
 * narrow on load by the store; the plugin appends no session events, so no durable
 * session-event relation exists to check.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
