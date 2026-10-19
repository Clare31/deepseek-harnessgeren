/** Project HTTP routes accept only owner requests and Session-derived directories. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import type { BrowserAuth } from '@deepseek-ai/dsh-client-connection/src/browser-auth.ts'
import { Peer } from '@deepseek-ai/dsh-client-connection/src/peer.ts'
import { SessionQueryError } from '@deepseek-ai/dsh-session-query'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { registerProjectRoutes } from '../src/project-routes.ts'
import { PROJECT_PATH, PROJECT_DIFF_PATH } from '../src/project.ts'

const contexts: Context[] = []
afterEach(async () => { for (const ctx of contexts.splice(0)) await ctx.fiber.dispose() })

async function fixture() {
  const ctx = new Context()
  contexts.push(ctx)
  const session = Session.create(SessionId('known'))
  const event = session.append('user/message', createUserMessage({ content: [{ type: 'text', text: '@"source.md"' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
  const readSurface = vi.fn(async (id: string) => {
    if (id !== 'known') throw new SessionQueryError('missing', 'SESSION_QUERY_SESSION_NOT_FOUND')
    return { session: { cwd: '/verified/project' }, events: [event] }
  })
  ctx.provide('sessionQuery', { readSurface } as never)
  ctx.provide('attachments', { fileHostPath: () => undefined } as never)
  ctx.provide('tools', { get: () => ({}) } as never)
  ctx.provide('agents', { get: () => ({}) } as never)
  const read = vi.fn(async (_cwd: string, _signal: AbortSignal) => ({ kind: 'unavailable' as const, reason: 'not-repository' as const }))
  const diff = vi.fn(async (_cwd: string, path: string, _signal: AbortSignal) => path === 'known.txt'
    ? { kind: 'binary' as const, path, display: path } : undefined)
  ctx.provide('workspaceProject', { read, diff })
  const connection = new HostConnectionService(ctx, [], {} as BrowserAuth)
  await ctx.plugin({ apply: registerProjectRoutes })
  const handler = connection.createSharedFetchHandler('/api')
  const fetch = (path: string, query = '?sessionId=known', peer = connection.browserPeer) =>
    handler.fetch(new Request(`http://localhost${path}${query}`), peer)
  return { ctx, read, diff, fetch, readSurface }
}

describe('project routes', () => {
  it('uses the Session directory, rejects arbitrary file paths, and reports failures without stale success', async () => {
    const { fetch, read, diff } = await fixture()
    const response = await fetch(PROJECT_PATH, '?sessionId=known&cwd=/untrusted')
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toMatchObject({ cwd: '/verified/project', sources: [{ kind: 'file', target: 'source.md' }], webSearch: true })
    expect(read).toHaveBeenLastCalledWith('/verified/project', expect.any(AbortSignal))
    expect((await fetch(PROJECT_PATH, '?sessionId=missing')).status).toBe(404)
    expect((await fetch(PROJECT_PATH, '')).status).toBe(400)
    expect((await fetch(PROJECT_DIFF_PATH)).status).toBe(400)
    expect((await fetch(PROJECT_DIFF_PATH, '?sessionId=known&path=../unlisted')).status).toBe(404)
    expect((await fetch(PROJECT_DIFF_PATH, '?sessionId=known&path=known.txt')).status).toBe(200)
    expect(diff).toHaveBeenLastCalledWith('/verified/project', 'known.txt', expect.any(AbortSignal))
    read.mockRejectedValueOnce(new Error('private diagnostic'))
    const failed = await fetch(PROJECT_PATH)
    expect(failed.status).toBe(500)
    expect(await failed.text()).not.toContain('private diagnostic')
  })

  it('refuses a non-owner before reading Session or repository data', async () => {
    const { ctx, fetch, readSurface, read } = await fixture()
    const guest = new Peer(ctx, { principal: { kind: 'share', id: 'guest' } } as never)
    expect((await fetch(PROJECT_PATH, '?sessionId=known', guest)).status).toBe(403)
    expect(readSurface).not.toHaveBeenCalled()
    expect(read).not.toHaveBeenCalled()
  })
})
