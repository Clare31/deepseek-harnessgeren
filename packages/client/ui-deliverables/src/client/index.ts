/**
 * Deliverables plugin, browser half: registers the changed-files card and
 * delivery cards into the chat view's turn-tail list, the `changes-review`
 * right-Sidebar tab type that reviews one turn's changed files one comparison
 * at a time, and provides the `chatFileMentions` service that links
 * inline-code mentions of produced or delivered files in the closing prose.
 * All policy lives here — the supported mutation calls, mention matching, row
 * cap, and copy — so composing this plugin out of cordis.yml removes every
 * surface; the owning view renders an empty list and inert prose at zero cost.
 */
import './file-actions.ts'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-connection/client'
import type { ChatFileMentions } from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { changesReviewAddress } from '../changes.ts'
import { ChangesDiffStore } from './changes-diff.ts'
import { ChangesSummaryStore } from './changes-summary.ts'
import { PresentedOpenController } from './present-open.ts'
import { PresentRow } from './PresentRow.tsx'
import { DeliverablesTail, type DeliverablesInjected } from './Deliverables.tsx'
import { ReviewTab, type ReviewInjected } from './ReviewTab.tsx'
import { CHANGES_REVIEW_ID, changesReviewDefinition } from './review-definition.ts'
import { createReviewStore } from './review-store.ts'
import type {} from '@deepseek-ai/dsh-client-resources/client'
import { fileAddressFor } from '@deepseek-ai/dsh-util-workspace-path'
import { parseProjectAddress, projectAddress, sourceUrl } from '../project.ts'
import { ProjectResources } from './project-resources.ts'
import { ProjectOverview, type ProjectActions } from './ProjectOverview.tsx'
import { ProjectTab, ProjectTitle } from './ProjectTab.tsx'
import { en, ja, es, fr, de, ru, pt, NS, zh, type DeliverablesKey } from './locales.ts'
import {
  deliverablesDefinition, presentedForClosing, producedFileMentions, selectProducedFiles,
} from './turn-deliverables.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Changed-files card, review tab, delivery card, and file-mention copy. */
    'deliverables': DeliverablesKey
  }
}

/** Required services for the tail-slot and tab-type registrations and their dictionaries. */
export const inject = ['slots', 'locale', 'uiConversation', 'remote', 'remote.session', 'sidebarRightTabs', 'sidebarRight', 'configForms', 'resources', 'sessions']

