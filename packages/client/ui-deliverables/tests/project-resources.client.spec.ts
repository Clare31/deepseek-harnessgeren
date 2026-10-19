/** Resource invalidation, failed reads, and disposal remain isolated across Sessions. */
import { describe, expect, it, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { ProjectResources } from '../src/client/project-resources.ts'
import { projectAddress, type ProjectOverview } from '../src/project.ts'

const overview: ProjectOverview = { cwd: '/repo', project: { kind: 'unavailable', reason: 'not-repository' }, sources: [], webSearch: true }

describe('project resources', () => {
  it('retains a refresh arriving during a read and releases the Session watcher on abort', async () => {
    const fetcher = vi.fn<typeof fetch>()
    const pending = Promise.withResolvers<Response>()
    fetcher.mockReturnValueOnce(pending.promise).mockResolvedValue(Response.json(overview))
    const unwatch = vi.fn()
    const resources = new ProjectResources(fetcher, () => unwatch)
    const owner = new AbortController()
    const id = SessionId('viewed')
    const stream = resources.overview().open(projectAddress(id), { signal: owner.signal })[Symbol.asyncIterator]()
    try {
      const first = stream.next()
      resources.refresh(SessionId('other'))
      resources.refresh(id)
      pending.resolve(Response.json(overview))
      expect((await first).value).toEqual({ ok: true, value: overview })
      expect(fetcher).toHaveBeenCalledTimes(2)
      const idle = stream.next()
      owner.abort()
      expect((await idle).done).toBe(true)
      expect(unwatch).toHaveBeenCalledTimes(1)
    } finally {
      owner.abort()
      await stream.return?.()
      await resources.dispose()
    }
  })

  it('publishes read failures, retries explicitly, and cancels outstanding work on disposal', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ invalid: true })).mockResolvedValueOnce(Response.json(overview))
    const resources = new ProjectResources(fetcher, () => () => {})
    const owner = new AbortController()
    const id = SessionId('viewed')
    const stream = resources.overview().open(projectAddress(id), { signal: owner.signal })[Symbol.asyncIterator]()
    try {
      expect((await stream.next()).value).toMatchObject({ ok: false, error: { code: 'project/read-failed' } })
      resources.refresh(id)
      expect((await stream.next()).value).toEqual({ ok: true, value: overview })
      const started = Promise.withResolvers<undefined>()
      fetcher.mockImplementationOnce((_input, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => { reject(new Error('aborted')) }, { once: true })
        started.resolve(undefined)
      }))
      resources.refresh(id)
      const next = stream.next()
      await started.promise
      await resources.dispose()
      expect((await next).done).toBe(true)
      resources.refresh(id)
      expect(fetcher).toHaveBeenCalledTimes(3)
    } finally {
      owner.abort()
      await stream.return?.()
      await resources.dispose()
    }
  })
})
