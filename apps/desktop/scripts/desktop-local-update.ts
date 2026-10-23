/**
 * Local daily-build updater for the Linux Desktop application.
 *
 * `update` builds the commit that the target GitHub branch points to, checks and stages it, and only
 * then replaces the daily installation. `rollback` restores the previously installed version, and
 * `status` and `launch` report and start the installed daily build. Data directories are copied into
 * a backup before an install, and are never moved or deleted by these commands.
 */

import { execFile, spawn } from 'node:child_process'
import { readFile, readdir, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { desktopTargetBuildPaths } from './desktop-build-paths.mjs'
import {
  acquireUpdateLock,
  appendJournal,
  assertUnpackedBuild,
  assertVersionTree,
  backupUserData,
  BUILD_RECORD_SCHEMA_VERSION,
  type BuildRecord,
  type DataSource,
  discardStagedVersion,
  entryExists,
  LEGACY_SYSTEM_INSTALL,
  LINUX_EXECUTABLE_NAME,
  LINUX_UNPACKED_DIRECTORY,
  type LinkState,
  type LocalInstallLayout,
  processesRunningFrom,
  promoteStagedVersion,
  pruneVersions,
  readBuildRecord,
  readLinkState,
  readLinkTarget,
  renderDesktopEntry,
  resolveLocalInstallLayout,
  rollbackCurrentVersion,
  stageVersion,
  switchCurrentVersion,
  versionDirectoryName,
  writeDesktopEntry,
  writeLinkState,
} from './desktop-local-install.ts'
import { verifyIsolatedLaunch } from './desktop-local-launch.ts'

const REPOSITORY_ROOT = resolve(import.meta.dirname, '..', '..', '..')
const APP_ROOT = resolve(import.meta.dirname, '..')
const PACKAGING_RUNS = join(APP_ROOT, '.desktop-build', 'packaging-runs')

/** Remote and branch that the daily build may be installed from. */
const REMOTE_NAME = 'origin'
const TARGET_BRANCH = 'linux-desktop'
const REMOTE_URL_PATTERN = /^(?:https:\/\/github\.com\/|git@github\.com:)Clare31\/deepseek-harnessgeren(?:\.git)?$/u

/** Installed versions kept besides the linked ones. */
const RETAINED_VERSIONS = 3

/** Installation stages reported by `update`. */
const UPDATE_STAGES = 5

const COMMANDS = ['update', 'status', 'rollback', 'launch'] as const
type Command = (typeof COMMANDS)[number]

type BuildTarget = 'linux-x64' | 'linux-arm64'

interface SourceState {
  readonly commit: string
  readonly version: string
  readonly target: BuildTarget
}

function say(text: string): void {
  process.stdout.write(`${text}\n`)
}

async function main(): Promise<void> {
  const { positionals } = parseArgs({ allowPositionals: true, options: {} })
  const command = positionals[0] ?? 'update'
  if (!(COMMANDS as readonly string[]).includes(command)) {
    throw new Error(`desktop local update: unknown command ${command}; expected ${COMMANDS.join(', ')}`)
  }
  if (process.platform !== 'linux') throw new Error('desktop local update: the daily build is installed on Linux only')
  const layout = resolveLocalInstallLayout(homedir())
  switch (command as Command) {
    case 'update': return update(layout)
    case 'rollback': return rollback(layout)
    case 'status': return printStatus(layout)
    case 'launch': return launchDaily(layout)
  }
}

async function update(layout: LocalInstallLayout): Promise<void> {
  const lock = await acquireUpdateLock(layout.lock)
  let stage = 0
  let dailyLinks: LinkState | undefined
  let stagingDirectory: string | undefined
  let promotedDirectory: string | undefined
  const enter = (name: string): void => {
    stage += 1
    say(`[${String(stage)}/${String(UPDATE_STAGES)}] ${name}`)
  }
  try {
    enter('检查源码与远端版本')
    const source = await verifySourceAgainstRemote()
    say(`  commit ${source.commit} (${source.version}); ${REMOTE_NAME}/${TARGET_BRANCH} points to the same commit`)
    const running = await processesRunningFrom([layout.root, LEGACY_SYSTEM_INSTALL])
    if (running.length > 0) say(`  daily build is running (${String(running.length)} processes); it is left running`)

    enter('构建')
    const unpacked = await buildUnpacked(source)
    await assertSourceUnchanged(source.commit, '构建期间')
    say(`  built ${unpacked}`)

    enter('检查')
    await assertUnpackedBuild(unpacked)
    const record: BuildRecord = {
      schemaVersion: BUILD_RECORD_SCHEMA_VERSION,
      version: source.version,
      commit: source.commit,
      branch: TARGET_BRANCH,
      builtAt: new Date().toISOString(),
      target: source.target,
    }
    const name = versionDirectoryName(record)
    const staged = await stageVersion(layout, unpacked, record)
    stagingDirectory = staged.staging
    const stagedLaunch = await verifyIsolatedLaunch({
      executable: join(staged.staging, LINUX_EXECUTABLE_NAME),
      dataRoot: join(layout.evidence, name, 'staging-data'),
      evidenceDirectory: join(layout.evidence, name, 'staging'),
    })
    say(`  isolated launch of the staged copy rendered "${stagedLaunch.pageTitle || stagedLaunch.pageUrl}"; screenshot ${stagedLaunch.screenshot}`)

    enter('安装')
    const backup = await backupUserData(layout, dataSources(), timestampForPath(new Date()))
    say(`  data backup ${backup.directory} (${backup.copied.join(', ') || 'no existing data'})`)
    await promoteStagedVersion(staged.staging, staged.version)
    stagingDirectory = undefined
    promotedDirectory = staged.version
    const switched = await switchCurrentVersion(layout, staged.version)
    dailyLinks = switched.before
    await writeDailyEntry(layout, record)
    await writeDevelopmentEntry(layout)
    say(`  current -> ${staged.version}`)

    enter('启动验证')
    const installed = await assertVersionTree(staged.version, source.commit)
    const executable = await dailyEntryExecutable(layout)
    if (executable !== join(layout.current, LINUX_EXECUTABLE_NAME)) throw new Error('menu entry does not launch the current link')
    const launched = await verifyIsolatedLaunch({
      executable,
      dataRoot: join(layout.evidence, name, 'installed-data'),
      evidenceDirectory: join(layout.evidence, name, 'installed'),
    })
    say(`  installed ${installed.commit} launched from ${executable}; isolated page "${launched.pageTitle || launched.pageUrl}"`)
    say(`  screenshot ${launched.screenshot}`)
    dailyLinks = undefined
    await appendJournal(layout, { stage: 'installed', commit: source.commit, version: source.version, directory: staged.version })
    const removed = await pruneVersions(layout, RETAINED_VERSIONS, async directory => (await processesRunningFrom([directory])).length > 0)
    if (removed.length > 0) say(`  removed old versions: ${removed.join(', ')}`)
    say('Open "DeepSeek Harness (日常版)" from the application menu. A daily window already open with the same data must be closed first.')
  } catch (error) {
    const restored = dailyLinks === undefined ? undefined : await restoreLinks(layout, dailyLinks)
    if (promotedDirectory !== undefined && restored !== false && !(await linkedTo(layout, promotedDirectory))) {
      await rm(promotedDirectory, { recursive: true, force: true })
    }
    if (stagingDirectory !== undefined) await discardStagedVersion(stagingDirectory)
    await appendJournal(layout, { stage: 'failed', failedStage: stage, message: messageOf(error) }).catch(() => undefined)
    const outcome = dailyLinks === undefined ? 'the daily build was not replaced' : restored === true ? 'the previous daily links were restored' : 'the daily links could not be restored; inspect them'
    throw new Error(`desktop local update: failed at stage ${String(stage)} of ${String(UPDATE_STAGES)}: ${messageOf(error)}; ${outcome}`)
  } finally {
    await lock.release()
  }
}

async function restoreLinks(layout: LocalInstallLayout, before: LinkState): Promise<boolean> {
  try {
    await writeLinkState(layout, before)
    return true
  } catch (error) {
    say(`restoring links failed: ${messageOf(error)}`)
    return false
  }
}

async function linkedTo(layout: LocalInstallLayout, directory: string): Promise<boolean> {
  const state = await readLinkState(layout)
  return state.current === directory || state.previous === directory
}

async function rollback(layout: LocalInstallLayout): Promise<void> {
  const lock = await acquireUpdateLock(layout.lock)
  try {
    const running = await processesRunningFrom([layout.root, LEGACY_SYSTEM_INSTALL])
    if (running.length > 0) say(`daily build is running (${String(running.length)} processes); restart it to use the rolled-back build. Nothing is terminated.`)
    const result = await rollbackCurrentVersion(layout)
    const record = result.after.current === undefined ? undefined : await readBuildRecordIfPresent(result.after.current)
    await writeDailyEntry(layout, record)
    await appendJournal(layout, { stage: 'rollback', from: result.before.current, to: result.after.current })
    say(`current -> ${String(result.after.current)}; previous -> ${String(result.after.previous)}`)
    say(`Rolling back the program does not downgrade data. A session or setting written by the newer build may be unreadable by the older one; restore the matching backup from ${layout.backups} if that happens.`)
  } finally {
    await lock.release()
  }
}

async function printStatus(layout: LocalInstallLayout): Promise<void> {
  const links = await readLinkState(layout)
  const record = links.current === undefined ? undefined : await readBuildRecordIfPresent(links.current)
  say(`daily current: ${links.current ?? 'not installed'}`)
  say(`daily commit: ${record === undefined ? 'unknown' : `${record.commit} (${record.version}, built ${record.builtAt})`}`)
  say(`daily previous: ${links.previous ?? 'none'}`)
  say(`daily processes running: ${String((await processesRunningFrom([layout.root, LEGACY_SYSTEM_INSTALL])).length)}`)
  const remote = await remoteHead().then(commit => commit, (error: unknown) => `unavailable (${messageOf(error)})`)
  say(`remote ${REMOTE_NAME}/${TARGET_BRANCH}: ${remote}`)
  say(`repository HEAD: ${(await git(['rev-parse', 'HEAD'])).trim()}`)
  say(`menu entry: ${layout.dailyEntry} (${await entryExists(layout.dailyEntry) ? 'present' : 'missing'})`)
  say(`development entry: ${layout.developmentEntry} (${await entryExists(layout.developmentEntry) ? 'present' : 'missing'})`)
  for (const source of dataSources()) say(`data ${source.name}: ${source.path}`)
}

async function launchDaily(layout: LocalInstallLayout): Promise<void> {
  if (await readLinkTarget(layout.current) === undefined) throw new Error('desktop local update: no daily build is installed')
  const executable = join(layout.current, LINUX_EXECUTABLE_NAME)
  const child = spawn(executable, [], { detached: true, stdio: 'ignore' })
  child.unref()
  say(`started the daily build (pid ${String(child.pid)}) from ${executable}`)
}

async function verifySourceAgainstRemote(): Promise<SourceState> {
  const branch = (await git(['rev-parse', '--abbrev-ref', 'HEAD'])).trim()
  if (branch !== TARGET_BRANCH) throw new Error(`checkout is on ${branch}; switch to ${TARGET_BRANCH} before updating`)
  const remoteUrl = (await git(['remote', 'get-url', REMOTE_NAME])).trim()
  if (!REMOTE_URL_PATTERN.test(remoteUrl)) throw new Error(`${REMOTE_NAME} is not the Clare31/deepseek-harnessgeren repository`)
  await assertCleanTree('the working tree has uncommitted or untracked changes; commit and push them first')
  const commit = (await git(['rev-parse', 'HEAD'])).trim()
  const remote = await remoteHead()
  if (remote !== commit) throw new Error(`HEAD ${commit} is not ${REMOTE_NAME}/${TARGET_BRANCH} ${remote}; push or pull before updating`)
  const manifest = JSON.parse(await readFile(join(APP_ROOT, 'package.json'), 'utf8')) as { version?: unknown }
  if (typeof manifest.version !== 'string' || manifest.version === '') throw new Error('apps/desktop/package.json has no version')
  return { commit, version: manifest.version, target: hostTarget() }
}

async function assertSourceUnchanged(commit: string, when: string): Promise<void> {
  const head = (await git(['rev-parse', 'HEAD'])).trim()
  if (head !== commit) throw new Error(`HEAD changed ${when} (${commit} -> ${head})`)
  await assertCleanTree(`the working tree changed ${when}; the build is not from a clean ${commit}`)
}

async function assertCleanTree(message: string): Promise<void> {
  if ((await git(['status', '--porcelain', '--untracked-files=normal'])).trim() !== '') throw new Error(message)
}

async function buildUnpacked(source: SourceState): Promise<string> {
  const directory = join(desktopTargetBuildPaths(source.target).unsignedArtifacts, LINUX_UNPACKED_DIRECTORY)
  await rm(directory, { recursive: true, force: true })
  const started = Date.now()
  await runPnpmScript(`package:${source.target.replace('-', ':')}:dir`)
  await assertPackagingRecord(source.commit, started)
  return directory
}

/**
 * Confirm that the packaging run which produced this build started after the update began, succeeded,
 * and recorded the same clean commit.
 */
async function assertPackagingRecord(commit: string, started: number): Promise<void> {
  const names = (await readdir(PACKAGING_RUNS, { withFileTypes: true }).catch(() => []))
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort()
    .reverse()
  for (const name of names) {
    const run = JSON.parse(await readFile(join(PACKAGING_RUNS, name, 'run.json'), 'utf8')) as { startedAt?: string; commit?: string; dirty?: boolean }
    if (run.startedAt === undefined || Date.parse(run.startedAt) < started - 2000) continue
    const result = JSON.parse(await readFile(join(PACKAGING_RUNS, name, 'result.json'), 'utf8').catch(() => '{}')) as { success?: boolean }
    if (result.success !== true) throw new Error(`packaging run ${name} did not succeed`)
    if (run.commit !== commit || run.dirty !== false) throw new Error(`packaging run ${name} recorded ${String(run.commit)} dirty=${String(run.dirty)}, not ${commit}`)
    return
  }
  throw new Error('no packaging record was written for this build')
}

async function writeDailyEntry(layout: LocalInstallLayout, record: BuildRecord | undefined): Promise<void> {
  const comment = record === undefined
    ? 'DeepSeek Harness daily build'
    : `DeepSeek Harness daily build ${record.commit.slice(0, 12)} (${record.version})`
  await writeDesktopEntry(layout.dailyEntry, renderDesktopEntry({
    name: 'DeepSeek Harness (日常版)',
    comment,
    executable: join(layout.current, LINUX_EXECUTABLE_NAME),
    execArguments: [],
    trailing: '%U',
    icon: join(layout.current, 'resources', 'icon.png'),
    startupWMClass: 'DeepSeek Harness',
  }))
}

async function writeDevelopmentEntry(layout: LocalInstallLayout): Promise<void> {
  await writeDesktopEntry(layout.developmentEntry, renderDesktopEntry({
    name: 'DeepSeek Harness (开发版)',
    comment: `Development build from ${REPOSITORY_ROOT}; starts with pnpm run dev:desktop`,
    executable: '/bin/sh',
    execArguments: ['-lc', `cd "${join(REPOSITORY_ROOT, 'apps', 'desktop')}" && exec pnpm run dev:desktop`],
    trailing: '',
    icon: join(REPOSITORY_ROOT, 'apps', 'desktop', 'resources', 'icon.png'),
    startupWMClass: 'DeepSeek Harness',
  }))
}

/** Read the executable from the Exec line of the daily menu entry, undoing the quoting that the entry writer applied. */
async function dailyEntryExecutable(layout: LocalInstallLayout): Promise<string> {
  const line = (await readFile(layout.dailyEntry, 'utf8')).split('\n').find(candidate => candidate.startsWith('Exec='))
  const match = line === undefined ? null : /^Exec="((?:[^"\\]|\\.)*)"/u.exec(line)
  if (match === null || match[1] === undefined) throw new Error('menu entry does not start with a quoted executable')
  return match[1].replace(/\\(.)/gu, '$1')
}

