/** Project overview addresses, source references, and validated HTTP response fields. */
import type { SessionId, SurfaceEvent } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceProject } from '@deepseek-ai/dsh-workspace-changes/types'
import { isChangedFile } from './changes.ts'
import type { FileAttachmentRef } from '@deepseek-ai/dsh-attachment'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** A malformed project resource address; no request was made. */
    'project/invalid-address': Record<string, never>
    /** A failed or invalid project read; the last successful value may be retained. */
    'project/read-failed': Record<string, never>
  }
}

/** Owner-authenticated project overview route. */
export const PROJECT_PATH = '/api/project.overview'
/** Owner-authenticated current-file comparison route. */
export const PROJECT_DIFF_PATH = '/api/project.diff'

/** A supplied file/link or a URL returned by a successful web search. */
export interface ProjectSource {
  kind: 'file' | 'url' | 'web'
  target: string
  label: string
}

/** Current Session directory, repository changes, and sources on its current model surface. */
export interface ProjectOverview {
  cwd: string | null
  project: WorkspaceProject
  sources: ProjectSource[]
  /** Whether the active Agent exposes web_search; null when no Agent is active. This does not report credential availability. */
  webSearch: boolean | null
}

/**
 * Address a Session's shared overview, or one file's live comparison.
 * @param sessionId - owning Session.
 * @param path - exact listed file path; omitted addresses the overview.
 * @returns the resource address.
 */
export function projectAddress(sessionId: SessionId, path?: string): string {
  const protocol = path === undefined ? 'project-overview' : 'project-diff'
  return `dsh-resource://${protocol}/session/${encodeURIComponent(sessionId)}${path === undefined ? '' : `?path=${encodeURIComponent(path)}`}`
}

/**
 * Parse the closed resource address grammar used by project views.
 * @param address - untrusted resource address.
 * @returns coordinates, or undefined for unsupported or malformed addresses.
 */
export function parseProjectAddress(address: string): { sessionId: SessionId; path?: string } | undefined {
  try {
    const url = new URL(address)
    if (url.protocol !== 'dsh-resource:' || !['project-overview', 'project-diff'].includes(url.host)) return undefined
    const parts = url.pathname.split('/')
    if (parts.length !== 3 || parts[1] !== 'session' || parts[2] === '') return undefined
    const sessionId = decodeURIComponent(parts[2] as string) as SessionId
    const path = url.searchParams.get('path')
    if (url.host === 'project-diff' && (path === null || path === '')) return undefined
    return { sessionId, ...path === null ? {} : { path } }
  } catch (_error: unknown) {
    // Bad URL syntax or percent escapes cannot name one of this plugin's resources.
    return undefined
  }
}

/**
 * Validate and normalize an external link before showing it as a source.
 * @param text - user input or persisted tool data.
 * @returns an HTTP(S) URL without embedded credentials, or undefined.
 */
export function sourceUrl(text: string): string | undefined {
  try {
    const url = new URL(text)
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.username === '' && url.password === '' ? url.href : undefined
  } catch (_error: unknown) {
    // Relative paths and malformed strings are file candidates, never external links.
    return undefined
  }
}

/** One source occurrence with original text coordinates, used to remove an unsent reference safely. */
export interface DraftSource extends ProjectSource { start: number; end: number }

/**
 * Recognize explicit @file mentions and HTTP(S) links in supplied text.
 * @param text - exact user text, including reference chips' clipboard representation.
 * @returns references in text order, with UTF-16 spans.
 */
export function draftSources(text: string): DraftSource[] {
  const sources: DraftSource[] = []
  const tokens = /(?<!\S)(@"[^"\n]+"|@[^\s]+)|https?:\/\/[^\s<>\])]+/gu
  for (const match of text.matchAll(tokens)) {
    const raw = match[0].replace(/[.,;!?，。；！？]+$/u, '')
    const file = raw.startsWith('@')
    const target = file ? raw.slice(1).replace(/^"|"$/gu, '') : sourceUrl(raw)
    if (target === undefined || target === '') continue
    sources.push({ kind: file ? 'file' : 'url', target, label: file ? target.split(/[\\/]/u).filter(Boolean).at(-1) ?? target : target,
      start: match.index, end: match.index + raw.length })
  }
  return sources
}

