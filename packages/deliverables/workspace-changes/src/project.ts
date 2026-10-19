/** Read-only repository overview and HEAD-to-worktree comparisons, including untracked files. */
import { relative, resolve } from 'node:path'
import { parsePatch } from 'diff'
import type { GitRunner, GitRunResult } from './git.ts'
import { parseNumstat } from './numstat.ts'
import type { WorkspaceChangedFile, WorkspaceFileDiff, WorkspaceProject } from './types.ts'

function checked(result: GitRunResult, exits: readonly number[] = [0]): string {
  if (result.truncated) throw new Error('Repository output exceeds outputMaxBytes')
  if (result.exitCode === null || !exits.includes(result.exitCode)) throw new Error(`Repository read failed: ${result.stderr}`)
  if (result.exitCode !== 0 && result.stdout === '' && result.stderr !== '') throw new Error(`Repository read failed: ${result.stderr}`)
  return result.stdout
}

/**
 * Read the current repository without writing its index, object store, or refs.
 * @param git - resolved runner, or null when Git is unavailable.
 * @param cwd - Session working directory; all returned paths are relative to it.
 * @param maxFiles - maximum returned files; totals cover the complete listing.
 * @param signal - caller cancellation.
 * @returns HEAD and worktree differences, or an explicit unavailable state.
 */
export async function readProject(git: GitRunner | null, cwd: string, maxFiles: number, signal: AbortSignal): Promise<WorkspaceProject> {
  signal.throwIfAborted()
  if (git === null) return { kind: 'unavailable', reason: 'git-missing' }
  let directory = cwd
  const run = (args: string[]) => git.run(['-c', 'diff.relative=false', ...args], { cwd: directory, signal, env: { GIT_LITERAL_PATHSPECS: '1' } })
  const located = await run(['rev-parse', '--show-toplevel'])
  if (located.exitCode === 128 && /not a git repository/i.test(located.stderr)) return { kind: 'unavailable', reason: 'not-repository' }
  const root = checked(located).trimEnd()
  directory = root
  const head = await run(['rev-parse', '--verify', '--quiet', 'HEAD'])
  const base = head.exitCode === 1
    ? checked(await git.run(['hash-object', '-t', 'tree', '--stdin'], { cwd, signal, stdin: '' })).trim()
    : checked(head).trim()
  const branch = await run(['symbolic-ref', '--quiet', '--short', 'HEAD'])
  const branchName = branch.exitCode === 1 ? base.slice(0, 8) : checked(branch).trimEnd()
  const records = parseNumstat(checked(await run(['diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--numstat', '-z', base, '--'])))
  const untracked = checked(await run(['ls-files', '--others', '--exclude-standard', '-z']))
  for (const path of untracked.split('\0').filter(Boolean)) {
    const output = checked(await git.run(['diff', '--no-index', '--no-ext-diff', '--no-textconv', '--numstat', '-z', '--', '/dev/null', path],
      { cwd: root, signal }), [0, 1])
    const entry = parseNumstat(output)[0]
    // Empty untracked files have no diff hunk but are still changes.
    records.push({ path, added: entry?.added ?? 0, deleted: entry?.deleted ?? 0, binary: entry?.binary ?? false })
  }
  const files: WorkspaceChangedFile[] = records.map((entry) => {
    const path = relative(cwd, resolve(root, entry.path)).replaceAll('\\', '/')
    return { path, display: path, added: entry.added, deleted: entry.deleted, ...entry.binary ? { binary: true as const } : {} }
  }).sort((a, b) => a.path.localeCompare(b.path))
  return {
    kind: 'repository', root, branch: branchName, base: head.exitCode === 1 ? null : base,
    total: files.length, files: files.slice(0, maxFiles),
    added: files.reduce((sum, file) => sum + file.added, 0), deleted: files.reduce((sum, file) => sum + file.deleted, 0),
  }
}

/**
 * Read one currently listed path's patch. Paths are re-admitted from Git's listing on every request.
 * @param git - resolved Git runner, or null when unavailable.
 * @param cwd - Session working directory, never a client-supplied directory.
 * @param path - exact path from the bounded overview listing.
 * @param maxFiles - overview listing bound.
 * @param maxBytes - maximum retained patch size.
 * @param signal - caller cancellation.
 * @returns a text, binary, or oversized comparison, or absence for an unlisted path.
 */
export async function readProjectDiff(
  git: GitRunner | null, cwd: string, path: string, maxFiles: number, maxBytes: number, signal: AbortSignal,
): Promise<WorkspaceFileDiff | undefined> {
  const project = await readProject(git, cwd, maxFiles, signal)
  if (git === null || project.kind !== 'repository') return undefined
  const file = project.files.find(file => file.path === path)
  if (file === undefined) return undefined
  const common = { path, display: file.display }
  if (file.binary === true) return { ...common, kind: 'binary' }
  const repositoryPath = relative(project.root, resolve(cwd, path)).replaceAll('\\', '/')
  const options = { cwd: project.root, signal, maxBytes, env: { GIT_LITERAL_PATHSPECS: '1' } }
  const before = project.base !== null && checked(await git.run(['ls-tree', '-z', project.base, '--', repositoryPath], options)) !== ''
  const args = before && project.base !== null
    ? ['diff', '--no-ext-diff', '--no-textconv', '--no-renames', project.base, '--', repositoryPath]
    : ['diff', '--no-index', '--no-ext-diff', '--no-textconv', '--', '/dev/null', repositoryPath]
  const result = await git.run(args, options)
  if (result.truncated) return { ...common, kind: 'oversized' }
  const patch = checked(result, [0, 1])
  if (/^Binary files .* differ$/mu.test(patch)) return { ...common, kind: 'binary' }
  const parsed = parsePatch(patch)
  return {
    ...common, kind: 'text', before, after: parsed[0]?.newFileName !== '/dev/null', coarse: false,
    hunks: parsed.flatMap(file => file.hunks).map(hunk => ({
      oldStart: hunk.oldStart, oldLines: hunk.oldLines, newStart: hunk.newStart, newLines: hunk.newLines,
      lines: hunk.lines.filter(line => /^[+ -]/u.test(line)),
    })),
  }
}
