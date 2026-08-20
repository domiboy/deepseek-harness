/**
 * DeepSeek open-platform billing plugin: polls `/user/balance` into a local history and
 * exposes the `query_api_usage` tool. Function/namespace plugin — named exports only, no
 * default export (the Loader's unwrapExports would drop `inject`).
 * @module @deepseek-ai/dsh-billing-deepseek
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { dshHomePath, expandHomePath } from '@deepseek-ai/dsh-home-paths'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import { fetchBalance, type BillingApiKey } from './client.ts'
import { startPoller } from './poller.ts'
import { createBillingUsageService, type BillingUsageService } from './service.ts'
import { BillingHistory } from './store.ts'
import { defineUsageTool } from './tool.ts'

export type * from './types.ts'
export type { BillingUsageService } from './service.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The billing service seam the web UI card consumes. */
    billing: BillingUsageService
  }
}

/** Cordis companion plugin name. */
export const name = 'billing-deepseek'
/** The tool registry must be composed before this plugin registers its tool. */
export const inject = ['tools']

/** Settings namespace under which the web UI card is dispatched. */
export const SETTINGS_NAMESPACE = 'billing-deepseek'

/** Default platform origin. */
export const DEFAULT_BASE_URL = 'https://api.deepseek.com'
/** Default credential/env name holding the platform API key. */
export const DEFAULT_API_KEY_ENV = 'DEEPSEEK_API_KEY'
/** Default poll interval: five minutes. */
export const DEFAULT_POLL_INTERVAL_MS = 300_000
/** Upper bound on the poll interval (one day); `setInterval` rejects larger delays anyway. */
export const MAX_POLL_INTERVAL_MS = 86_400_000

/** Plugin configuration. */
export interface Config {
  /** Platform origin, e.g. `https://api.deepseek.com`. */
  baseUrl: string
  /** Environment variable or credential reference holding the API key. */
  apiKeyEnv: string
  /** Whether the background balance poller runs. */
  pollEnabled: boolean
  /** Milliseconds between balance polls; the first poll runs at startup. */
  pollIntervalMs: number
  /** Optional currency filter for reports; falls back to the platform's first currency. */
  currency?: string
  /** History file path; supports `~`; defaults to the harness home. */
  historyPath?: string
}

/** Schemastery configuration for the billing plugin. */
export const Config: z<Config> = z.object({
  baseUrl: z.string().default(DEFAULT_BASE_URL),
  apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_API_KEY_ENV),
  pollEnabled: z.boolean().default(true),
  pollIntervalMs: z.number().step(1).min(1000).max(MAX_POLL_INTERVAL_MS).default(DEFAULT_POLL_INTERVAL_MS),
  currency: z.string(),
  historyPath: z.string(),
})

/** Resolve a non-empty API key for the configured reference; failures fail loud. */
async function resolveApiKey(ctx: Context, config: Config): Promise<BillingApiKey> {
  const ref = credentialRef(config.apiKeyEnv)
  const credentials = ctx.get('credentials')
  let key: string | undefined
  if (credentials !== undefined) {
    const hit = await credentials.resolve(ref)
    key = hit?.value
  } else {
    const ambient = launchEnvironmentOf(ctx).get(ref)
    key = ambient?.value
  }
  if (key === undefined || key.trim().length === 0) {
    throw new Error(
      `billing-deepseek: no API key; store ${config.apiKeyEnv} through the credentials service, `
      + 'or export it in the launching environment',
    )
  }
  return key.trim() as BillingApiKey
}

/**
 * Register the billing plugin: the balance poller (when enabled) and the `query_api_usage`
 * tool, both sharing one {@link BillingHistory}.
 * @param ctx - registrant context carrying the tool registry.
 * @param config - validated plugin configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const historyPath = config.historyPath !== undefined
    ? expandHomePath(config.historyPath)
    : dshHomePath('billing-history.jsonl')
  const history = new BillingHistory(historyPath)
  const resolve = (): Promise<BillingApiKey> => resolveApiKey(ctx, config)

  // The web UI card and the apiproxy `billing.usage` route read through this
  // seam; the tool shares the same history instance below.
  ctx.provide('billing', createBillingUsageService(history, config.currency))

  // The settings tab dispatches the plugin card only for namespaces the Host
  // serves; the (empty) section — registered through the canonical inject-based
  // helper, so it appears whenever a settings provider is composed — is what
  // makes the card show. The card is read-only: no fields are consumed here.
  installSettingsSection(ctx, settingsNamespace(SETTINGS_NAMESPACE), z.object({}), {}, {
    setSource: () => {},
    onChange: () => {},
  })

  if (config.pollEnabled) {
    startPoller(ctx, {
      intervalMs: config.pollIntervalMs,
      fetchOnce: async () => fetchBalance(config.baseUrl, await resolve()),
      onSnapshot: snapshot => history.append(snapshot),
      onError: (error) => { ctx.logger.warn('billing-deepseek: balance poll failed', error) },
    })
  }

  const toolDeps: {
    baseUrl: string
    resolveApiKey: () => Promise<BillingApiKey>
    history: BillingHistory
    currency?: string
  } = { baseUrl: config.baseUrl, resolveApiKey: resolve, history }
  if (config.currency !== undefined) toolDeps.currency = config.currency
  ctx.tools.register(defineUsageTool(toolDeps))
}