/**
 * Collect supplied sources and successful search results from the current model surface.
 * @param events - ordered, current Session surface, excluding replaced messages.
 * @param filePath - resolves a durable attachment to its Host path; absent paths are not offered as file links.
 * @returns deduplicated sources; a supplied link is distinct from an actual search result.
 */
export function projectSources(
  events: readonly SurfaceEvent[], filePath: (file: FileAttachmentRef) => string | undefined,
): ProjectSource[] {
  const sources = new Map<string, ProjectSource>()
  const searches = new Set<string>()
  const add = (source: ProjectSource): void => { sources.set(`${source.kind}:${source.target}`, source) }
  for (const event of events) {
    if (event.type === 'assistant/message') {
      for (const block of event.data.message.content) {
        if (block.type === 'tool-call' && block.name === 'web_search') searches.add(block.id)
      }
    } else if (event.type === 'user/message') {
      for (const block of event.data.content) {
        if (block.type === 'text') for (const { start: _start, end: _end, ...source } of draftSources(block.text)) add(source)
        else if (block.type === 'file') {
          const target = filePath(block.attachment)
          if (target !== undefined) add({ kind: 'file', target, label: block.attachment.name })
        }
      }
    } else if (event.type === 'tool/result' && !event.data.message.isError && searches.has(event.data.message.toolCallId)) {
      const meta = event.data.meta
      if (typeof meta !== 'object' || meta === null || !('sources' in meta) || !Array.isArray(meta.sources)) continue
      for (const value of meta.sources) {
        if (typeof value !== 'object' || value === null || !('url' in value) || typeof value.url !== 'string') continue
        const target = sourceUrl(value.url)
        if (target === undefined) continue
        add({ kind: 'web', target, label: 'title' in value && typeof value.title === 'string' ? value.title : target })
      }
    }
  }
  return [...sources.values()]
}

/**
 * Validate an overview received over HTTP; no unchecked data reaches the resource stream.
 * @param value - decoded response.
 * @returns whether the response carries every required field.
 */
export function isProjectOverview(value: unknown): value is ProjectOverview {
  if (typeof value !== 'object' || value === null || !('project' in value) || !('sources' in value)) return false
  if (!('cwd' in value) || !(value.cwd === null || typeof value.cwd === 'string') || !('webSearch' in value)
    || !(value.webSearch === null || typeof value.webSearch === 'boolean')) return false
  const project = value.project
  if (typeof project !== 'object' || project === null || !('kind' in project)) return false
  if (project.kind === 'unavailable') {
    if (!('reason' in project) || (project.reason !== 'git-missing' && project.reason !== 'not-repository')) return false
  } else if (project.kind === 'repository') {
    if (!('root' in project) || typeof project.root !== 'string' || !('branch' in project) || typeof project.branch !== 'string'
      || !('base' in project) || !(project.base === null || typeof project.base === 'string') || !('files' in project)
      || !Array.isArray(project.files) || !project.files.every(isChangedFile)) return false
    for (const field of ['total', 'added', 'deleted'] as const) {
      const count = (project as Record<string, unknown>)[field]
      if (!Number.isSafeInteger(count) || Number(count) < 0) return false
    }
  } else return false
  return Array.isArray(value.sources) && value.sources.every((source: unknown) => typeof source === 'object' && source !== null
    && 'kind' in source && ['file', 'url', 'web'].includes(String(source.kind)) && 'target' in source && typeof source.target === 'string'
    && 'label' in source && typeof source.label === 'string')
}
