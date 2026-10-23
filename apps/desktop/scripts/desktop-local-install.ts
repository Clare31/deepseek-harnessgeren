/**
 * User-local installation of the daily Linux Desktop build.
 *
 * Each build is copied into an immutable version directory. `current` and `previous` are symbolic
 * links replaced atomically; a version directory is removed only after no running process uses it.
 * Application data stays in the ordinary Harness home and Electron profile, which this module never
 * rewrites.
 */

import { spawn } from 'node:child_process'
import { access, appendFile, copyFile, lstat, mkdir, readdir, readFile, readlink, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, sep } from 'node:path'

/** Executable name of the unpacked Linux application, fixed by the electron-builder configuration. */
export const LINUX_EXECUTABLE_NAME = 'deepseek-harness'

/** Electron-builder unpacked directory name produced under the unsigned artifact directory. */
export const LINUX_UNPACKED_DIRECTORY = 'linux-unpacked'

/** Application directory under resources; Linux packages disable asar, so the app is unpacked here. */
export const LINUX_APPLICATION_DIRECTORY = join('resources', 'app')

/** Installation used before this layout existed; the previous link points here when no earlier daily build exists. */
export const LEGACY_SYSTEM_INSTALL = '/opt/DeepSeek Harness'

/** Name of the desktop entry file for the daily build, which overrides the system entry with the same ID. */
export const DAILY_DESKTOP_ENTRY_NAME = 'deepseek-harness.desktop'

/** Name of the desktop entry file for the development launcher. */
export const DEVELOPMENT_DESKTOP_ENTRY_NAME = 'deepseek-harness-dev.desktop'

/** Build-record schema stored beside each installed version. */
export const BUILD_RECORD_SCHEMA_VERSION = 1

/** Filesystem layout of the user-local daily installation. */
export interface LocalInstallLayout {
  /** Installation root that contains versions, the current link, and the previous link. */
  readonly root: string
  /** Directory holding immutable version directories and transient staging directories. */
  readonly versions: string
  /** Symbolic link to the version directory the desktop entry launches. */
  readonly current: string
  /** Symbolic link to the version that the rollback command restores. */
  readonly previous: string
  /** Directory for the update lock, backups, verification evidence, and the update journal. */
  readonly state: string
  /** Lock directory held for the duration of one update or rollback. */
  readonly lock: string
  /** Data backups written before each installation step that changes links. */
  readonly backups: string
  /** Screenshots and logs from launch verification. */
  readonly evidence: string
  /** Append-only JSON-lines journal of update stages. */
  readonly journal: string
  /** XDG applications directory that receives the desktop entries. */
  readonly applications: string
  /** Desktop entry that launches the daily build. */
  readonly dailyEntry: string
  /** Desktop entry that launches the development build from the repository. */
  readonly developmentEntry: string
}

/** Metadata written beside each installed version; the update compares it with the verified remote commit. */
export interface BuildRecord {
  readonly schemaVersion: typeof BUILD_RECORD_SCHEMA_VERSION
  /** Product version from the Desktop package manifest. */
  readonly version: string
  /** Full commit hash of the source tree the build was made from. */
  readonly commit: string
  /** Branch the commit was verified against on the remote. */
  readonly branch: string
  /** ISO time when the build completed. */
  readonly builtAt: string
  /** Electron-builder target directory the copy came from, for example `linux-x64`. */
  readonly target: string
}

/** Named user data directory that is copied into a backup before an installation step. */
export interface DataSource {
  readonly name: string
  readonly path: string
}

/** Symbolic link state of an installation. */
export interface LinkState {
  readonly current: string | undefined
  readonly previous: string | undefined
}

/**
 * Resolve the user-local installation layout from the home directory.
 * @param home - Home directory that owns the installation; defaults to the operating-system home.
 * @returns Absolute paths for every installation and state location.
 */
export function resolveLocalInstallLayout(home: string = homedir()): LocalInstallLayout {
  const root = join(home, '.local', 'opt', 'deepseek-harness')
  const state = join(home, '.local', 'state', 'deepseek-harness')
  const applications = join(home, '.local', 'share', 'applications')
  return {
    root,
    versions: join(root, 'versions'),
    current: join(root, 'current'),
    previous: join(root, 'previous'),
    state,
    lock: join(state, 'update.lock'),
    backups: join(state, 'backups'),
    evidence: join(state, 'verification'),
    journal: join(state, 'update.jsonl'),
    applications,
    dailyEntry: join(applications, DAILY_DESKTOP_ENTRY_NAME),
    developmentEntry: join(applications, DEVELOPMENT_DESKTOP_ENTRY_NAME),
  }
}

