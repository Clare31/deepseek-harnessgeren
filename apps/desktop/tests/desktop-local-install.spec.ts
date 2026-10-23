import { spawn } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, readlink, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  acquireUpdateLock,
  assertUnpackedBuild,
  assertVersionTree,
  backupUserData,
  BUILD_RECORD_SCHEMA_VERSION,
  type BuildRecord,
  LEGACY_SYSTEM_INSTALL,
  type LocalInstallLayout,
  processesRunningFrom,
  promoteStagedVersion,
  pruneVersions,
  quoteExecArgument,
  readLinkState,
  renderDesktopEntry,
  replaceSymbolicLink,
  resolveLocalInstallLayout,
  rollbackCurrentVersion,
  stageVersion,
  switchCurrentVersion,
  versionDirectoryName,
  writeLinkState,
} from '../scripts/desktop-local-install.ts'
import { isolatedLaunchEnvironment } from '../scripts/desktop-local-launch.ts'

let root: string
let layout: LocalInstallLayout

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dsh-local-install-'))
  layout = resolveLocalInstallLayout(join(root, 'home'))
  await mkdir(layout.root, { recursive: true })
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
})

function record(commit: string, builtAt: string): BuildRecord {
  return { schemaVersion: BUILD_RECORD_SCHEMA_VERSION, version: '0.2.1-rc.2', commit, branch: 'linux-desktop', builtAt, target: 'linux-x64' }
}

/** Create a fake unpacked build with the files the installer checks. */
async function fakeBuild(name: string, marker: string): Promise<string> {
  const directory = join(root, 'builds', name)
  await mkdir(join(directory, 'resources', 'runtime'), { recursive: true })
  await mkdir(join(directory, 'resources', 'app'), { recursive: true })
  await writeFile(join(directory, 'resources', 'app', 'package.json'), marker)
  await writeFile(join(directory, 'deepseek-harness'), '#!/bin/sh\nexit 0\n')
  await chmod(join(directory, 'deepseek-harness'), 0o755)
  return directory
}

/** Stage and promote a fake build, returning its installed directory. */
async function install(name: string, commit: string, builtAt: string): Promise<string> {
  const source = await fakeBuild(name, commit)
  const staged = await stageVersion(layout, source, record(commit, builtAt))
  await promoteStagedVersion(staged.staging, staged.version)
  return staged.version
}

describe('desktop local install layout', () => {
  it('keeps daily installation and state under the user home and never in the system install', () => {
    expect(layout.root).toBe(join(root, 'home', '.local', 'opt', 'deepseek-harness'))
    expect(layout.current).toBe(join(layout.root, 'current'))
    expect(layout.dailyEntry).toBe(join(root, 'home', '.local', 'share', 'applications', 'deepseek-harness.desktop'))
    expect(layout.root.startsWith(LEGACY_SYSTEM_INSTALL)).toBe(false)
  })
})

describe('version links', () => {
  it('points previous at the legacy install on first installation, then at the replaced build', async () => {
    const legacy = join(root, 'legacy')
    await mkdir(legacy)
    const first = await install('first', 'a'.repeat(40), '2026-10-22T10:00:00.000Z')
    const firstSwitch = await switchCurrentVersion(layout, first, legacy)
    expect(firstSwitch.after).toEqual({ current: first, previous: legacy })

    const second = await install('second', 'b'.repeat(40), '2026-10-22T11:00:00.000Z')
    await switchCurrentVersion(layout, second, legacy)
    expect(await readLinkState(layout)).toEqual({ current: second, previous: first })
  })

  it('swaps current and previous on rollback and refuses a rollback with no previous version', async () => {
    const first = await install('first', 'a'.repeat(40), '2026-10-22T10:00:00.000Z')
    const second = await install('second', 'b'.repeat(40), '2026-10-22T11:00:00.000Z')
    await switchCurrentVersion(layout, first, join(root, 'absent'))
    await switchCurrentVersion(layout, second, join(root, 'absent'))
    const rolled = await rollbackCurrentVersion(layout)
    expect(rolled.after).toEqual({ current: first, previous: second })
    expect(await readlink(layout.current)).toBe(first)

    await rm(layout.previous, { force: true })
    await expect(rollbackCurrentVersion(layout)).rejects.toThrow('no previous version')
  })

  it('restores the previous link when the current link cannot be replaced', async () => {
    const first = await install('first', 'a'.repeat(40), '2026-10-22T10:00:00.000Z')
    const second = await install('second', 'b'.repeat(40), '2026-10-22T11:00:00.000Z')
    await writeLinkState(layout, { current: undefined, previous: first })
    // A directory at the current path cannot be replaced by a symbolic link, so the second write fails.
    await mkdir(join(layout.current, 'occupied'), { recursive: true })
    await expect(writeLinkState(layout, { current: second, previous: undefined })).rejects.toThrow()
    expect(await readlink(layout.previous)).toBe(first)
  })

  it('replaces a symbolic link atomically without leaving temporary links behind', async () => {
    const target = join(root, 'target')
    await mkdir(target)
    await replaceSymbolicLink(join(root, 'link'), target)
    await replaceSymbolicLink(join(root, 'link'), join(root, 'other'))
    expect(await readlink(join(root, 'link'))).toBe(join(root, 'other'))
    await expect(stat(join(root, 'link.tmp-' + String(process.pid)))).rejects.toThrow()
  })
})

