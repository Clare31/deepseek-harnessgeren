/** Compact project menu and source intake through the existing Session composer. */
import { useState, type ReactNode } from 'react'
import {
  Button, IconFolderCloseRegular, IconGlobeOutlineRegular, IconPlusOutlineRegular, IconLinkOutlineRegular,
  IconEditOutlineRegular, IconRefreshOutlineRegular, Menu, Modal, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { workspaceTitleOf } from '@deepseek-ai/dsh-util-workspace-path'
import { projectAddress, sourceUrl } from '../project.ts'
import type { NS } from './locales.ts'
import type {} from './project-resources.ts'
import css from './ProjectOverview.module.css'

/** Project actions shared by the header and sidebar body. */
export interface ProjectActions {
  refreshProject: (sessionId: SessionId) => void
  openProject: (sessionId: SessionId) => void
  openProjectFiles: () => void
  openSource: (sessionId: SessionId, kind: 'file' | 'url' | 'web', target: string) => void
}

/** Header slot's runtime, registered actions, and dictionary. */
export type ProjectOverviewProps = PropsRuntime<'conversation.session.header.utilities'> & PropsLocale<typeof NS> & ProjectActions

/**
 * Render the current project's compact overview beside the Session header.
 * @param props - Session-scoped hooks and injected project navigation.
 * @returns a keyboard-operable project menu and optional source dialog.
 */
export function ProjectOverview(props: ProjectOverviewProps): ReactNode {
  const { sessionId, t, refreshProject, openProject, openSource } = props
  const resource = props.useResource<'project-overview'>(projectAddress(sessionId))
  const cwd = props.useSessions(state => state.byId[sessionId]?.cwd)
  const [open, setOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const value = resource.value
  const project = value?.project
  const ready = resource.status === 'live'
  const title = workspaceTitleOf(value?.cwd ?? cwd ?? '') || t('project.noDirectory')
  const review = (): void => { setOpen(false); openProject(sessionId) }
  return <>
    <Menu open={open} portal autoFocus align="end" onClose={() => { setOpen(false) }} listClassName={css.menu}
      anchor={<Tooltip label={t('project.title')} side="bottom">
        <button type="button" className={css.trigger} aria-label={t('project.title')} aria-expanded={open} aria-haspopup="menu"
          onClick={() => { setOpen(!open); if (!open) refreshProject(sessionId) }}>
          <IconFolderCloseRegular size={16} /><span className={css.triggerLabel}>{title}</span>
          {ready && project?.kind === 'repository' && <Counts added={project.added} deleted={project.deleted} />}
        </button>
      </Tooltip>}>
      <div className={css.card} data-project-overview>
        <div className={css.heading}><span className={css.name}>{title}</span>
          <Tooltip label={t('project.refresh')} side="bottom"><button type="button" role="menuitem" className={css.icon}
            aria-label={t('project.refresh')} onClick={() => { refreshProject(sessionId) }}><IconRefreshOutlineRegular size={14} /></button></Tooltip>
        </div>
        <button type="button" role="menuitem" className={css.row} onClick={review}>
          <IconEditOutlineRegular size={16} /><span className={css.label}>{t('project.changes')}</span>
          {ready && project?.kind === 'repository' ? <Counts added={project.added} deleted={project.deleted} />
            : <span className={css.muted}>{t(resource.status === 'failed' ? 'project.errorShort' : ready ? 'project.notRepository' : 'project.loading')}</span>}
        </button>
        <div className={css.heading}><span>{t('project.sources')}</span>
          <Tooltip label={t('project.addSource')} side="bottom"><button type="button" role="menuitem" className={css.icon}
            aria-label={t('project.addSource')} onClick={() => { setOpen(false); setAdding(true) }}><IconPlusOutlineRegular size={16} /></button></Tooltip>
        </div>
        <button type="button" role="menuitem" className={css.row} onClick={review}>
          <IconGlobeOutlineRegular size={16} /><span className={css.label}>{t('project.webSearch')}</span>
          <span className={css.muted}>{t(value?.webSearch == null ? 'project.unknown' : value.webSearch ? 'project.available' : 'project.unavailable')}</span>
        </button>
        {value?.sources.slice(0, 3).map(source => <button key={`${source.kind}:${source.target}`} type="button" role="menuitem"
          className={css.row} onClick={() => { setOpen(false); openSource(sessionId, source.kind, source.target) }}>
          <IconLinkOutlineRegular size={16} /><span className={css.label}>{source.label}</span>
        </button>)}
        <button type="button" role="menuitem" className={css.row} onClick={review}>
          <IconLinkOutlineRegular size={16} /><span className={css.label}>{t('project.viewAll')}</span>
          {value !== undefined && <span className={css.muted}>{value.sources.length}</span>}
        </button>
      </div>
    </Menu>
    <SourceDialog {...props} open={adding} close={() => { setAdding(false) }} />
  </>
}

/** Shared signed line totals. @param props - text-line counts. @returns the added and deleted totals. */
export function Counts({ added, deleted }: { added: number; deleted: number }): ReactNode {
  return <span className={css.counts}>
    <span className={css.added}>+{added.toLocaleString()}</span><span className={css.deleted}>−{deleted.toLocaleString()}</span>
  </span>
}

/**
 * Add a file reference or URL to the existing draft without sending a message.
 * @param props - draft actions, localized copy, and dialog visibility.
 * @returns source validation and an explicit add action.
 */
export function SourceDialog(props: ProjectOverviewProps & { open: boolean; close: () => void }): ReactNode {
  const { open, close, t, inputActions } = props
  const phase = props.useInput(state => state.phase)
  const [text, setText] = useState('')
  const [error, setError] = useState(false)
  const add = (): void => {
    const target = text.trim()
    const url = sourceUrl(target)
    if (target === '' || /[\n\r\u0000"]/u.test(target) || /^[a-z][a-z\d+.-]*:/iu.test(target) && url === undefined && !/^[a-z]:[/\\]/iu.test(target)) {
      setError(true)
      return
    }
    const insertion = url ?? `@"${target.replace(/^@/u, '')}"`
    if (!inputActions.insertText(` ${insertion} `, inputActions.captureInsertion())) { setError(true); return }
    inputActions.persistDraft()
    setText('')
    setError(false)
    close()
  }
  return <Modal open={open} onClose={close} title={t('project.addSource')} closeLabel={t('project.close')}
    description={t('project.sourceHint')} footer={<Button disabled={phase !== 'plain'} onClick={add}>{t('project.add')}</Button>}>
    <label className={css.field}>{t('project.sourceLabel')}
      <input data-modal-autofocus value={text} aria-invalid={error} placeholder={t('project.sourcePlaceholder')}
        onChange={(event) => { setText(event.target.value); setError(false) }} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); add() } }} />
    </label>
    {error && <p className={css.error} role="alert">{t('project.sourceInvalid')}</p>}
    <button type="button" className={css.row} onClick={() => { close(); props.openProjectFiles() }}><IconFolderCloseRegular size={16} />{t('project.browseFiles')}</button>
  </Modal>
}