/**
 * Client plugin body: register the dictionaries, the turn-tail entry, and the comparison tab type.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const opener = new PresentedOpenController()
  const summaries = new ChangesSummaryStore()
  const diffs = new ChangesDiffStore()
  ctx.effect(() => () => Promise.all([opener.dispose(), summaries.dispose(), diffs.dispose()]))
  ctx.on('connection/reset', () => {
    opener.resetHost()
    summaries.reset()
    diffs.reset()
  })
  ctx.uiConversation.events.register(deliverablesDefinition)
  ctx.effect(() => ctx.locale.register(NS, { zh, en, ja, es, fr, de, ru, pt }), 'ui-deliverables: dictionaries')
  ctx.slots.inject(
    'conversation.chat.turnTail',
    () => ctx.slots.register({
      name: 'conversation.chat.turnTail',
      id: '@deepseek-ai/dsh-client-ui-deliverables',
      locale: NS,
      children: { 'deliverables.file.actions': { kind: 'list', scope: 'session' } },
      inject: (): DeliverablesInjected => ({
        hooks: { changesDiff: diffs.state, presentedOpen: opener.state, presentedHost: opener.host, changesSummary: summaries.state,
          showCodeDiff: ctx.configForms.developerTools.enabled },
        loadChangesDiff: (sessionId, seq, index) => diffs.load(sessionId, seq, index),
        reloadPresentedHost: () => opener.loadHost(),
        loadChangesSummary: (sessionId, seq) => summaries.load(sessionId, seq),
        openPresented: (sessionId, seq, index, action, application) => opener.open(sessionId, seq, index, action, application),
        openChanged: (sessionId, seq, index, action, application) => opener.openChanged(sessionId, seq, index, action, application),
        openChangesReview: (coordinates, index) => {
          ctx.sidebarRight.openResource(changesReviewAddress(coordinates), { params: { index } })
        },
      }),
    }, DeliverablesTail),
  )
  ctx.slots.inject('tool.call.toolview', () => ctx.slots.register(
    { name: 'tool.call.toolview', key: 'present', locale: NS }, PresentRow,
  ))
  const t = ctx.locale.bind(NS)
  registerProject(ctx)
  ctx.effect(() => ctx.sidebarRightTabs.register(changesReviewDefinition(t)), 'ui-deliverables: changes-review type')
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
    {
      name: 'sidebar.right.pane.tab', key: CHANGES_REVIEW_ID, locale: NS, store: createReviewStore(),
      children: { 'deliverables.review.file.actions': { kind: 'list', scope: 'session' } },
      inject: (): ReviewInjected => ({
        hooks: { changesSummary: summaries.state, changesDiff: diffs.state, presentedOpen: opener.state, presentedHost: opener.host },
        loadChangesSummary: (sessionId, seq) => summaries.load(sessionId, seq),
        loadChangesDiff: (sessionId, seq, index) => diffs.load(sessionId, seq, index),
        reloadPresentedHost: () => opener.loadHost(),
        openChanged: (sessionId, seq, index, action, application) => opener.openChanged(sessionId, seq, index, action, application),
      }),
    },
    ReviewTab,
  )), 'ui-deliverables: changes-review body')
  // The prose side of the same vocabulary: the chat view reaches this face
  // via ctx.get, so its absence — this plugin composed out — is the off state.
  const mentions: ChatFileMentions = {
    forClosing(owner) {
      const paths = selectProducedFiles(owner)
      const presented = presentedForClosing(owner)
      if (paths === null && presented.length === 0) return undefined
      return producedFileMentions([...new Set([...paths ?? [], ...presented.map(file => file.path)])], owner.openFile,
        path => t('presented.previewButton', { name: path }),
        owner.turn.data.get('deliverables')?.produced)
    },
  }
  ctx.provide('chatFileMentions', mentions)
}

function registerProject(ctx: ClientContext): void {
  const t = ctx.locale.bind(NS)
  const resources = new ProjectResources((...args) => fetch(...args), (sessionId, notify) => {
    const binding = ctx.sessions.binding(sessionId)
    if (binding === undefined) return () => {}
    let running = binding.session.getSnapshot().running
    return binding.session.subscribe(() => {
      const next = binding.session.getSnapshot().running
      if (next !== running) { running = next; notify() }
    })
  })
  ctx.effect(() => {
    const releases = [ctx.resources.register(resources.overview()), ctx.resources.register(resources.comparison())]
    const refresh = (): void => { resources.refresh() }
    window.addEventListener('focus', refresh)
    const reset = ctx.on('connection/reset', refresh)
    return async () => {
      window.removeEventListener('focus', refresh)
      reset()
      for (const release of releases) release()
      await resources.dispose()
    }
  }, 'ui-deliverables: project resources')
  const actions: ProjectActions = {
    refreshProject: (sessionId) =>{  resources.refresh(sessionId) },
    openProject: (sessionId) => { ctx.sidebarRight.openResource(projectAddress(sessionId)) },
    openProjectFiles: () => { ctx.sidebarRight.openTab('files') },
    openSource: (sessionId, kind, target) => {
      if (kind === 'file') {
        const cwd = ctx.sessions.list.getSnapshot().byId[sessionId]?.cwd
        ctx.sidebarRight.openResource(fileAddressFor(sessionId, cwd, target))
      } else {
        const url = sourceUrl(target)
        if (url !== undefined) ctx.sidebarRight.openResource(url)
      }
    },
  }
  const id = '@deepseek-ai/dsh-client-ui-deliverables/project'
  ctx.effect(() => ctx.sidebarRightTabs.register({
    id, kind: 'project-overview', patterns: ['dsh-resource://project-overview/session/*'], priority: 'builtin',
    canOpen: address => parseProjectAddress(address) !== undefined,
    title: () => t('project.title'),
  }), 'ui-deliverables: project tab')
  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities', id, locale: NS, order: 40, inject: (): ProjectActions => actions,
  }, ProjectOverview))
  ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab', key: id, locale: NS, inject: (): ProjectActions => actions,
  }, ProjectTab))
  ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab.title', key: id,
  }, ProjectTitle))
}
