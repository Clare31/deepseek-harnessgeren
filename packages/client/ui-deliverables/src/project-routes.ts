/** Owner-only project reads resolve all working directories from Session headers. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-workspace-changes/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import { PROJECT_PATH, PROJECT_DIFF_PATH, projectSources, type ProjectOverview } from './project.ts'

/**
 * Register authenticated current-project routes; unload cancels and awaits every read.
 * @param ctx - connection, Session query, tools, attachment storage, and repository reader.
 */
export function registerProjectRoutes(ctx: Context): void {
  const lifetime = new AbortController()
  const pending = new Set<Promise<Response>>()
  ctx.effect(() => async () => {
    lifetime.abort()
    await Promise.allSettled(pending)
  })
  for (const path of [PROJECT_PATH, PROJECT_DIFF_PATH]) {
    ctx.connection.fetch.register({
      path, methods: ['GET'], requestBody: 'buffered',
      fetch: (request) => {
        const bounded = new Request(request, { signal: AbortSignal.any([request.signal, lifetime.signal]) })
        const task = read(ctx, bounded, path === PROJECT_DIFF_PATH)
        pending.add(task)
        void task.then(() => { pending.delete(task) }, () => { pending.delete(task) })
        return task
      },
    })
  }
}

async function read(ctx: Context, request: Request, diff: boolean): Promise<Response> {
  const query = new URL(request.url).searchParams
  const id = query.get('sessionId')
  const path = query.get('path')
  if (id === null || id === '' || diff && (path === null || path === '')) return new Response('Invalid project coordinates', { status: 400 })
  try {
    request.signal.throwIfAborted()
    const surface = await ctx.sessionQuery.readSurface(id as SessionId)
    request.signal.throwIfAborted()
    const cwd = surface.session.cwd
    if (diff) {
      if (cwd === undefined) return new Response('No project directory', { status: 404 })
      const value = await ctx.workspaceProject.diff(cwd, path as string, request.signal)
      return value === undefined ? new Response('File is no longer changed', { status: 404 })
        : Response.json(value, { headers: { 'cache-control': 'no-store' } })
    }
    const agent = ctx.agents.get(id as SessionId)
    const value: ProjectOverview = {
      cwd: cwd ?? null,
      project: cwd === undefined ? { kind: 'unavailable', reason: 'not-repository' } : await ctx.workspaceProject.read(cwd, request.signal),
      sources: projectSources(surface.events, file => ctx.attachments.fileHostPath(file)),
      webSearch: agent === undefined ? null : ctx.tools.get('web_search', agent) !== undefined,
    }
    return Response.json(value, { headers: { 'cache-control': 'no-store' } })
  } catch (error: unknown) {
    request.signal.throwIfAborted()
    const remote = remoteErrorOf(error)
    const missing = remote?.code === 'session/not-found'
      || typeof error === 'object' && error !== null && 'code' in error && error.code === 'SESSION_QUERY_SESSION_NOT_FOUND'
    return new Response('Could not read project; retry after checking the workspace', { status: missing ? 404 : 500 })
  }
}