/**
 * Test whether a path exists without following a final symbolic link.
 * @param path - Path to inspect.
 * @returns True when the entry exists, including a dangling symbolic link.
 */
export async function entryExists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if (isErrorCode(error, 'ENOENT')) return false
    throw error
  }
}

/**
 * Return the target of a symbolic link, or undefined when the path is not a link.
 * @param path - Symbolic link path.
 * @returns The stored link target, or undefined when the entry is absent or not a link.
 */
export async function readLinkTarget(path: string): Promise<string | undefined> {
  try {
    return await readlink(path)
  } catch (error) {
    if (isErrorCode(error, 'ENOENT') || isErrorCode(error, 'EINVAL')) return undefined
    throw error
  }
}

/**
 * Read the current and previous link targets of an installation.
 * @param layout - Installation layout.
 * @returns The stored targets; undefined for an absent link.
 */
export async function readLinkState(layout: LocalInstallLayout): Promise<LinkState> {
  return {
    current: await readLinkTarget(layout.current),
    previous: await readLinkTarget(layout.previous),
  }
}

/**
 * Replace a symbolic link atomically by creating a sibling link and renaming it over the destination.
 * @param linkPath - Symbolic link to create or replace.
 * @param target - Absolute target path stored in the link.
 */
export async function replaceSymbolicLink(linkPath: string, target: string): Promise<void> {
  const temporary = `${linkPath}.tmp-${process.pid}`
  await rm(temporary, { force: true })
  await symlink(target, temporary)
  await rename(temporary, linkPath)
}

/**
 * Write both links of an installation, restoring the previous link when the current link cannot be written.
 * An undefined target removes that link.
 * @param layout - Installation layout.
 * @param next - Desired link targets.
 */
export async function writeLinkState(layout: LocalInstallLayout, next: LinkState): Promise<void> {
  const before = await readLinkState(layout)
  await applyLink(layout.previous, next.previous)
  try {
    await applyLink(layout.current, next.current)
  } catch (error) {
    await applyLink(layout.previous, before.previous)
    throw error
  }
}

async function applyLink(linkPath: string, target: string | undefined): Promise<void> {
  if (target === undefined) {
    await rm(linkPath, { force: true })
    return
  }
  await replaceSymbolicLink(linkPath, target)
}

/**
 * Check that an installed version directory has the expected executable, application archive, and build record.
 * @param versionDirectory - Version directory to inspect.
 * @param expectedCommit - Commit the build record must name, when the caller already knows it.
 * @returns The validated build record.
 * @throws when the executable, `resources/app/package.json`, or build record is missing or inconsistent.
 */
export async function assertVersionTree(versionDirectory: string, expectedCommit?: string): Promise<BuildRecord> {
  await access(join(versionDirectory, LINUX_EXECUTABLE_NAME))
  await access(join(versionDirectory, LINUX_APPLICATION_DIRECTORY, 'package.json'))
  const record = await readBuildRecord(versionDirectory)
  if (expectedCommit !== undefined && record.commit !== expectedCommit) {
    throw new Error(`desktop local install: ${versionDirectory} was built from ${record.commit}, expected ${expectedCommit}`)
  }
  return record
}

/**
 * Read the build record of a version directory.
 * @param versionDirectory - Version directory that contains `build-record.json`.
 * @returns The parsed record after schema validation.
 */
export async function readBuildRecord(versionDirectory: string): Promise<BuildRecord> {
  const parsed = JSON.parse(await readFile(join(versionDirectory, 'build-record.json'), 'utf8')) as Partial<BuildRecord>
  if (parsed.schemaVersion !== BUILD_RECORD_SCHEMA_VERSION || typeof parsed.commit !== 'string' || typeof parsed.version !== 'string'
    || typeof parsed.branch !== 'string' || typeof parsed.builtAt !== 'string' || typeof parsed.target !== 'string') {
    throw new Error(`desktop local install: invalid build record in ${versionDirectory}`)
  }
  return parsed as BuildRecord
}

