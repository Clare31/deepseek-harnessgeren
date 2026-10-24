import type { HeroBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SidebarBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import css from './Brand.module.css'

/**
 * Render the official mark with the presentation requested by its host surface.
 * @param props - Host-supplied mark presentation.
 * @returns the rounded monochrome rabbit mark.
 */
export function OfficialBrandMark({ size, className }: HeroBrandMarkOwnerProps) {
  return <span aria-hidden="true" className={[css.mark, className].filter(Boolean).join(' ')} style={{ width: size, height: size }} />
}

/**
 * Render the Rabb sidebar wordmark at the reference sidebar's cap height.
 * @param props - Host-supplied mark presentation.
 * @returns the Rabb wordmark.
 */
export function OfficialSidebarMark({ size }: SidebarBrandMarkOwnerProps) {
  return <span aria-hidden="true" className={css.sidebarMark} style={{ width: size * 36 / 24, height: size * 20 / 24 }} />
}

/**
 * Render the Code name artwork independently of its Rabb wordmark.
 * @returns the official name wordmark.
 */
export function OfficialBrandName() {
  return <span aria-hidden="true" className={css.name} />
}

/**
 * Render the decorative T3 Code pixel artwork behind the sidebar header.
 * @returns the non-interactive header backdrop.
 */
export function OfficialBrandBackdrop() {
  return <div aria-hidden="true" data-sidebar-brand-backdrop className={css.backdrop} />
}
