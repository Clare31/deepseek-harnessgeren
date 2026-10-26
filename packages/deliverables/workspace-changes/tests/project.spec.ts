/** Real Git repository reads cover index preservation, unusual paths, and explicit unavailable states. */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { GitRunner } from '../src/git.ts'
import { readProject, readProjectDiff } from '../src/project.ts'
import { git, scratchDir } from './support.ts'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup()
  cleanups.length = 0
}, 30_000)

async function fixture() {
  const cwd = await scratchDir('dsh-project-', cleanups)
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  await ctx.plugin(LocalSubprocessRuntime)
  const runner = new GitRunner(ctx.subprocess, await ctx.subprocess.resolveExecutable('git'), { timeoutMs: 30_000, outputMaxBytes: 1024 * 1024 })
  return { cwd, runner, signal: new AbortController().signal }
}

describe('current project', () => {
  it('includes staged, unstaged, untracked, deleted, and binary files without changing the index or refs', async () => {
    const { cwd, runner, signal } = await fixture()
    git(cwd, 'init', '-q', '-b', 'main')
    await writeFile(join(cwd, 'tracked.txt'), 'before\n')
    await writeFile(join(cwd, 'deleted.txt'), 'gone\n')
    await writeFile(join(cwd, '.gitignore'), 'ignored.txt\n')
    git(cwd, 'add', '-A')
    git(cwd, 'commit', '-qm', 'seed')
    const head = git(cwd, 'rev-parse', 'HEAD').trim()
    await writeFile(join(cwd, 'tracked.txt'), 'staged\n')
    git(cwd, 'add', 'tracked.txt')
    await writeFile(join(cwd, 'tracked.txt'), 'after\nmore\n')
    git(cwd, 'rm', '-q', 'deleted.txt')
    await writeFile(join(cwd, '新 file\t[1].txt'), 'new\n')
    await writeFile(join(cwd, 'image.bin'), Buffer.from([0, 1, 2]))
    await writeFile(join(cwd, 'empty'), '')
    await writeFile(join(cwd, 'ignored.txt'), 'ignored\n')
    const index = await readFile(join(cwd, '.git', 'index'))
    const status = git(cwd, 'status', '--porcelain', '-z')
    const project = await readProject(runner, cwd, 50, signal)
    expect(project).toMatchObject({ kind: 'repository', base: head, branch: 'main', added: 3, deleted: 2, total: 5 })
    if (project.kind !== 'repository') throw new Error('Expected repository')
    expect(project.files.find(file => file.path === 'image.bin')).toMatchObject({ binary: true, added: 0 })
    expect(project.files.some(file => file.path === '新 file\t[1].txt')).toBe(true)
    const diff = await readProjectDiff(runner, cwd, 'tracked.txt', 50, 1024, signal)
    expect(diff).toMatchObject({ kind: 'text', before: true, after: true })
    if (diff?.kind !== 'text') throw new Error('Expected text')
    expect(diff.hunks.flatMap(hunk => hunk.lines)).toEqual(['-before', '+after', '+more'])
    expect(await readProjectDiff(runner, cwd, 'ignored.txt', 50, 1024, signal)).toBeUndefined()
    expect(await readProjectDiff(runner, cwd, '../outside', 50, 1024, signal)).toBeUndefined()
    expect(await readProjectDiff(runner, cwd, 'image.bin', 50, 1024, signal)).toMatchObject({ kind: 'binary' })
    expect(await readProjectDiff(runner, cwd, 'deleted.txt', 50, 1024, signal)).toMatchObject({ kind: 'text', before: true, after: false })
    expect(await readFile(join(cwd, '.git', 'index'))).toEqual(index)
    expect(git(cwd, 'rev-parse', 'HEAD').trim()).toBe(head)
    expect(git(cwd, 'status', '--porcelain', '-z')).toBe(status)
  }, 30_000)

  it('resolves files from a nested Session directory and ignores diff.relative configuration', async () => {
    const { cwd, runner, signal } = await fixture()
    git(cwd, 'init', '-q', '-b', 'main')
    await mkdir(join(cwd, 'nested'))
    await writeFile(join(cwd, 'root.txt'), 'base\n')
    git(cwd, 'add', '-A')
    git(cwd, 'commit', '-qm', 'seed')
    git(cwd, 'config', 'diff.relative', 'true')
    await writeFile(join(cwd, 'root.txt'), 'changed\n')
    await writeFile(join(cwd, 'nested', 'new.txt'), 'new\n')
    const project = await readProject(runner, join(cwd, 'nested'), 1, signal)
    expect(project).toMatchObject({ kind: 'repository', total: 2, added: 2, deleted: 1 })
    if (project.kind !== 'repository') throw new Error('Expected repository')
    expect(project.files).toHaveLength(1)
    const full = await readProject(runner, join(cwd, 'nested'), 50, signal)
    if (full.kind !== 'repository') throw new Error('Expected repository')
    expect(full.files.map(file => file.path)).toEqual(['../root.txt', 'new.txt'])
    expect(await readProjectDiff(runner, join(cwd, 'nested'), 'new.txt', 50, 1024, signal)).toMatchObject({ kind: 'text', before: false })
  })

  it('handles unborn and detached branches, clean repositories, missing Git, and non-repositories', async () => {
    const { cwd, runner, signal } = await fixture()
    expect(await readProject(null, cwd, 50, signal)).toEqual({ kind: 'unavailable', reason: 'git-missing' })
    expect(await readProject(runner, cwd, 50, signal)).toEqual({ kind: 'unavailable', reason: 'not-repository' })
    git(cwd, 'init', '-q', '-b', 'main')
    await writeFile(join(cwd, 'new.txt'), 'new\n')
    expect(await readProject(runner, cwd, 50, signal)).toMatchObject({ kind: 'repository', base: null, added: 1 })
    git(cwd, 'add', '-A')
    expect(await readProjectDiff(runner, cwd, 'new.txt', 50, 1024, signal)).toMatchObject({ kind: 'text', before: false })
    git(cwd, 'commit', '-qm', 'seed')
    git(cwd, 'checkout', '--detach', '-q')
    expect(await readProject(runner, cwd, 50, signal)).toMatchObject({ kind: 'repository', total: 0, files: [], added: 0, deleted: 0 })
  })

  it('refuses truncated listings and marks oversized patches explicitly', async () => {
    const { cwd, runner, signal } = await fixture()
    git(cwd, 'init', '-q', '-b', 'main')
    await writeFile(join(cwd, 'large.txt'), 'line\n'.repeat(500))
    expect(await readProjectDiff(runner, cwd, 'large.txt', 50, 50, signal)).toMatchObject({ kind: 'oversized' })
    const aborted = new AbortController()
    aborted.abort()
    await expect(readProject(runner, cwd, 50, aborted.signal)).rejects.toThrow()
  })
})
