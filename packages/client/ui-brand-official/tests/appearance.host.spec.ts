import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { liveConfig } from '../../../settings/settings/tests/live-config.ts'
import { plainConfig } from '../../../settings/settings/src/schema.ts'
import { Config, apply } from '../src/index.ts'

describe('Rabb appearance settings', () => {
  it('retains pixel for existing profiles and validates the available artwork', async () => {
    const ctx = new Context()
    const config = await liveConfig(ctx, { Config, apply })
    try {
      expect(plainConfig(config.fiber.config)).toEqual({ artwork: 'pixel' })
      await config.update({ artwork: 'blueprint' })
      expect(plainConfig(config.fiber.config)).toEqual({ artwork: 'blueprint' })
      await config.update({ artwork: 'night' })
      expect(plainConfig(config.fiber.config)).toEqual({ artwork: 'night' })
      await expect(config.update({ artwork: 'missing' })).rejects.toThrow()
    } finally { await config.fiber.dispose() }
  })
})
