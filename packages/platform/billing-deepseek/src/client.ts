/**
 * DeepSeek open-platform balance client: fetches and narrow-validates `/user/balance`.
 * @module @deepseek-ai/dsh-billing-deepseek/client
 */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { BalanceInfo, BalanceSnapshot } from './types.ts'

/** A validated DeepSeek platform API key. */
export type BillingApiKey = Branded<'BillingApiKey'>

/** Error kinds a balance call can fail with, surfaced to the model unchanged. */
export type BalanceFetchErrorKind =
  /** The platform rejected the API key (HTTP 401). */
  | 'invalid-credentials'
  /** The account has no available balance (HTTP 402). */
  | 'insufficient-balance'
  /** Any other non-2xx HTTP status. */
  | 'http'
  /** The request never reached the platform (DNS, TLS, connection). */
  | 'network'
  /** The response body did not match the documented balance shape. */
  | 'malformed'

/** A typed failure of one balance fetch. */
export class BalanceFetchError extends Error {
  /**
   * @param message - model-facing failure text, prefixed with the package name.
   * @param kind - machine-readable failure class.
   * @param status - the HTTP status when the failure is HTTP-shaped.
   */
  constructor(
    message: string,
    readonly kind: BalanceFetchErrorKind,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'BalanceFetchError'
  }
}

const BALANCE_PATH = '/user/balance'

/** The platform's documented decimal-string amount shape (e.g. `"110.00"`). */
const AMOUNT_PATTERN = /^-?\d+(\.\d+)?$/

/**
 * Narrow-validate one `balance_infos` entry.
 * @param value - an entry from the response's `balance_infos` array.
 * @returns the validated {@link BalanceInfo}.
 */
function parseBalanceInfo(value: unknown): BalanceInfo {
  if (typeof value !== 'object' || value === null) {
    throw new BalanceFetchError('billing-deepseek: balance_infos entries must be objects', 'malformed')
  }
  const { currency, total_balance, granted_balance, topped_up_balance } = value as Record<string, unknown>
  if (typeof currency !== 'string' || currency.length === 0) {
    throw new BalanceFetchError('billing-deepseek: balance_infos entries need a non-empty currency', 'malformed')
  }
  const amounts: Array<[string, unknown]> = [
    ['total_balance', total_balance],
    ['granted_balance', granted_balance],
    ['topped_up_balance', topped_up_balance],
  ]
  for (const [field, amount] of amounts) {
    if (typeof amount !== 'string' || !AMOUNT_PATTERN.test(amount)) {
      throw new BalanceFetchError(
        `billing-deepseek: balance_infos ${field} must be a decimal string (got ${JSON.stringify(amount)})`,
        'malformed',
      )
    }
  }
  return {
    currency,
    totalBalance: total_balance as string,
    grantedBalance: granted_balance as string,
    toppedUpBalance: topped_up_balance as string,
  }
}

/**
 * Narrow-validate the documented `/user/balance` response body.
 * @param json - the parsed JSON body.
 * @returns the validated platform fields (without the local fetch timestamp).
 */
export function parseBalanceResponse(json: unknown): { available: boolean; infos: BalanceInfo[] } {
  if (typeof json !== 'object' || json === null) {
    throw new BalanceFetchError('billing-deepseek: balance response must be an object', 'malformed')
  }
  const { is_available, balance_infos } = json as Record<string, unknown>
  if (typeof is_available !== 'boolean') {
    throw new BalanceFetchError('billing-deepseek: balance response needs a boolean is_available', 'malformed')
  }
  if (!Array.isArray(balance_infos)) {
    throw new BalanceFetchError('billing-deepseek: balance response needs a balance_infos array', 'malformed')
  }
  return { available: is_available, infos: balance_infos.map(parseBalanceInfo) }
}

/**
 * Query the platform's balance endpoint once.
 * @param baseUrl - platform origin, e.g. `https://api.deepseek.com`; a trailing slash is tolerated.
 * @param apiKey - the validated platform API key.
 * @param signal - optional caller-owned cancellation for the fetch.
 * @returns the timestamped {@link BalanceSnapshot}.
 */
export async function fetchBalance(
  baseUrl: string,
  apiKey: BillingApiKey,
  signal?: AbortSignal,
): Promise<BalanceSnapshot> {
  const url = `${baseUrl.replace(/\/+$/, '')}${BALANCE_PATH}`
  const init: RequestInit = {
    headers: {
      authorization: `Bearer ${apiKey}`,
      accept: 'application/json',
    },
  }
  if (signal !== undefined) init.signal = signal
  let response: Response
  try {
    response = await fetch(url, init)
  } catch (error) {
    throw new BalanceFetchError(
      `billing-deepseek: balance request to ${url} failed: ${error instanceof Error ? error.message : String(error)}`,
      'network',
    )
  }
  if (response.status === 401) {
    throw new BalanceFetchError('billing-deepseek: the platform rejected the API key (401) — check the configured key', 'invalid-credentials', 401)
  }
  if (response.status === 402) {
    throw new BalanceFetchError('billing-deepseek: the account has no available balance (402)', 'insufficient-balance', 402)
  }
  if (!response.ok) {
    throw new BalanceFetchError(`billing-deepseek: balance request failed with HTTP ${response.status}`, 'http', response.status)
  }
  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new BalanceFetchError('billing-deepseek: balance response was not valid JSON', 'malformed')
  }
  return { at: Date.now(), ...parseBalanceResponse(body) }
}
