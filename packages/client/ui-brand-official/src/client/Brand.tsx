import type { HeroBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SidebarBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
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
export function OfficialSidebarMark({ size, t }: SidebarBrandMarkOwnerProps & PropsLocale<'rabb.brand'>) {
  return <span aria-hidden="true" className={css.sidebarMark} style={{ fontSize: size * 17 / 24 }}>{t('wordmarkRabb')}</span>
}

/**
 * Render the Code name with the same typography as its Rabb wordmark.
 * @param props - Localized brand copy.
 * @returns the official name wordmark.
 */
export function OfficialBrandName({ t }: PropsLocale<'rabb.brand'>) {
  return <span aria-hidden="true" className={css.name}>{t('wordmarkCode')}</span>
}

/**
 * Render the decorative T3 Code pixel artwork behind the sidebar header.
 * @returns the non-interactive header backdrop.
 */
export function OfficialBrandBackdrop() {
  return <div aria-hidden="true" data-sidebar-brand-backdrop className={css.backdrop} />
}
