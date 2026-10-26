/** Settings shortcut to the profile-owned plugin installation dialog. */
import { Button, IconPlusOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'

/** Navigation callback supplied by the plugin manager registration. */
export interface SettingsAddPluginActionInjected {
  /** Open the Plugins panel and its existing installation dialog. */
  openInstall: () => void
}

type Props = PropsRuntime<'settings.plugins.actions'> & PropsLocale<'pluginManager'> & InjectFace<SettingsAddPluginActionInjected>

/** Render the installation shortcut, closing Settings before opening its destination. */
export function SettingsAddPluginAction({ t, close, openInstall }: Props) {
  return <Button size="sm" variant="primary" icon={<IconPlusOutlineRegular size={13} />} onClick={() => { close(); openInstall() }}>{t('addPlugin')}</Button>
}
