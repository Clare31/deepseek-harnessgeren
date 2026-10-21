import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SESSION_FORMAT_VERSION, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionHeader, SessionId as SessionIdType } from '@deepseek-ai/dsh-session'
import {
  SessionPersistenceInUseError, SessionPersistenceRevision,
} from '@deepseek-ai/dsh-session-persistence'
import { describe, expect, it, vi } from 'vitest'
import { createSessionTestController } from './test-remote.ts'

const sessionId: SessionIdType = SessionId('doomed')

const header: SessionHeader = {
  version: SESSION_FORMAT_VERSION,
  id: sessionId,
  createdAt: 1,
  cwd: '/workspace',
  isSeeded: false,
}

function registryStub(archived: readonly SessionIdType[] = []) {
  return {
    archivedSessionIds: archived,
    archiveSession: vi.fn(async () => {}),
    stopSessionActivity: vi.fn(async () => {}),
    forgetSession: vi.fn(async () => {}),
  }
}

async function setup(options: {
  archived?: boolean
  persisted?: boolean
  live?: boolean
} = {}) {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  const remove = vi.fn(async () => {})
  ctx.provide('sessionPersistence', {
    stat: vi.fn(async () => options.persisted === false
      ? undefined
      : { header, revision: SessionPersistenceRevision('test:doomed') }),
    delete: remove,
  } as never)
  const registry = registryStub(options.archived === true ? [sessionId] : [])
  ctx.provide('workspaceRegistry', registry as never)
  if (options.live === true) {
    ctx.sessions.create(sessionId, {
      meta: {
        createdAt: header.createdAt,
        ...(header.cwd === undefined ? {} : { cwd: header.cwd }),
      },
    })
  }
  const controller = createSessionTestController(ctx, {
    defaultModelSelection: () => ({ provider: 'fixture', model: 'fixture-model' }),
    cwd: '/workspace',
  })
  return { ctx, controller, registry, remove }
}

describe('SessionController permanent deletion', () => {
  it('archives as the stop gate, deletes the log, and forgets registry records', async () => {
    const { controller, registry, remove } = await setup()

    await expect(controller.deleteSession({ sessionId, stopActivity: true }))
      .resolves.toEqual({ deleted: true })

    expect(registry.archiveSession).toHaveBeenCalledWith(sessionId, { stopActivity: true })
    expect(registry.stopSessionActivity).not.toHaveBeenCalled()
    expect(remove).toHaveBeenCalledWith(sessionId)
    expect(registry.forgetSession).toHaveBeenCalledWith(sessionId)
  })

  it('stops residual work directly when the session is already archived', async () => {
    const { controller, registry } = await setup({ archived: true })

    await expect(controller.deleteSession({ sessionId, stopActivity: true }))
      .resolves.toEqual({ deleted: true })

    expect(registry.stopSessionActivity).toHaveBeenCalledWith(sessionId)
    expect(registry.archiveSession).not.toHaveBeenCalled()
  })

  it('rejects an unknown session without touching persistence', async () => {
    const { controller, registry, remove } = await setup({ persisted: false })

    await expect(controller.deleteSession({ sessionId, stopActivity: true }))
      .rejects.toMatchObject({ code: 'session/not-found' })

    expect(remove).not.toHaveBeenCalled()
    expect(registry.forgetSession).not.toHaveBeenCalled()
  })

  it('refuses running work unless asked to stop it', async () => {
    const { ctx, controller, registry, remove } = await setup()
    ctx.on('workspace/session-activity', async (_request, next) => [
      ...(await next()),
      { kind: 'turn' as const },
    ])

    await expect(controller.deleteSession({ sessionId }))
      .rejects.toMatchObject({ code: 'session/active' })

    expect(registry.archiveSession).not.toHaveBeenCalled()
    expect(remove).not.toHaveBeenCalled()
  })

  it('refuses a live session whose Agent another owner holds', async () => {
    const { controller, remove } = await setup({ live: true })

    await expect(controller.deleteSession({ sessionId, stopActivity: true }))
      .rejects.toMatchObject({ code: 'session/live' })

    expect(remove).not.toHaveBeenCalled()
  })

  it('maps a persistence in-use refusal to the live-session failure', async () => {
    const { controller, remove } = await setup()
    remove.mockRejectedValue(new SessionPersistenceInUseError(sessionId))

    await expect(controller.deleteSession({ sessionId, stopActivity: true }))
      .rejects.toMatchObject({ code: 'session/live' })
  })
})
