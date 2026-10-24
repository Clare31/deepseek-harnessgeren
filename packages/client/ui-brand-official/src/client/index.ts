/** Official DeepSeek Harness occupants for the generic browser-brand slots. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { OfficialBrandBackdrop, OfficialBrandMark, OfficialBrandName, OfficialSidebarMark } from './Brand.tsx'
import { SettingsLauncher } from './SettingsLauncher.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Rabb Code sidebar launcher copy. */
    'rabb.brand': 'settings'
  }
}

/** Required services: UI slots and the localized launcher label. */
export const inject = ['slots', 'locale']

/**
 * Fill the sidebar identity, settings-only launcher, and conversation hero.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  if (process.env.DSH_CLIENT_BUILD_PROFILE !== 'official') return
  ctx.effect(() => ctx.locale.register('rabb.brand', { zh: { settings: '设置' }, en: { settings: 'Settings' } }), 'rabb.brand: dictionaries')
  ctx.slots.inject('sidebar.brand.mark', () =>
    ctx.slots.inject('sidebar.brand.name', function* () {
      yield ctx.slots.register({ name: 'sidebar.brand.mark' }, OfficialSidebarMark)
      yield ctx.slots.register({ name: 'sidebar.brand.name' }, OfficialBrandName)
    }))
  ctx.slots.inject('conversation.hero.brand.mark', () =>
    ctx.slots.register({ name: 'conversation.hero.brand.mark' }, OfficialBrandMark))
  ctx.slots.inject('sidebar.brand.backdrop', () =>
    ctx.slots.register({ name: 'sidebar.brand.backdrop' }, OfficialBrandBackdrop))
  ctx.slots.inject('settings.launcher', () =>
    ctx.slots.register({ name: 'settings.launcher', priority: -10, locale: 'rabb.brand' }, SettingsLauncher))
}
