/** Persistent Rabb Code header and composer artwork selection. */

/** Built-in artwork identifiers accepted by the Host. */
export const ARTWORKS = ['pixel', 'blueprint', 'night'] as const

/** Selected header artwork, shared with the send button. */
export type Artwork = typeof ARTWORKS[number]

/** Settings namespace supplied by the official brand plugin. */
export const APPEARANCE_NAMESPACE = 'ui-brand-official'

/** Host-resolved appearance values. */
export interface AppearanceSettings {
  /** Artwork used by the header and send button. */
  artwork: Artwork
}
