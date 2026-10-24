import { IconSettingsOutlineMedium, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import css from './SettingsLauncher.module.css'

/** Localized settings-only launcher supplied to the settings shell. */
export type SettingsLauncherProps = PropsRuntime<'settings.launcher'> & PropsLocale<'rabb.brand'>

/**
 * Open settings directly from the sidebar, including its collapsed rail.
 * @param props - Shell-owned navigation, geometry, shortcut, and localized label.
 * @returns the settings button without account or feedback actions.
 */
export function SettingsLauncher({ wide, settingsOpen, openSettings, settingsShortcut, t }: SettingsLauncherProps) {
  return <Tooltip disabled={settingsOpen} label={t('settings')} shortcutKeys={settingsShortcut?.keys}>
    <button type="button" className={css.trigger} data-collapsed={!wide}
      aria-label={t('settings')} aria-haspopup="dialog" aria-expanded={settingsOpen}
      aria-keyshortcuts={settingsShortcut?.aria} onClick={openSettings}>
      <IconSettingsOutlineMedium size={18} />
      {wide && <span>{t('settings')}</span>}
    </button>
  </Tooltip>
}
