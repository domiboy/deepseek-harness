/** The ui-billing node half is an inert apply so the Loader row resolves. */

import { describe, it } from 'vitest'
import { apply } from '../src/index.ts'

describe('ui-billing node half', () => {
  it('is an inert apply', () => {
    apply()
  })
})
