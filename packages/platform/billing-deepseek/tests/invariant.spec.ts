import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as BillingInvariant from '@deepseek-ai/dsh-billing-deepseek/invariant'

describe('billing invariant companion', () => {
  it('registers the explained-empty companion and disposes cleanly', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(BillingInvariant)).resolves.toBeDefined()
    await expect(ctx.fiber.dispose()).resolves.toBeUndefined()
  })
})
