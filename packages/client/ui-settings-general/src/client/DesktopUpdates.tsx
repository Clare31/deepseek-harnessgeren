/** Settings entry and version-scoped notification for native desktop updates. */
import { useEffect, useState } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SettingsRootInjected } from './shell-contract.ts'
import { updateCopy } from './DesktopUpdateIndicator.tsx'
import css from './DesktopUpdates.module.css'

/** Shared native state and explicit user actions for update surfaces. */
export type DesktopUpdatesInjected = Pick<SettingsRootInjected, 'openDesktopUpdate'> & {
  /** Whether the carrier supports fresh checks. */
  supported: boolean
  /** Request a fresh native check and any version-specific confirmation. */
  checkDesktopUpdates: () => void
  hooks: Pick<SettingsRootInjected['hooks'], 'desktopUpdate'>
}

type SettingsProps = PropsRuntime<'settings.section'> & PropsLocale<'settings'> & InjectFace<DesktopUpdatesInjected>
type NoticeProps = PropsRuntime<'shell.overlay'> & PropsLocale<'settings'> & InjectFace<DesktopUpdatesInjected>

/**
 * Render manual checks, current version and native download/install progress.
 * @param props - Native state, actions and localized Settings copy.
 * @returns Update settings, including browser-only unavailability.
 */
export function DesktopUpdatesSection({ t, supported, useDesktopUpdate, openDesktopUpdate, checkDesktopUpdates }: SettingsProps) {
  const view = useDesktopUpdate(value => value)
  const state = view.presentation
  const busy = view.opening || (state !== undefined && ['checking', 'downloading', 'verifying', 'installing'].includes(state.phase))
  const actionable = state !== undefined && ['available', 'ready', 'error'].includes(state.phase)
  const status = view.failed ? t('desktop.update.checkFailed')
    : state === undefined || state.phase === 'idle' ? t('updates.idle') : updateCopy(state, t).detail
  return <section className={css.section}>
    <h2 className={css.title}>{t('updates.title')}</h2>
    <p>{t('updates.intro')}</p>
    <p>{t('updates.current', { version: process.env.DSH_CLIENT_VERSION ?? t('hostRelease.unknown') })}</p>
    <p role="status">{supported ? status : t('updates.unavailable')}</p>
    <div className={css.actions}>
      <Button variant="primary" disabled={!supported || busy} aria-busy={busy}
        onClick={actionable && !view.failed ? openDesktopUpdate : checkDesktopUpdates}>
        {state?.phase === 'available' ? t('updates.confirm') : state?.phase === 'ready' ? t('desktop.update.ready')
          : state?.phase === 'error' || view.failed ? t('desktop.update.retry') : t('updates.check')}
      </Button>
    </div>
  </section>
}

/**
 * Offer each detected version once per loaded application without downloading on dismissal.
 * @param props - Native update observation and user-confirmed update action.
 * @returns An availability dialog, or nothing during manual/native operations.
 */
export function DesktopUpdateNotice({ t, supported, useDesktopUpdate, openDesktopUpdate }: NoticeProps) {
  const view = useDesktopUpdate(value => value)
  const [dismissed, setDismissed] = useState<string>()
  const version = view.presentation?.version
  useEffect(() => {
    if (view.opening && version !== undefined) setDismissed(version)
  }, [view.opening, version])
  if (!supported || view.opening || view.presentation?.phase !== 'available' || version === undefined || version === dismissed) return null
  const dismiss = (): void => { setDismissed(version) }
  return <Modal open title={t('updates.notice')} closeLabel={t('close')}
    description={t('updates.noticeDetail', { version })} onClose={dismiss}
    footer={<>
      <Button variant="outline" data-modal-autofocus onClick={dismiss}>{t('updates.later')}</Button>
      <Button variant="primary" onClick={() => { dismiss(); openDesktopUpdate() }}>{t('updates.confirm')}</Button>
    </>} />
}
