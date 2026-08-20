/**
 * billing domain wire schemas. The report is the plugin's ConsumptionReport
 * projected verbatim; the route validates the whole value at the wire boundary.
 */

import { z } from 'zod'
import type { Wire } from './rpc.schema.ts'
import type { RequestPayload, ResponseValue } from './index.ts'

/** The window keys a report can carry. */
const windowKeySchema = z.enum(['today', 'week', 'month', 'all'])

/** One window's consumption line. */
const windowConsumptionSchema = z.object({
  key: windowKeySchema,
  since: z.string(),
  consumed: z.number().nullable(),
})

/** The plugin's consumption report. */
const reportSchema = z.object({
  fetchedAt: z.number().int().nonnegative(),
  available: z.boolean(),
  currency: z.string(),
  currentTotal: z.number(),
  grantedBalance: z.number(),
  toppedUpBalance: z.number(),
  platformLifetimeConsumption: z.number(),
  windows: z.array(windowConsumptionSchema),
  historySince: z.number().nullable(),
  historyCount: z.number().int().nonnegative(),
})

/** billing.usage request payload: the route carries no arguments. */
export const billingUsageRequestSchema = z.object({}) as unknown as z.ZodType<Wire<RequestPayload<'billing.usage'>>>

/** billing.usage response value. */
export const billingUsageValueSchema = z.object({
  ok: z.boolean(),
  reason: z.string().optional(),
  report: reportSchema.optional(),
}) as unknown as z.ZodType<Wire<ResponseValue<'billing.usage'>>>
