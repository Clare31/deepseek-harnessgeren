/** Shared, cancellable project resources; refresh requests arriving during a read are retained. */
import type { ResourceProvider } from '@deepseek-ai/dsh-client-resources/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { RemoteError, type RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { isChangesDiff, type ChangesDiff } from '../changes.ts'
import { isProjectOverview, parseProjectAddress, PROJECT_PATH, PROJECT_DIFF_PATH, type ProjectOverview } from '../project.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface ResourceProtocolMap {
    /** Repository and source overview for one Session. */
    'project-overview': ProjectOverview
    /** Current HEAD-to-worktree comparison for one admitted path. */
    'project-diff': ChangesDiff
  }
}

/** Per-plugin resource lifecycle shared by the header and sidebar tab. */
export class ProjectResources {
  private readonly lifetime = new AbortController()
  private readonly listeners = new Map<SessionId, Set<() => void>>()
  private readonly pending = new Set<Promise<unknown>>()

  constructor(
    private readonly fetcher: typeof fetch,
    private readonly watch: (sessionId: SessionId, notify: () => void) => () => void,
  ) {}

  /**
   * Refresh one Session, or every subscribed Session when omitted.
   * @param sessionId - optional target.
   */
  refresh(sessionId?: SessionId): void {
    const groups = sessionId === undefined ? this.listeners.values() : [this.listeners.get(sessionId)]
    for (const group of groups) for (const notify of group ?? []) notify()
  }

  /** Cancel and await outstanding network reads before the plugin releases its dependencies. */
  async dispose(): Promise<void> {
    this.lifetime.abort()
    this.refresh()
    await Promise.allSettled(this.pending)
  }

  /**
   * Create the shared overview provider.
   * @returns the provider registered through the resource service.
   */
  overview(): ResourceProvider<'project-overview'> {
    return { protocol: 'project-overview', open: (address, context) => this.open(address, context.signal, PROJECT_PATH, isProjectOverview) }
  }

  /**
   * Create the shared file-comparison provider.
   * @returns the provider registered through the resource service.
   */
  comparison(): ResourceProvider<'project-diff'> {
    return { protocol: 'project-diff', open: (address, context) => this.open(address, context.signal, PROJECT_DIFF_PATH, isChangesDiff) }
  }

  private async *open<T>(
    address: string, owner: AbortSignal, route: string, validate: (value: unknown) => value is T,
  ): AsyncIterable<RemoteResult<T>> {
    const parsed = parseProjectAddress(address)
    if (parsed === undefined) {
      yield { ok: false, error: new RemoteError('project/invalid-address', 'Invalid project address', {}) }
      return
    }
    const { sessionId, path } = parsed
    const query = new URLSearchParams({ sessionId })
    if (path !== undefined) query.set('path', path)
    const signal = AbortSignal.any([owner, this.lifetime.signal])
    const aborted = (): boolean => signal.aborted
    if (aborted()) return
    let dirty = true
    let revision = 0
    let resume = (): void => {}
    const notify = (): void => { dirty = true; revision += 1; resume() }
    const group = this.listeners.get(sessionId) ?? new Set<() => void>()
    group.add(notify)
    this.listeners.set(sessionId, group)
    const unwatch = this.watch(sessionId, notify)
    signal.addEventListener('abort', notify, { once: true })
    try {
      while (!aborted()) {
        if (!dirty) { await new Promise<void>((resolve) => { resume = resolve }); continue }
        dirty = false
        const ticket = revision
        let result: RemoteResult<T>
        try {
          const task = this.read(`${route.slice(1)}?${query}`, signal, validate)
          this.pending.add(task)
          let value: T
          try { value = await task } finally { this.pending.delete(task) }
          result = { ok: true, value }
        } catch (error: unknown) {
          if (aborted()) return
          result = { ok: false, error: new RemoteError('project/read-failed', 'Could not read project; retry', {}, { cause: error }) }
        }
        if (!aborted() && ticket === revision) yield result
      }
    } finally {
      signal.removeEventListener('abort', notify)
      unwatch()
      group.delete(notify)
      if (group.size === 0) this.listeners.delete(sessionId)
    }
  }

  private async read<T>(url: string, signal: AbortSignal, validate: (value: unknown) => value is T): Promise<T> {
    const response = await this.fetcher(url, { signal })
    if (!response.ok) throw new Error(`Project read returned ${response.status}`)
    const value: unknown = await response.json()
    if (!validate(value)) throw new Error('Invalid project response')
    return value
  }
}
