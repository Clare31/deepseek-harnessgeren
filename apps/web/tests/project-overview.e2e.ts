/** A recorded search Session renders project changes and source intake through the shipped Web composition. */
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import {
  captureStableAria, compareOrRefreshGolden, launchWebScaffold, seedSession, selectedSessionFixture, watchConsole, webSnapshotMode,
} from './scaffold.ts'
import { newEnglishPage, REPO_ROOT } from './support.ts'

const FIXTURE = fileURLToPath(new URL('../../../snapshots/web/web-search-round/session.v4.jsonl', import.meta.url))
const DIR = fileURLToPath(new URL('../../../snapshots/web/project-overview', import.meta.url))

it.skipIf(webSnapshotMode() === 'record')('reviews current Git changes and manages draft sources without sending messages', async () => {
  const scaffold = await launchWebScaffold({})
  try {
    const git = (...args: string[]): string => execFileSync('git', [
      '-c', 'user.name=Project test', '-c', 'user.email=project@example.invalid', '-c', 'commit.gpgsign=false', ...args,
    ], { cwd: scaffold.workspaceCwd, encoding: 'utf8' })
    git('init', '-q', '-b', 'main')
    await writeFile(join(scaffold.workspaceCwd, '.gitignore'), '.dsh-storages/\n')
    await writeFile(join(scaffold.workspaceCwd, 'tracked.txt'), 'before\n')
    git('add', '-A')
    git('commit', '-qm', 'seed')
    await writeFile(join(scaffold.workspaceCwd, 'tracked.txt'), 'after\n')
    await writeFile(join(scaffold.workspaceCwd, 'new.txt'), 'new\n')
    const fixture = await readFile(await selectedSessionFixture(FIXTURE), 'utf8')
    const id = await seedSession(scaffold, fixture, 'project-overview-web')
    const messagesBefore = (await scaffold.ctx.sessionQuery.readSession(id)).events
      .filter(event => event.type === 'user/message' || event.type === 'turn/start')
    const browser = await chromium.launch()
    try {
      const page = await newEnglishPage(browser)
      const tripwire = watchConsole(page)
      await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
      await page.locator('[role="treeitem"]').first().click()
      await page.locator('[role="treeitem"]').nth(1).click()
      const menuButton = page.getByRole('button', { name: 'Project and sources', exact: true })
      await menuButton.waitFor()
      await menuButton.click()
      const menu = page.locator('[data-project-overview]')
      await menu.getByRole('menuitem', { name: 'Changes +2 −1', exact: true }).waitFor()
      await compareOrRefreshGolden(join(DIR, 'menu.expected.md'),
        await captureStableAria(page, '[data-project-overview]', scaffold.workspaceCwd), webSnapshotMode())
      for (const width of [390, 1680]) {
        await page.setViewportSize({ width, height: 1000 })
        await expect.poll(async () => {
          const rect = await menu.boundingBox()
          return rect !== null && rect.x >= 0 && rect.x + rect.width <= width
        }).toBe(true)
      }
      await mkdir(join(REPO_ROOT, '.playwright-mcp'), { recursive: true })
      await menu.screenshot({ path: join(REPO_ROOT, '.playwright-mcp/project-menu.png') })
      await page.keyboard.press('Escape')
      await expect.poll(() => menu.count()).toBe(0)
      await menuButton.click()
      await page.locator('[data-composer-input]').first().click()
      await expect.poll(() => menu.count()).toBe(0)
      await menuButton.click()
      await menu.getByRole('menuitem', { name: 'View all' }).click()
      const panel = page.locator('[data-project-panel]')
      await panel.waitFor()
      await expect.poll(() => panel.textContent()).toContain('Search result')
      await panel.getByRole('button', { name: 'View changes to tracked.txt', exact: true }).click()
      await expect.poll(() => panel.textContent()).toContain('before')
      await expect.poll(() => panel.textContent()).toContain('after')
      await panel.getByRole('button', { name: 'Back to project', exact: true }).click()
      await panel.getByRole('button', { name: 'Add source', exact: true }).click()
      await page.getByLabel('File path or web link', { exact: true }).fill('new.txt')
      await page.getByRole('button', { name: 'Add to composer', exact: true }).click()
      await expect.poll(() => panel.textContent()).toContain('new.txt')
      await panel.getByRole('button', { name: 'Remove new.txt from composer', exact: true }).click()
      await expect.poll(() => panel.textContent()).toContain('No unsent sources in the composer')
      await compareOrRefreshGolden(join(DIR, 'panel.expected.md'),
        await captureStableAria(page, '[data-project-panel]', scaffold.workspaceCwd), webSnapshotMode())
      await page.screenshot({ path: join(REPO_ROOT, '.playwright-mcp/project-overview.png') })
      await page.emulateMedia({ colorScheme: 'dark' })
      await expect.poll(() => page.locator('body').getAttribute('data-ds-dark-theme')).not.toBeNull()
      await page.screenshot({ path: join(REPO_ROOT, '.playwright-mcp/project-overview-dark.png') })
      expect((await scaffold.ctx.sessionQuery.readSession(id)).events
        .filter(event => event.type === 'user/message' || event.type === 'turn/start')).toEqual(messagesBefore)
      expect(tripwire.pageErrors).toEqual([])
      expect(tripwire.warnings).toEqual([])
    } finally {
      await browser.close()
    }
  } finally {
    await scaffold.close()
  }
})
