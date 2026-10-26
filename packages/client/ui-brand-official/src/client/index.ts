/** Official DeepSeek Harness occupants for the generic browser-brand slots. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
import { APPEARANCE_NAMESPACE, type AppearanceSettings } from '../appearance-settings.ts'
import { AppearanceSection } from './AppearanceSection.tsx'
import { PIXEL_ARTWORK } from './pixel-artwork.ts'
import { OfficialBrandBackdrop, OfficialBrandMark, OfficialBrandName, OfficialSidebarMark } from './Brand.tsx'
import './Artwork.module.css'
import { SettingsLauncher } from './SettingsLauncher.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Rabb Code sidebar launcher copy. */
    'rabb.brand': 'settings' | 'appearance' | 'description' | 'background' | 'pixel' | 'blueprint' | 'night' | 'saveError' | 'unavailable' | 'wordmarkRabb' | 'wordmarkCode'
  }
}

/** Required services: UI slots and the localized launcher label. */
export const inject = ['slots', 'locale', 'configForms', 'remote', 'theme']

/**
 * Fill the sidebar identity, settings-only launcher, and conversation hero.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  if (process.env.DSH_CLIENT_BUILD_PROFILE !== 'official') return
  ctx.effect(() => ctx.locale.register('rabb.brand', {
    zh: { wordmarkRabb: 'Rabb', wordmarkCode: 'Code', settings: '设置', appearance: '外观设置', description: '选择左上角背景，发送按钮会同步使用相同风格', background: '左上角背景', pixel: '像素', blueprint: '蓝色 Blueprint', night: 'Night 星空', saveError: '保存失败，请重试', unavailable: '暂时无法修改外观，请检查连接后重试' },
    en: { wordmarkRabb: 'Rabb', wordmarkCode: 'Code', settings: 'Settings', appearance: 'Appearance', description: 'Choose a header background. The send button follows the same artwork.', background: 'Header background', pixel: 'Pixel', blueprint: 'Blue Blueprint', night: 'Night', saveError: 'Could not save. Try again.', unavailable: 'Appearance is unavailable. Check your connection and try again.' },
  }), 'rabb.brand: dictionaries')
  const appearance = ctx.configForms.get<AppearanceSettings>(APPEARANCE_NAMESPACE)
  ctx.effect(() => {
    const pixelUrl = URL.createObjectURL(new Blob([PIXEL_ARTWORK], { type: 'image/svg+xml' }))
    let removeTokens: (() => void) | undefined
    let selected: AppearanceSettings['artwork'] | undefined
    const sync = (): void => {
      const artwork = appearance.getSnapshot().value?.artwork ?? 'pixel'
      if (artwork === selected) return
      selected = artwork
      removeTokens?.()
      const image = `var(--rabb-artwork-${artwork})`
      const send = `var(--rabb-send-${artwork}, ${image})`
      removeTokens = ctx.theme.overrideTokens('rabb.appearance', {
        '--rabb-artwork-pixel': { light: `url("${pixelUrl}")`, dark: `url("${pixelUrl}")` },
        '--rabb-header-image': { light: image, dark: image },
        '--rabb-brand-font-family': { light: '"Rabb Brand", sans-serif', dark: '"Rabb Brand", sans-serif' },
        '--dsw-specific-composer-send-image': { light: send, dark: send },
        '--rabb-artwork-size': { light: artwork === 'pixel' ? 'cover' : 'auto 100%', dark: artwork === 'pixel' ? 'cover' : 'auto 100%' },
        '--rabb-artwork-position': { light: artwork === 'pixel' ? 'center bottom' : 'left center', dark: artwork === 'pixel' ? 'center bottom' : 'left center' },
        '--dsw-specific-composer-send-size': { light: artwork === 'pixel' ? 'cover' : 'auto 100%', dark: artwork === 'pixel' ? 'cover' : 'auto 100%' },
      })
    }
    const unsubscribe = appearance.subscribe(sync)
    sync()
    return () => { unsubscribe(); removeTokens?.(); URL.revokeObjectURL(pixelUrl) }
  }, 'rabb.brand: appearance tokens')
  const t = ctx.locale.bind('rabb.brand')
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'rabb-appearance', order: 5, label: () => t('appearance'), locale: 'rabb.brand',
    inject: () => ({ hooks: { appearance }, setArtwork: (artwork: AppearanceSettings['artwork']) => appearance.set('artwork', artwork) }),
  }, AppearanceSection))
  ctx.slots.inject('sidebar.brand.mark', () =>
    ctx.slots.inject('sidebar.brand.name', function* () {
      yield ctx.slots.register({ name: 'sidebar.brand.mark', locale: 'rabb.brand' }, OfficialSidebarMark)
      yield ctx.slots.register({ name: 'sidebar.brand.name', locale: 'rabb.brand' }, OfficialBrandName)
    }))
  ctx.slots.inject('conversation.hero.brand.mark', () =>
    ctx.slots.register({ name: 'conversation.hero.brand.mark' }, OfficialBrandMark))
  ctx.slots.inject('sidebar.brand.backdrop', () =>
    ctx.slots.register({ name: 'sidebar.brand.backdrop' }, OfficialBrandBackdrop))
  ctx.slots.inject('settings.launcher', () =>
    ctx.slots.register({ name: 'settings.launcher', priority: -10, locale: 'rabb.brand' }, SettingsLauncher))
}
