/** Project-wide file review and current-context sources in the existing right sidebar. */
import { useState, type ReactNode } from 'react'
import { Button, FileTypeIcon, IconCloseOutlineRegular, IconPlusOutlineRegular, IconRefreshOutlineRegular, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { draftSources, projectAddress } from '../project.ts'
import type { NS } from './locales.ts'
import { Counts, SourceDialog, type ProjectActions } from './ProjectOverview.tsx'
import { FileDiff } from './FileDiff.tsx'
import type {} from './project-resources.ts'
import css from './ProjectOverview.module.css'

/** The sidebar's scoped runtime, project actions, and copy. */
export type ProjectTabProps = PropsRuntime<'sidebar.right.pane.tab'> & PropsLocale<typeof NS> & ProjectActions

/**
 * Show project-wide differences and supplied or retrieved sources, with per-file comparison controls.
 * @param props - sidebar scope, resources, and existing composer actions.
 * @returns the project overview or selected file's comparison.
 */
export function ProjectTab(props: ProjectTabProps): ReactNode {
  const { sessionId, t, refreshProject } = props
  const resource = props.useResource<'project-overview'>(projectAddress(sessionId))
  const [selected, setSelected] = useState<string | undefined>()
  const [split, setSplit] = useState(true)
  const [wrap, setWrap] = useState(false)
  const [adding, setAdding] = useState(false)
  const draftText = props.useInput(state => state.draft)
  const draftRevision = props.useInput(state => state.draftRev)
  const comparison = props.useResource<'project-diff'>(selected === undefined ? '' : projectAddress(sessionId, selected))
  const value = resource.value
  const project = value?.project
  const diff = comparison.status === 'failed' ? 'error' : comparison.value
  const phase = props.useInput(state => state.phase)
  const diffTranslate: typeof t = (key, params) => t(key === 'diff.created' ? 'project.created' : key === 'diff.deleted' ? 'project.deleted' : key, params)
  return <div className={css.panel} data-project-panel>
    <div className={css.toolbar}>
      {selected === undefined ? <span>{t('project.title')}</span> : <Button size="sm" onClick={() => { setSelected(undefined) }}>{t('project.back')}</Button>}
      <Tooltip label={t('project.refresh')} side="bottom"><button type="button" className={css.icon} aria-label={t('project.refresh')}
        onClick={() => { refreshProject(sessionId) }}><IconRefreshOutlineRegular size={16} /></button></Tooltip>
    </div>
    {resource.status === 'failed' && <p className={css.error} role="alert">{t('project.error')}</p>}
    {value === undefined && resource.status !== 'failed' && <p className={css.note} role="status">{t('project.loading')}</p>}
    {selected !== undefined ? <div className={css.diff}>
      <div className={css.toolbar}><span className={css.label}>{selected}</span>
        <Button size="sm" onClick={() => { setSplit(!split) }}>{t(split ? 'review.unified' : 'review.split')}</Button>
        <Button size="sm" onClick={() => { setWrap(!wrap) }}>{t(wrap ? 'review.nowrap' : 'review.wrap')}</Button>
      </div>
      <FileDiff state={diff} split={split} wrap={wrap} retry={() => { refreshProject(sessionId) }} t={diffTranslate} />
    </div> : <div className={css.body}>
      <section className={css.section}>
        <h3>{t('project.changes')}{project?.kind === 'repository' && <Counts added={project.added} deleted={project.deleted} />}</h3>
        <p className={css.note}>{t('project.comparisonHint')}</p>
        {project?.kind === 'repository' ? <>
          <p className={css.note}>{project.root}<br />{project.branch}</p>
          {project.files.length === 0 && <p className={css.note}>{t('project.clean')}</p>}
          {project.files.map(file => <button type="button" key={file.path} className={css.row}
            onClick={() => { setSelected(file.path) }} aria-label={t('changes.viewDiff', { name: file.display })}>
            <FileTypeIcon path={file.path} size={16} /><span className={css.label}>{file.display}</span>
            {file.binary === true ? <span className={css.muted}>{t('changes.binary')}</span> : <Counts added={file.added} deleted={file.deleted} />}
          </button>)}
          {project.total > project.files.length && <p className={css.note}>{t('project.limited', { count: project.files.length, total: project.total })}</p>}
        </> : project !== undefined && <p className={css.note}>{t(project.reason === 'git-missing' ? 'project.gitMissing' : 'project.notRepository')}</p>}
      </section>
      <section className={css.section}>
        <h3>{t('project.sources')}<Tooltip label={t('project.addSource')} side="bottom"><button type="button" className={css.icon}
          aria-label={t('project.addSource')} onClick={() => { setAdding(true) }}><IconPlusOutlineRegular size={16} /></button></Tooltip></h3>
        <p className={css.note}>{t('project.sourcesHint')}</p>
        <div className={css.row}><span className={css.label}>{t('project.webSearch')}</span>
          <span className={css.muted}>{t(value?.webSearch == null ? 'project.unknown' : value.webSearch ? 'project.available' : 'project.unavailable')}</span></div>
        {value?.sources.map(source => <button type="button" key={`${source.kind}:${source.target}`} className={css.row}
          onClick={() => { props.openSource(sessionId, source.kind, source.target) }}>
          <span className={css.label}>{source.label}</span><span className={css.muted}>{t(source.kind === 'web' ? 'project.retrieved' : 'project.supplied')}</span>
        </button>)}
        {value?.sources.length === 0 && <p className={css.note}>{t('project.noSources')}</p>}
      </section>
      <section className={css.section}>
        <h3>{t('project.pending')}</h3>
        {draftSources(draftText).map(source => <div key={`${source.start}:${source.target}`} className={css.row}>
          <span className={css.label}>{source.label}</span><Tooltip label={t('project.remove')} side="bottom"><button type="button" className={css.icon}
            disabled={phase !== 'plain'} aria-label={t('project.removeSource', { name: source.label })} onClick={() => {
              props.inputActions.insertText('', { start: source.start, end: source.end, draftRev: draftRevision })
              props.inputActions.persistDraft()
            }}><IconCloseOutlineRegular size={14} /></button></Tooltip>
        </div>)}
        {draftSources(draftText).length === 0 && <p className={css.note}>{t('project.noPending')}</p>}
      </section>
    </div>}
    <SourceDialog {...props} open={adding} close={() => { setAdding(false) }} />
  </div>
}

/** Render the registered project tab's icon and title. @param props - sidebar tab scope. @returns the project chip. */
export function ProjectTitle({ useTabInfo }: PropsRuntime<'sidebar.right.pane.tab.title'>): ReactNode {
  return <><FileTypeIcon kind="folder" size={16} />{useTabInfo().tab.title}</>
}