/**
 * Derive the directory name of one installed build; it is unique for each build time.
 * @param record - Build record of the installed copy.
 * @returns Directory name made from the short commit and the build timestamp.
 */
export function versionDirectoryName(record: Pick<BuildRecord, 'commit' | 'builtAt'>): string {
  const stamp = record.builtAt.replace(/\D/gu, '').slice(0, 14)
  return `${record.commit.slice(0, 12)}-${stamp}`
}

/**
 * Copy a built unpacked application into a staging directory and write its build record there.
 * The staging directory is not a version until {@link promoteStagedVersion} renames it.
 * @param layout - Installation layout.
 * @param source - Unpacked application directory produced by electron-builder.
 * @param record - Build record to write beside the copied application.
 * @returns The staging directory and the version directory it will become.
 */
export async function stageVersion(
  layout: LocalInstallLayout,
  source: string,
  record: BuildRecord,
): Promise<{ staging: string; version: string }> {
  await mkdir(layout.versions, { recursive: true, mode: 0o755 })
  const name = versionDirectoryName(record)
  const staging = join(layout.versions, `.staging-${name}-${process.pid}`)
  const version = join(layout.versions, name)
  if (await entryExists(version)) throw new Error(`desktop local install: version ${name} already exists`)
  await rm(staging, { recursive: true, force: true })
  await runCommand('cp', ['-a', `${source}${sep}.`, staging])
  await writeFile(join(staging, 'build-record.json'), `${JSON.stringify(record, null, 2)}\n`)
  return { staging, version }
}

/**
 * Rename a verified staging directory to its version directory.
 * @param staging - Directory returned by {@link stageVersion}.
 * @param version - Version directory name returned by {@link stageVersion}.
 */
export async function promoteStagedVersion(staging: string, version: string): Promise<void> {
  await rename(staging, version)
}

/**
 * Remove a staging directory left by a failed update.
 * @param staging - Staging directory to remove.
 */
export async function discardStagedVersion(staging: string): Promise<void> {
  await rm(staging, { recursive: true, force: true })
}

/**
 * Point `current` at a new version and `previous` at the version it replaces.
 * A first installation sets `previous` to the legacy system install when that install exists.
 * @param layout - Installation layout.
 * @param version - Version directory that becomes current.
 * @param legacyInstall - Legacy installation that may serve as the first previous version.
 * @returns The link state before and after the switch.
 */
export async function switchCurrentVersion(
  layout: LocalInstallLayout,
  version: string,
  legacyInstall: string = LEGACY_SYSTEM_INSTALL,
): Promise<{ before: LinkState; after: LinkState }> {
  const before = await readLinkState(layout)
  let previous = before.current ?? before.previous
  if (before.current === undefined && before.previous === undefined && await entryExists(legacyInstall)) previous = legacyInstall
  const after: LinkState = { current: version, previous }
  await writeLinkState(layout, after)
  return { before, after }
}

/**
 * Swap `current` and `previous`, so the previously installed version becomes current.
 * @param layout - Installation layout.
 * @returns The link state before and after the rollback.
 * @throws when no previous version is recorded or the recorded target is missing.
 */
export async function rollbackCurrentVersion(layout: LocalInstallLayout): Promise<{ before: LinkState; after: LinkState }> {
  const before = await readLinkState(layout)
  if (before.previous === undefined) throw new Error('desktop local install: no previous version is recorded')
  await access(join(before.previous, LINUX_EXECUTABLE_NAME))
  const after: LinkState = { current: before.previous, previous: before.current }
  await writeLinkState(layout, after)
  return { before, after }
}

/** Fields of a desktop entry that launches an installed build. */
export interface DesktopEntryOptions {
  readonly name: string
  readonly comment: string
  readonly executable: string
  /** Arguments passed before the trailing field codes; each is quoted for the Exec line. */
  readonly execArguments: readonly string[]
  /** Desktop field codes such as `%U`, appended without quoting. Empty when none apply. */
  readonly trailing: string
  readonly icon: string
  readonly startupWMClass: string
}

/**
 * Render a freedesktop desktop entry with an Exec line whose arguments are quoted safely.
 * @param options - Entry fields, the executable, and its arguments.
 * @returns Desktop entry file contents.
 */
