import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BalanceFetchError,
  fetchBalance,
  parseBalanceResponse,
  type BillingApiKey,
} from '@deepseek-ai/dsh-billing-deepseek/client'

const KEY = 'sk-billing-test' as BillingApiKey

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
}

const OK_BODY = {
  is_available: true,
  balance_infos: [
    {
      currency: 'CNY',
      total_balance: '110.00',
      granted_balance: '10.00',
      topped_up_balance: '100.00',
    },
  ],
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchBalance', () => {
  it('parses a successful balance response into a timestamped snapshot', async () => {
    const before = Date.now()
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, OK_BODY)))
    const snapshot = await fetchBalance('https://api.deepseek.com', KEY)
    expect(snapshot.at).toBeGreaterThanOrEqual(before)
    expect(snapshot.available).toBe(true)
    expect(snapshot.infos).toEqual([
      { currency: 'CNY', totalBalance: '110.00', grantedBalance: '10.00', toppedUpBalance: '100.00' },
    ])
  })

  it('queries /user/balance with the bearer key, tolerating a trailing slash', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, OK_BODY))
    vi.stubGlobal('fetch', fetchMock)
    await fetchBalance('https://api.deepseek.com/', KEY)
    expect(fetchMock).toHaveBeenCalledWith('https://api.deepseek.com/user/balance', expect.anything())
    const calls = fetchMock.mock.calls as unknown[][]
    const init = calls[0]?.[1] as RequestInit | undefined
    expect(init?.headers).toEqual({ authorization: `Bearer ${KEY}`, accept: 'application/json' })
  })

  it.each([
    [401, 'invalid-credentials'],
    [402, 'insufficient-balance'],
    [500, 'http'],
    [429, 'http'],
  ])('maps HTTP %s to kind %s', async (status, kind) => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(status, {})))
    const promise = fetchBalance('https://api.deepseek.com', KEY)
    await expect(promise).rejects.toBeInstanceOf(BalanceFetchError)
    await expect(promise).rejects.toMatchObject({ kind, status })
  })

  it('wraps network failures as kind network', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed') }))
    const promise = fetchBalance('https://api.deepseek.com', KEY)
    await expect(promise).rejects.toMatchObject({ kind: 'network' })
    await expect(promise).rejects.toThrow(/fetch failed/)
  })

  it('rejects a non-JSON 200 body as malformed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, {})).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => { throw new SyntaxError('bad json') },
    } as unknown as Response))
    await expect(fetchBalance('https://api.deepseek.com', KEY)).rejects.toMatchObject({ kind: 'malformed' })
  })
})

describe('parseBalanceResponse', () => {
  it('accepts the documented shape', () => {
    expect(parseBalanceResponse(OK_BODY)).toEqual({
      available: true,
      infos: [
        { currency: 'CNY', totalBalance: '110.00', grantedBalance: '10.00', toppedUpBalance: '100.00' },
      ],
    })
  })

  it.each([
    ['a non-object', 'not-json'],
    ['a missing is_available', { balance_infos: [] }],
    ['a non-boolean is_available', { is_available: 'yes', balance_infos: [] }],
    ['a missing balance_infos', { is_available: true }],
    ['a non-array balance_infos', { is_available: true, balance_infos: {} }],
  ])('rejects %s', (_label, body) => {
    expect(() => parseBalanceResponse(body)).toThrow(BalanceFetchError)
  })

  it.each([
    ['a non-object entry', [42]],
    ['a missing currency', [{ total_balance: '1.00', granted_balance: '0.00', topped_up_balance: '1.00' }]],
    ['a numeric amount', [{ currency: 'CNY', total_balance: 110, granted_balance: '0.00', topped_up_balance: '110.00' }]],
    ['a non-decimal amount', [{ currency: 'CNY', total_balance: 'abc', granted_balance: '0.00', topped_up_balance: '110.00' }]],
    ['a missing topped_up_balance', [{ currency: 'CNY', total_balance: '1.00', granted_balance: '0.00' }]],
  ])('rejects an entry with %s', (_label, infos) => {
    expect(() => parseBalanceResponse({ is_available: true, balance_infos: infos })).toThrow(BalanceFetchError)
  })
})
