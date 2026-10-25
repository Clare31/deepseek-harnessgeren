/** Durable artwork preferences for the Rabb Code browser brand. */
import type { Context, Volatile } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'
import { ARTWORKS, type Artwork } from './appearance-settings.ts'

/** Live appearance preferences. */
export interface Config {
  /** Header artwork, also used on the send button. */
  artwork: Volatile<Artwork>
}

/** Persisted selection; existing installations retain the pixel background. */
export const Config = z.object({ artwork: z.union([...ARTWORKS]).default('pixel').volatile() })

/**
 * Keep the feature-owned appearance page off generated plugin settings pages.
 * @param ctx - Host plugin context.
 */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (child) => { child.effect(() => child.settings.configure({ auto: false }, ctx.fiber)) })
}
