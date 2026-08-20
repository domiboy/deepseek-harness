/**
 * Real-composition guard: the projection registry and the token-cost plugin
 * boot from a test-only cordis.yml through the actual Loader, the fold serves
 * whole-log costs, and the function-plugin namespace stays default-free.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { createMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import * as TokenCostPlugin from '@deepseek-ai/dsh-token-cost'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

async function loadYaml(lines: readonly string[]): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-token-cost-loader-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [...lines, ''].join('\n'))

  context = new Context()
  context.baseUrl = pathToFileURL(root).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-session', SessionStore],
    ['@deepseek-ai/dsh-session-projection', SessionProjectionRegistry],
    ['@deepseek-ai/dsh-token-cost', TokenCostPlugin],
  ])
  context.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof context.loader.internal>
  await context.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await context.loader.await()
  return context
}

describe('real Loader composition', () => {
  it('loads the shipped token-cost shape and serves whole-log costs', async () => {
    const loaded = await loadYaml([
      "- name: '@deepseek-ai/dsh-session'",
      "- name: '@deepseek-ai/dsh-session-projection'",
      "- name: '@deepseek-ai/dsh-token-cost'",
    ])

    const session = loaded.sessions.create(SessionId('composed'))
    session.append('request/header', { header: { config: { provider: 'deepseek', model: 'deepseek-v4-flash' } }, reason: 'initial' })
    session.append('assistant/message', {
      turn: 1,
      step: 0,
      message: createMessage({
        role: 'assistant',
        content: [{ type: 'text', text: 'ok' }],
        source: { kind: 'model', provider: 'deepseek', model: 'deepseek-v4-flash' },
      }),
      usage: { inputTokens: 1000, outputTokens: 500 },
    }, { surfaceOp: 'append', sourceEventSeqs: [] })

    const value = loaded.sessionProjections.snapshot(session).values.tokenCost
    expect(value).toBeDefined()
    if (value === undefined) throw new Error('tokenCost projection missing')
    expect(value.total).toBeCloseTo((1000 * 1.5 + 500 * 4.5) / 1_000_000, 12)
    expect(value.perStep['1:0']).toBeCloseTo(value.total, 12)
  })

  it('honours a config pricing override', async () => {
    const loaded = await loadYaml([
      "- name: '@deepseek-ai/dsh-session'",
      "- name: '@deepseek-ai/dsh-session-projection'",
      "- name: '@deepseek-ai/dsh-token-cost'",
      '  config:',
      '    pricing:',
      '      deepseek-v4-flash:',
      '        inputPerMillion: 2',
      '        outputPerMillion: 8',
      '        cacheReadPerMillion: 0.5',
      '        cacheWritePerMillion: 0',
    ])

    const session = loaded.sessions.create(SessionId('overridden'))
    session.append('request/header', { header: { config: { provider: 'deepseek', model: 'deepseek-v4-flash' } }, reason: 'initial' })
    session.append('assistant/message', {
      turn: 1,
      step: 0,
      message: createMessage({
        role: 'assistant',
        content: [{ type: 'text', text: 'ok' }],
        source: { kind: 'model', provider: 'deepseek', model: 'deepseek-v4-flash' },
      }),
      usage: { inputTokens: 1000, outputTokens: 100 },
    }, { surfaceOp: 'append', sourceEventSeqs: [] })

    const value = loaded.sessionProjections.snapshot(session).values.tokenCost
    expect(value).toBeDefined()
    if (value === undefined) throw new Error('tokenCost projection missing')
    expect(value.total).toBeCloseTo((1000 * 2 + 100 * 8) / 1_000_000, 12)
  })

  it('keeps the function-plugin namespace free of a default export', () => {
    expect('default' in TokenCostPlugin).toBe(false)
  })
})
