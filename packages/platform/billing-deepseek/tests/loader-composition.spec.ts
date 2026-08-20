/**
 * Real-composition guard for billing-deepseek: the tool registry and the plugin boot from a
 * test-only cordis.yml through the actual Loader + Include path, the API key comes from the
 * inherited environment (the documented no-credentials fallback), the platform is a stubbed
 * global fetch, and the tool executes end to end. pollEnabled: false keeps the poller from
 * running in tests.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { CallId } from '@deepseek-ai/dsh-llm'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import FileSettingsProvider from '@deepseek-ai/dsh-settings-file'
import * as BillingDeepseek from '@deepseek-ai/dsh-billing-deepseek'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

/**
 * Boot a cordis.yml carrying the tool registry and the billing plugin.
 * @param configLines - YAML lines nested under the plugin's `config:` key.
 * @param withSettings - whether a settings-file provider is composed (serves the card namespace).
 * @returns the booted context.
 */
async function boot(configLines: readonly string[], withSettings = false): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-billing-loader-'))
  vi.stubEnv('DSH_HOME', root)
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-agent'",
    "- name: '@deepseek-ai/dsh-system-prompt'",
    "- name: '@deepseek-ai/dsh-tools'",
    ...withSettings ? ["- name: '@deepseek-ai/dsh-settings-file'"] : [],
    "- name: '@deepseek-ai/dsh-billing-deepseek'",
    ...configLines.length > 0 ? ['  config:', ...configLines] : [],
    '',
  ].join('\n'))

  const ctx = new Context()
  context = ctx
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-agent', AgentRegistry],
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-tools', ToolRuntime],
    ['@deepseek-ai/dsh-settings-file', FileSettingsProvider],
    ['@deepseek-ai/dsh-billing-deepseek', BillingDeepseek],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  return ctx
}

/** Concatenate the text content blocks of one tool result. */
function resultText(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

const OK_BODY = {
  is_available: true,
  balance_infos: [
    { currency: 'CNY', total_balance: '110.00', granted_balance: '10.00', topped_up_balance: '100.00' },
  ],
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
}

describe('billing-deepseek real Loader composition through cordis.yml', () => {
  it('boots the tool and reports the platform balance on refresh: true', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, OK_BODY))
    vi.stubGlobal('fetch', fetchMock)
    vi.stubEnv('DEEPSEEK_API_KEY', 'composition-key')
    const ctx = await boot(['    pollEnabled: false'])

    const usage = ctx.tools.schemas().find(s => s.name === 'query_api_usage')
    expect(usage?.description).toContain('DeepSeek open platform')

    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('billing'),
      name: 'query_api_usage',
      arguments: { window: 'today', refresh: true },
    })
    expect(result.isError).toBe(false)
    const text = resultText(result)
    expect(text).toContain('DeepSeek API usage (CNY)')
    expect(text).toContain('¥110.00')
    expect(fetchMock).toHaveBeenCalledWith('https://api.deepseek.com/user/balance', expect.anything())
    const calls = fetchMock.mock.calls as unknown[][]
    const init = calls[0]?.[1] as RequestInit | undefined
    expect(init?.headers).toEqual({ authorization: 'Bearer composition-key', accept: 'application/json' })
  }, 30_000)

  it('reuses the stored history on the next call without refresh', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, OK_BODY))
    vi.stubGlobal('fetch', fetchMock)
    vi.stubEnv('DEEPSEEK_API_KEY', 'composition-key')
    const ctx = await boot(['    pollEnabled: false'])

    const run = (refresh: boolean) => ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('billing-again'),
      name: 'query_api_usage',
      arguments: { window: 'all', refresh },
    })
    await run(true)
    const second = await run(false)
    expect(second.isError).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(resultText(second)).toContain('1 snapshots')
  }, 30_000)

  it('fails loading when pollIntervalMs is below the minimum', async () => {
    await expect(boot(['    pollIntervalMs: 500'])).rejects.toThrow(/pollIntervalMs/)
  }, 30_000)

  it('serves the card settings namespace and the billing service when settings-file is composed', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, OK_BODY))
    vi.stubGlobal('fetch', fetchMock)
    vi.stubEnv('DEEPSEEK_API_KEY', 'composition-key')
    const ctx = await boot(['    pollEnabled: false'], true)

    const descriptors = ctx.settings.describe({ redactSecrets: true })
    expect(descriptors.some(descriptor => String(descriptor.ns) === 'billing-deepseek')).toBe(true)

    const billing = ctx.get('billing')
    expect(billing).toBeDefined()
    const value = await billing!.usage()
    expect(value.ok).toBe(true)
    expect(value.report?.currency).toBe('CNY')
    expect(value.report?.historyCount).toBe(0)
  }, 30_000)
})
