/**
 * The `query_api_usage` tool consumer: balance + consumption report on demand.
 * @module @deepseek-ai/dsh-billing-deepseek/tool
 */

import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { BillingApiKey } from './client.ts'
import { fetchBalance } from './client.ts'
import { computeReport, type BillingHistory } from './store.ts'
import type { ConsumptionReport, WindowKey } from './types.ts'

/** Wiring the tool needs from the plugin entry. */
export interface UsageToolDeps {
  /** Platform origin passed to {@link fetchBalance}. */
  baseUrl: string
  /** Resolve the platform API key; failures surface to the model. */
  resolveApiKey: () => Promise<BillingApiKey>
  /** Shared local balance history (the poller writes it too). */
  history: BillingHistory
  /** Optional currency filter; absent falls back to the platform's first currency. */
  currency?: string
}

const WINDOW_KEYS: readonly WindowKey[] = ['today', 'week', 'month', 'all']

/** Model-facing description of the tool. */
const DESCRIPTION = 'Query the current balance and API consumption of the DeepSeek open '
  + 'platform account. Returns the remaining balance, granted and topped-up balances, platform '
  + 'lifetime consumption (granted + topped-up − total), and consumption over the requested '
  + 'window derived from locally tracked balance snapshots. Consumption is a balance delta and '
  + 'is negative when a top-up outpaced spending. Pass refresh: true to query the platform '
  + 'immediately; otherwise the latest polled snapshot is used.'

/** Format one amount for display; null renders as not available. */
function formatAmount(value: number | null): string {
  return value === null ? 'n/a' : `¥${value.toFixed(2)}`
}

/** Build the compact terminal-style report text. */
function renderReport(value: ConsumptionReport): string {
  const lines = [
    `DeepSeek API usage (${value.currency}) — fetched at ${new Date(value.fetchedAt).toISOString()}`,
    `Account available: ${value.available ? 'yes' : 'no'}`,
    `Balance: ${formatAmount(value.currentTotal)} (granted ${formatAmount(value.grantedBalance)} + topped-up ${formatAmount(value.toppedUpBalance)})`,
    `Platform lifetime consumption: ${formatAmount(value.platformLifetimeConsumption)}`,
    value.historySince === null
      ? 'No local balance history yet.'
      : `Local tracked consumption (since ${new Date(value.historySince).toISOString()}, ${value.historyCount} snapshots):`,
    ...value.windows.map(window => `  ${window.key}: ${formatAmount(window.consumed)}`),
  ]
  return lines.join('\n')
}

/**
 * Define the `query_api_usage` tool.
 * @param deps - wiring for key resolution, fetching, and history.
 * @returns the registered {@link ToolDefinition} object.
 */
export function defineUsageTool(deps: UsageToolDeps): ToolDefinition {
  return defineTool({
    name: 'query_api_usage',
    description: DESCRIPTION,
    parameters: {
      window: {
        type: 'string',
        enum: [...WINDOW_KEYS],
        default: 'today',
        description: 'Which consumption window to report: today, week, month, or all tracked history.',
      },
      refresh: {
        type: 'boolean',
        default: false,
        description: 'Query the platform now instead of using the latest polled snapshot.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          fetchedAt: { type: 'integer', required: true, description: 'Epoch milliseconds when the balance was read.' },
          available: { type: 'boolean', required: true, description: 'Whether the account may currently make API calls.' },
          currency: { type: 'string', required: true, description: 'The reported currency.' },
          currentTotal: { type: 'number', required: true, description: 'Current remaining balance.' },
          grantedBalance: { type: 'number', required: true, description: 'Cumulative granted balance.' },
          toppedUpBalance: { type: 'number', required: true, description: 'Cumulative topped-up balance.' },
          platformLifetimeConsumption: { type: 'number', required: true, description: 'Granted + topped-up − total.' },
          windows: {
            type: 'array',
            required: true,
            description: 'Per-window consumption since each window start.',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                key: { type: 'string', required: true, enum: [...WINDOW_KEYS], description: 'The window key.' },
                since: { type: 'string', required: true, description: 'ISO timestamp of the window start baseline.' },
                consumed: {
                  oneOf: [
                    { type: 'number' },
                    { type: 'null' },
                  ],
                  required: true,
                  description: 'Baseline minus current balance; null when no snapshot predates the window.',
                },
              },
            },
          },
          historySince: {
            oneOf: [
              { type: 'integer' },
              { type: 'null' },
            ],
            required: true,
            description: 'Epoch milliseconds of the oldest tracked snapshot, or null when history is empty.',
          },
          historyCount: { type: 'integer', required: true, description: 'Number of tracked snapshots.' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: renderReport(value),
      }],
    },
    async execute(args, exec) {
      const window = args.window ?? 'today'
      if (!WINDOW_KEYS.includes(window)) {
        throw new Error(`billing-deepseek: unknown window ${JSON.stringify(args.window)}`)
      }
      const refresh = args.refresh === true
      let snapshots = await deps.history.load()
      if (refresh || snapshots.length === 0) {
        const apiKey = await deps.resolveApiKey()
        const snapshot = await fetchBalance(deps.baseUrl, apiKey, exec.signal)
        await deps.history.append(snapshot)
        snapshots = await deps.history.load()
      }
      const current = snapshots.at(-1)
      if (current === undefined) {
        throw new Error('billing-deepseek: no balance data available and the platform query produced none')
      }
      const currency = deps.currency ?? current.infos[0]?.currency ?? 'CNY'
      return computeReport(snapshots, Date.now(), currency)
    },
    presentCall: args => ({
      card: 'generic',
      title: 'Query DeepSeek API usage',
      kind: 'other',
      rawInput: {
        window: args.window ?? 'today',
        refresh: args.refresh === true,
      },
    }),
  })
}