export function renderDesktopEntry(options: DesktopEntryOptions): string {
  const parts = [options.executable, ...options.execArguments].map(quoteExecArgument)
  if (options.trailing !== '') parts.push(options.trailing)
  const exec = parts.join(' ')
  return [
    '[Desktop Entry]',
    'Type=Application',
    `Name=${options.name}`,
    `Comment=${options.comment}`,
    `Exec=${exec}`,
    `TryExec=${options.executable}`,
    `Icon=${options.icon}`,
    'Terminal=false',
    'Categories=Development;',
    `StartupWMClass=${options.startupWMClass}`,
    'MimeType=x-scheme-handler/dsh;',
    '',
  ].join('\n')
}

/**
 * Quote one Exec argument according to the desktop entry specification.
 * @param value - Argument to quote.
 * @returns Argument wrapped in double quotes with reserved characters escaped.
 */
export function quoteExecArgument(value: string): string {
  return `"${value.replace(/(["`$\\])/gu, '\\$1')}"`
}

/**
 * Write a desktop entry atomically and refresh the desktop database when the tool is available.
 * @param path - Entry file path.
 * @param contents - Entry file contents.
 */
export async function writeDesktopEntry(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.tmp-${process.pid}`
  await writeFile(temporary, contents, { mode: 0o644 })
  await rename(temporary, path)
  await runCommand('update-desktop-database', [dirname(path)]).catch((error: unknown) => {
    // The database is an optimisation; menus read the entry file directly when it is absent.
    if (!isErrorCode(error, 'ENOENT')) throw error
  })
}

/**
 * Copy an existing file, or remove the destination when the source is absent, so it can be restored later.
 * @param path - Entry file to snapshot.
 * @param backup - Backup file path.
 * @returns True when the entry existed.
 */
export async function snapshotFile(path: string, backup: string): Promise<boolean> {
  if (!await entryExists(path)) return false
  await copyFile(path, backup)
  return true
}

/**
 * Remove version directories beyond the retention count when no process runs from them.
 * @param layout - Installation layout.
 * @param keep - Number of most recent versions to keep, in addition to the linked versions.
 * @param isInUse - Reports whether a directory contains a running executable.
 * @returns The version directories that were removed.
 */
export async function pruneVersions(
  layout: LocalInstallLayout,
  keep: number,
  isInUse: (directory: string) => Promise<boolean>,
): Promise<string[]> {
  const state = await readLinkState(layout)
  const linked = new Set([state.current, state.previous].filter((target): target is string => target !== undefined))
  const entries = (await readdir(layout.versions, { withFileTypes: true }).catch((error: unknown) => {
    if (isErrorCode(error, 'ENOENT')) return []
    throw error
  })).filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
  const records: { directory: string; builtAt: string }[] = []
  for (const entry of entries) {
    const directory = join(layout.versions, entry.name)
    records.push({ directory, builtAt: (await readBuildRecord(directory)).builtAt })
  }
  records.sort((left, right) => right.builtAt.localeCompare(left.builtAt))
  const removed: string[] = []
  for (const [index, record] of records.entries()) {
    if (index < keep || linked.has(record.directory)) continue
    if (await isInUse(record.directory)) continue
    await rm(record.directory, { recursive: true, force: true })
    removed.push(record.directory)
  }
  return removed
}

/**
 * Find processes whose executable lives under one of the given directories.
 * @param prefixes - Absolute directories to match.
 * @returns Process identifiers of matching processes.
 */
export async function processesRunningFrom(prefixes: readonly string[]): Promise<number[]> {
  const found: number[] = []
  for (const entry of await readdir('/proc', { withFileTypes: true })) {
    if (!/^\d+$/u.test(entry.name)) continue
    const executable = await readlink(join('/proc', entry.name, 'exe')).catch((error: unknown) => {
      // Processes exit between directory listing and link reads; vanished processes are not running.
      if (isErrorCode(error, 'ENOENT') || isErrorCode(error, 'EACCES') || isErrorCode(error, 'ESRCH')) return undefined
      throw error
    })
    if (executable !== undefined && prefixes.some(prefix => executable === prefix || executable.startsWith(`${prefix}${sep}`))) {
      found.push(Number(entry.name))
    }
  }
  return found
}

/** Exclusive update lock held while an installation step runs. */
export interface UpdateLock {
  /** Remove the lock directory after the owning operation finishes. */
  release(): Promise<void>
}

/**
 * Take the exclusive update lock. A lock whose owner process has exited is replaced.
 * @param path - Lock directory.
 * @returns The held lock.
 * @throws when another live process owns the lock or the owner cannot be read.
 */
export async function acquireUpdateLock(path: string): Promise<UpdateLock> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await mkdir(path, { mode: 0o700 })
    } catch (error) {
      if (!isErrorCode(error, 'EEXIST')) throw error
      const owner = await readLockOwner(path)
      if (owner === undefined) throw new Error(`desktop local update: lock ${path} has no readable owner; inspect it before retrying`)
      if (processIsAlive(owner)) throw new Error(`desktop local update: another update or rollback is running (pid ${owner})`)
      await rm(path, { recursive: true, force: true })
      continue
    }
    await writeFile(join(path, 'owner.json'), `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`)
    return { release: () => rm(path, { recursive: true, force: true }) }
  }
  throw new Error(`desktop local update: could not acquire lock ${path}`)
}

async function readLockOwner(path: string): Promise<number | undefined> {
  try {
    const parsed = JSON.parse(await readFile(join(path, 'owner.json'), 'utf8')) as { pid?: unknown }
    return typeof parsed.pid === 'number' ? parsed.pid : undefined
  } catch (error) {
    if (isErrorCode(error, 'ENOENT') || error instanceof SyntaxError) return undefined
    throw error
  }
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if (isErrorCode(error, 'EPERM')) return true
    if (isErrorCode(error, 'ESRCH')) return false
    throw error
  }
}

/**
 * Append one JSON line to the update journal.
 * @param layout - Installation layout.
 * @param entry - Stage record; it must not contain credentials or environment values.
 */
export async function appendJournal(layout: LocalInstallLayout, entry: Record<string, unknown>): Promise<void> {
  await mkdir(layout.state, { recursive: true, mode: 0o700 })
  await appendFile(layout.journal, `${JSON.stringify({ time: new Date().toISOString(), ...entry })}\n`, { mode: 0o600 })
}

/**
 * Copy user data directories into a timestamped backup before an installation step changes links.
 * Missing sources are skipped; the backup directory is created owner-only.
 * @param layout - Installation layout.
 * @param sources - Named data directories to copy.
 * @param stamp - Directory name for this backup.
 * @returns The backup directory and the names of copied sources.
 */
export async function backupUserData(
  layout: LocalInstallLayout,
  sources: readonly DataSource[],
  stamp: string,
): Promise<{ directory: string; copied: string[] }> {
  const directory = join(layout.backups, stamp)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const copied: string[] = []
  for (const source of sources) {
    if (!await entryExists(source.path)) continue
    await runCommand('cp', ['-a', source.path, join(directory, source.name)])
    copied.push(source.name)
  }
  return { directory, copied }
}

/**
 * Run an external command and reject when it exits unsuccessfully.
 * @param command - Executable name or path.
 * @param args - Arguments without shell interpretation.
 */
export function runCommand(command: string, args: readonly string[]): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
    child.once('error', reject)
    child.once('close', (code, signal) => {
      if (code === 0) resolvePromise()
      else reject(Object.assign(new Error(`${command} ${args[0] ?? ''} exited with ${String(code ?? signal)}${stderr === '' ? '' : `: ${stderr.trim()}`}`), { code: code === 127 ? 'ENOENT' : undefined }))
    })
  })
}

/**
 * Test whether an error is a Node.js system error with the given code.
 * @param error - Caught value.
 * @param code - Expected error code.
 * @returns True when the error carries the code.
 */
export function isErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === code
}

/**
 * Check an unpacked build before it is staged: executable, application archive, and runtime resource directory.
 * @param directory - Unpacked application directory produced by electron-builder.
 */
export async function assertUnpackedBuild(directory: string): Promise<void> {
  const executable = join(directory, LINUX_EXECUTABLE_NAME)
  await access(executable)
  await access(join(directory, LINUX_APPLICATION_DIRECTORY, 'package.json'))
  await access(join(directory, 'resources', 'runtime'))
  const stats = await lstat(executable)
  if ((stats.mode & 0o111) === 0) throw new Error(`desktop local install: ${LINUX_EXECUTABLE_NAME} is not executable`)
}
