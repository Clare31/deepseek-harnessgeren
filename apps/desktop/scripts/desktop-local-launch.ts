/**
 * Launch verification for an unpacked Linux build with isolated Harness and Electron data.
 *
 * The check starts the real executable, waits for a renderer page through the DevTools endpoint,
 * captures the rendered page, and stops only the process it started. It never reads or writes the
 * daily data directories.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { join } from 'node:path'

/** Options for one isolated launch. */
export interface IsolatedLaunchOptions {
  /** Unpacked executable to start. */
  readonly executable: string
  /** Directory that receives the isolated Harness home, Electron profile, log, and screenshot. */
  readonly dataRoot: string
  /** Directory that receives the screenshot and the process log. */
  readonly evidenceDirectory: string
  /** Milliseconds to wait for a renderer page after the process starts. */
  readonly startupTimeoutMs?: number
  /** Milliseconds to wait after the renderer page appears, so the first Host state can render. */
  readonly settleMs?: number
}

/** Evidence produced by a successful isolated launch. */
export interface IsolatedLaunchEvidence {
  readonly executable: string
  readonly pageUrl: string
  readonly pageTitle: string
  readonly screenshot: string
  readonly log: string
  readonly screenshotBytes: number
  readonly elapsedMs: number
}

interface DevToolsTarget {
  readonly type: string
  readonly url: string
  readonly title: string
  readonly webSocketDebuggerUrl?: string
}

/** Environment names removed from the launch so that development and workspace settings do not leak into a daily build. */
const CHILD_ENVIRONMENT_PREFIX_EXCLUSIONS = [/^DSH_/u, /^ELECTRON_/u, /^npm_/u, /^NODE_OPTIONS$/u, /^INIT_CWD$/u, /^PNPM_/u]

/**
 * Build the child environment for an isolated launch.
 * @param base - Environment of the updater process.
 * @param dshHome - Isolated Harness home that replaces the ordinary one.
 * @returns Environment without development or workspace variables, plus the isolated Harness home.
 */
export function isolatedLaunchEnvironment(base: NodeJS.ProcessEnv, dshHome: string): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {}
  for (const [name, value] of Object.entries(base)) {
    if (value === undefined) continue
    if (CHILD_ENVIRONMENT_PREFIX_EXCLUSIONS.some(pattern => pattern.test(name))) continue
    environment[name] = value
  }
  environment.DSH_HOME = dshHome
  return environment
}

/**
 * Reserve an unused loopback TCP port for the DevTools endpoint.
 * @returns A free port number.
 */
export function reserveLoopbackPort(): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address === null || typeof address === 'string') {
        server.close(() => reject(new Error('desktop local launch: no loopback port address')))
        return
      }
      const port = address.port
      server.close(() => resolvePromise(port))
    })
  })
}

/**
 * Start the executable with isolated data, wait for its first renderer page, capture it, and stop it.
 * @param options - Executable, isolated data root, and evidence directory.
 * @returns Paths and facts that show the application rendered a page.
 * @throws when the process exits early, no renderer page appears in time, or the capture fails.
 */
export async function verifyIsolatedLaunch(options: IsolatedLaunchOptions): Promise<IsolatedLaunchEvidence> {
  const started = Date.now()
  const startupTimeoutMs = options.startupTimeoutMs ?? 120_000
  const settleMs = options.settleMs ?? 15_000
  const dshHome = join(options.dataRoot, 'home')
  const userData = join(options.dataRoot, 'electron-user-data')
  await mkdir(dshHome, { recursive: true, mode: 0o700 })
  await mkdir(userData, { recursive: true, mode: 0o700 })
  await mkdir(options.evidenceDirectory, { recursive: true, mode: 0o700 })
  const log = join(options.evidenceDirectory, 'launch.log')
  const port = await reserveLoopbackPort()
  const output = createWriteStream(log, { mode: 0o600 })
  const child = spawn(options.executable, [
    `--remote-debugging-port=${String(port)}`,
    `--user-data-dir=${userData}`,
  ], {
    cwd: options.dataRoot,
    env: isolatedLaunchEnvironment(process.env, dshHome),
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout?.pipe(output, { end: false })
  child.stderr?.pipe(output, { end: false })
  let exited: { code: number | null; signal: NodeJS.Signals | null } | undefined
  let spawnFailure: Error | undefined
  child.once('exit', (code, signal) => { exited = { code, signal } })
  child.once('error', (error) => { spawnFailure = error })
  const stopped = (): unknown => exited ?? spawnFailure
  try {
    const target = await waitForPage(port, startupTimeoutMs, stopped)
    await delay(settleMs)
    if (spawnFailure !== undefined) throw spawnFailure
    if (exited !== undefined) throw new Error(`desktop local launch: process exited during settle with ${String(exited.code ?? exited.signal)}`)
    const screenshot = join(options.evidenceDirectory, 'launch.png')
    const bytes = await captureScreenshot(target.webSocketDebuggerUrl ?? '', screenshot)
    return {
      executable: options.executable,
      pageUrl: target.url,
      pageTitle: target.title,
      screenshot,
      log,
      screenshotBytes: bytes,
      elapsedMs: Date.now() - started,
    }
  } finally {
    await stopProcessGroup(child)
    output.end()
    await writeFile(join(options.evidenceDirectory, 'result.json'), `${JSON.stringify({ port, stoppedAt: new Date().toISOString() })}\n`)
  }
}

type PageTarget = DevToolsTarget & { webSocketDebuggerUrl: string }

async function waitForPage(port: number, timeoutMs: number, exited: () => unknown): Promise<PageTarget> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (exited() !== undefined) throw new Error('desktop local launch: process exited before a renderer page appeared')
    const page = await findPage(port)
    if (page !== undefined) return page
    await delay(500)
  }
  throw new Error(`desktop local launch: no renderer page within ${String(timeoutMs)} ms`)
}

