/** Feature-owned artwork choices in Settings → Appearance. */
import { useState } from 'react'
import { StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { ARTWORKS, type AppearanceSettings, type Artwork } from '../appearance-settings.ts'
import css from './AppearanceSection.module.css'

/** Accepted Host state and the ordered appearance writer. */
export interface AppearanceInjected {
  hooks: { appearance: HostObservable<ConfigFormSnapshot<AppearanceSettings>> }
  setArtwork(artwork: Artwork): Promise<boolean>
}

/** Settings page props, including renderer-bound Host state. */
export type AppearanceSectionProps = PropsRuntime<'settings.section'> & PropsLocale<'rabb.brand'> & InjectFace<AppearanceInjected>

/**
 * Render preview cards and retain the accepted selection if saving fails.
 * @param props - Host values, writer, and localized copy.
 * @returns the artwork settings page.
 */
export function AppearanceSection({ useAppearance, setArtwork, t }: AppearanceSectionProps) {
  const snapshot = useAppearance(value => value)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const selected = snapshot.value?.artwork ?? 'pixel'
  if (snapshot.status === 'loading') return <div className={css.loading}><StateDot state="ongoing" size={24} /></div>
  return <section className={css.section}>
    <h2 className={css.title}>{t('appearance')}</h2>
    <p className={css.description}>{t('description')}</p>
    {(snapshot.status === 'unavailable' || !snapshot.writable) && <p role="status" className={css.description}>{t('unavailable')}</p>}
    <div className={css.cards} role="group" aria-label={t('background')}>
      {ARTWORKS.map(artwork => <button key={artwork} type="button" className={css.card}
        aria-pressed={selected === artwork} disabled={busy || snapshot.status !== 'ready' || !snapshot.writable}
        onClick={() => {
          setBusy(true)
          setFailed(false)
          void setArtwork(artwork).then((accepted) => { setFailed(!accepted) })
            .catch(() => { setFailed(true) }).finally(() => { setBusy(false) })
        }}>
        <span aria-hidden="true" className={css.preview} style={{ backgroundImage: `var(--rabb-artwork-${artwork})` }} />
        <span>{t(artwork)}</span>
      </button>)}
    </div>
    {failed && <p role="alert" className={css.error}>{t('saveError')}</p>}
  </section>
}