async function readBuildRecordIfPresent(directory: string): Promise<BuildRecord | undefined> {
  try {
    return await readBuildRecord(directory)
  } catch {
    // A link to the legacy system install or to a removed version has no build record.
    return undefined
  }
}

function dataSources(): DataSource[] {
  const home = homedir()
  return [
    { name: 'harness-home', path: join(home, '.dsh') },
    { name: 'electron-user-data', path: join(home, '.config', '@deepseek-ai', 'dsh-desktop') },
  ]
}

async function remoteHead(): Promise<string> {
  const text = await git(['ls-remote', REMOTE_NAME, `refs/heads/${TARGET_BRANCH}`])
  const match = /^([0-9a-f]{40})\s+refs\/heads\//mu.exec(text)
  if (match === null || match[1] === undefined) throw new Error(`${REMOTE_NAME} has no ${TARGET_BRANCH} branch`)
  return match[1]
}

function hostTarget(): BuildTarget {
  if (process.arch === 'x64') return 'linux-x64'
  if (process.arch === 'arm64') return 'linux-arm64'
  throw new Error(`unsupported architecture ${process.arch}`)
}

function timestampForPath(date: Date): string {
  return date.toISOString().replace(/\D/gu, '').slice(0, 14)
}

function runPnpmScript(script: string): Promise<void> {
  const packageManager = process.env.npm_execpath
  if (packageManager === undefined || packageManager === '') {
    throw new Error('run this updater through pnpm run desktop:update:local')
  }
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [packageManager, 'run', script], { cwd: APP_ROOT, env: process.env, stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolvePromise()
      else reject(new Error(`pnpm run ${script} exited with ${String(code ?? signal)}`))
    })
  })
}

function git(args: readonly string[]): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    execFile('git', [...args], { cwd: REPOSITORY_ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error !== null) reject(new Error(`git ${args[0] ?? ''} failed: ${stderr.trim() || error.message}`))
      else resolvePromise(stdout)
    })
  })
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

await main().catch((error: unknown) => {
  say(messageOf(error))
  process.exitCode = 1
})