describe('version staging', () => {
  it('stages a copy with a build record and refuses to reuse an existing version name', async () => {
    const source = await fakeBuild('source', 'c'.repeat(40))
    const built = record('c'.repeat(40), '2026-10-22T12:00:00.000Z')
    const staged = await stageVersion(layout, source, built)
    expect(staged.version).toBe(join(layout.versions, versionDirectoryName(built)))
    expect(staged.staging).not.toBe(staged.version)
    await expect(stat(staged.version)).rejects.toThrow()
    await promoteStagedVersion(staged.staging, staged.version)
    expect(await assertVersionTree(staged.version, 'c'.repeat(40))).toEqual(built)
    await expect(stageVersion(layout, source, built)).rejects.toThrow('already exists')
  })

  it('rejects a version whose build record names another commit or lacks the executable', async () => {
    const version = await install('one', 'd'.repeat(40), '2026-10-22T13:00:00.000Z')
    await expect(assertVersionTree(version, 'e'.repeat(40))).rejects.toThrow('expected')
    await rm(join(version, 'deepseek-harness'))
    await expect(assertVersionTree(version)).rejects.toThrow()
  })

  it('rejects an unpacked build without an executable bit', async () => {
    const source = await fakeBuild('mode', 'f'.repeat(40))
    await chmod(join(source, 'deepseek-harness'), 0o644)
    await expect(assertUnpackedBuild(source)).rejects.toThrow('not executable')
  })
})

describe('pruning', () => {
  it('keeps the newest versions and every linked version, and skips versions that still run', async () => {
    const versions = [
      await install('v1', '1'.repeat(40), '2026-10-01T00:00:00.000Z'),
      await install('v2', '2'.repeat(40), '2026-10-02T00:00:00.000Z'),
      await install('v3', '3'.repeat(40), '2026-10-03T00:00:00.000Z'),
      await install('v4', '4'.repeat(40), '2026-10-04T00:00:00.000Z'),
      await install('v5', '5'.repeat(40), '2026-10-05T00:00:00.000Z'),
    ]
    await switchCurrentVersion(layout, versions[4]!, join(root, 'absent'))
    const busy = versions[1]!
    const removed = await pruneVersions(layout, 1, async directory => directory === busy)
    // Only the newest version is retained by count; v2 survives because a process still runs from it.
    expect(removed.sort()).toEqual([versions[0]!, versions[2]!, versions[3]!].sort())
    expect(await readlink(layout.current)).toBe(versions[4])
    await expect(stat(busy)).resolves.toBeDefined()
  })
})

describe('update lock', () => {
  it('refuses a second holder while the first is alive and takes over after the owner exits', async () => {
    const lockPath = join(layout.state, 'update.lock')
    const first = await acquireUpdateLock(lockPath)
    await expect(acquireUpdateLock(lockPath)).rejects.toThrow('another update or rollback is running')
    await first.release()

    const dead = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' })
    await new Promise<void>(resolvePromise => dead.once('exit', () =>{  resolvePromise() }))
    await mkdir(lockPath, { recursive: true })
    await writeFile(join(lockPath, 'owner.json'), JSON.stringify({ pid: dead.pid, startedAt: new Date().toISOString() }))
    const taken = await acquireUpdateLock(lockPath)
    await taken.release()
    await expect(stat(lockPath)).rejects.toThrow()
  })
})

describe('desktop entry rendering', () => {
  it('quotes executable paths with spaces and leaves field codes unquoted', () => {
    const entry = renderDesktopEntry({
      name: 'DeepSeek Harness (日常版)',
      comment: 'comment',
      executable: '/home/u/My Apps/deepseek-harness',
      execArguments: [],
      trailing: '%U',
      icon: '/home/u/My Apps/resources/icon.png',
      startupWMClass: 'DeepSeek Harness',
    })
    expect(entry).toContain('Exec="/home/u/My Apps/deepseek-harness" %U\n')
    expect(entry).toContain('TryExec=/home/u/My Apps/deepseek-harness\n')
    expect(entry.startsWith('[Desktop Entry]\nType=Application\n')).toBe(true)
  })

  it('escapes the characters the Exec quoting rules reserve', () => {
    expect(quoteExecArgument('a"b$c`d\\e')).toBe('"a\\"b\\$c\\`d\\\\e"')
  })
})

describe('user data backup', () => {
  it('copies existing data into an owner-only backup and skips missing sources', async () => {
    const harness = join(root, 'data', 'dsh')
    await mkdir(harness, { recursive: true })
    await writeFile(join(harness, 'settings.yaml'), 'value: 1\n')
    const result = await backupUserData(layout, [
      { name: 'harness-home', path: harness },
      { name: 'electron-user-data', path: join(root, 'data', 'absent') },
    ], '20261022120000')
    expect(result.copied).toEqual(['harness-home'])
    expect(await readFile(join(result.directory, 'harness-home', 'settings.yaml'), 'utf8')).toBe('value: 1\n')
    expect((await stat(result.directory)).mode & 0o777).toBe(0o700)
  })
})

describe('process discovery', () => {
  it('finds the running test process by the directory of its executable', async () => {
    const directory = dirname(await realpath(process.execPath))
    expect(await processesRunningFrom([directory])).toContain(process.pid)
    expect(await processesRunningFrom([join(root, 'nothing-runs-here')])).toEqual([])
  })
})

describe('isolated launch environment', () => {
  it('removes development and workspace variables and points Harness home at the isolated directory', () => {
    const environment = isolatedLaunchEnvironment({
      PATH: '/usr/bin',
      DSH_DESKTOP_PRIMARY_RUNTIME_DIR: '/dev/runtime',
      ELECTRON_RUN_AS_NODE: '1',
      npm_execpath: '/pnpm',
      NODE_OPTIONS: '--inspect',
      HOME: '/home/u',
    }, '/tmp/isolated/home')
    expect(environment).toEqual({ PATH: '/usr/bin', HOME: '/home/u', DSH_HOME: '/tmp/isolated/home' })
  })
})
