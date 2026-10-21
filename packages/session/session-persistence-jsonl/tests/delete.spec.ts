import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import { SessionPersistenceInUseError } from '@deepseek-ai/dsh-session-persistence'
import * as JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { meta, oneTurnLog } from '../../session-persistence/tests/contract.ts'
import { sessionDir } from '../src/format.ts'

const roots: string[] = []
const contexts: Context[] = []

async function rootDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-jsonl-delete-'))
  roots.push(dir)
  return dir
}

async function persistence(root: string): Promise<Context> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })
  return ctx
}

async function storedSession(ctx: Context, id: string): Promise<void> {
  const handle = await ctx.sessionPersistence.create(meta(id, '/workspace'))
  await handle.append(oneTurnLog())
  await handle.flush()
  await handle.close()
}

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(roots.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('JSONL permanent session deletion', () => {
  it('removes the session directory and every stored artifact', async () => {
    const root = await rootDir()
    const ctx = await persistence(root)
    await storedSession(ctx, 'doomed')
    const dir = sessionDir(root, '/workspace', SessionId('doomed'))
    await expect(stat(dir)).resolves.toBeDefined()

    await expect(ctx.sessionPersistence.delete(SessionId('doomed'))).resolves.toBeUndefined()

    await expect(ctx.sessionPersistence.stat(SessionId('doomed'))).resolves.toBeUndefined()
    await expect(stat(dir)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('is idempotent for a session that no longer exists', async () => {
    const ctx = await persistence(await rootDir())
    await expect(ctx.sessionPersistence.delete(SessionId('missing'))).resolves.toBeUndefined()
  })

  it('refuses while a read handle is open and succeeds after it closes', async () => {
    const ctx = await persistence(await rootDir())
    await storedSession(ctx, 'busy')
    const handle = await ctx.sessionPersistence.open(SessionId('busy'), 'read')
    try {
      await expect(ctx.sessionPersistence.delete(SessionId('busy')))
        .rejects.toBeInstanceOf(SessionPersistenceInUseError)
    } finally {
      await handle.close()
    }
    await expect(ctx.sessionPersistence.delete(SessionId('busy'))).resolves.toBeUndefined()
  })

  it('refuses a created session that has not materialized', async () => {
    const ctx = await persistence(await rootDir())
    const handle = await ctx.sessionPersistence.create(meta('pending', '/workspace'))
    await expect(ctx.sessionPersistence.delete(SessionId('pending')))
      .rejects.toBeInstanceOf(SessionPersistenceInUseError)
    await handle.close()
    await expect(ctx.sessionPersistence.delete(SessionId('pending'))).resolves.toBeUndefined()
  })

  it('refuses while another backend instance holds the write lease', async () => {
    const root = await rootDir()
    const first = await persistence(root)
    await storedSession(first, 'owned')
    const second = await persistence(root)
    const writer = await second.sessionPersistence.open(SessionId('owned'), 'write')
    try {
      await expect(first.sessionPersistence.delete(SessionId('owned')))
        .rejects.toBeInstanceOf(SessionPersistenceInUseError)
    } finally {
      await writer.close()
    }
    await expect(first.sessionPersistence.delete(SessionId('owned'))).resolves.toBeUndefined()
  })
})