async function findPage(port: number): Promise<(DevToolsTarget & { webSocketDebuggerUrl: string }) | undefined> {
  let targets: DevToolsTarget[]
  try {
    const response = await fetch(`http://127.0.0.1:${String(port)}/json/list`)
    targets = (await response.json()) as DevToolsTarget[]
  } catch {
    // The endpoint is not listening until Electron finishes starting; the caller retries.
    return undefined
  }
  const candidates = targets.filter((target): target is DevToolsTarget & { webSocketDebuggerUrl: string } => target.type === 'page'
    && target.webSocketDebuggerUrl !== undefined
    && target.url !== 'about:blank'
    && !target.url.startsWith('devtools://'))
  // A hidden window never produces a frame, so Page.captureScreenshot would wait forever on it.
  for (const candidate of candidates) {
    if (await isVisiblePage(candidate.webSocketDebuggerUrl)) return candidate
  }
  return undefined
}

async function isVisiblePage(webSocketUrl: string): Promise<boolean> {
  return new Promise<boolean>((resolvePromise) => {
    const socket = new WebSocket(webSocketUrl)
    const finish = (visible: boolean): void => {
      clearTimeout(timer)
      socket.close()
      resolvePromise(visible)
    }
    const timer = setTimeout(() => { finish(false) }, 3_000)
    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: 'document.visibilityState', returnByValue: true } }))
    })
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as { id?: number; result?: { result?: { value?: unknown } } }
      if (message.id === 1) finish(message.result?.result?.value === 'visible')
    })
    socket.addEventListener('error', () => { finish(false) })
  })
}

async function captureScreenshot(webSocketUrl: string, path: string): Promise<number> {
  if (webSocketUrl === '') throw new Error('desktop local launch: renderer page has no DevTools socket')
  const data = await new Promise<string>((resolvePromise, reject) => {
    const socket = new WebSocket(webSocketUrl)
    const timer = setTimeout(() => {
      socket.close()
      reject(new Error('desktop local launch: screenshot timed out'))
    }, 30_000)
    socket.addEventListener('open', () => {
      // Wayland may report a visible document before its window produces a capturable frame.
      socket.send(JSON.stringify({ id: 2, method: 'Page.bringToFront' }))
      socket.send(JSON.stringify({ id: 1, method: 'Page.captureScreenshot', params: { format: 'png' } }))
    })
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as { id?: number; result?: { data: string }; error?: { message: string } }
      if (message.id !== 1) return
      clearTimeout(timer)
      socket.close()
      if (message.error !== undefined) reject(new Error(`desktop local launch: ${message.error.message}`))
      else if (message.result === undefined) reject(new Error('desktop local launch: screenshot response has no data'))
      else resolvePromise(message.result.data)
    })
    socket.addEventListener('error', () => {
      clearTimeout(timer)
      reject(new Error('desktop local launch: DevTools socket failed'))
    })
  })
  const bytes = Buffer.from(data, 'base64')
  await writeFile(path, bytes, { mode: 0o600 })
  return bytes.length
}

async function stopProcessGroup(child: ChildProcess): Promise<void> {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return
  const group = -child.pid
  signalGroup(group, 'SIGTERM')
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline && (child.exitCode === null && child.signalCode === null)) await delay(200)
  if (child.exitCode === null && child.signalCode === null) signalGroup(group, 'SIGKILL')
}

function signalGroup(group: number, signal: NodeJS.Signals): void {
  try {
    process.kill(group, signal)
  } catch (error) {
    // The group already exited between the check and the signal.
    if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) throw error
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise(resolvePromise => setTimeout(resolvePromise, milliseconds))
}
