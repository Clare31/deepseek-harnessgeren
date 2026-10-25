// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { apply, inject } from '../src/client/index.ts'
import { OfficialBrandMark, OfficialBrandName, OfficialSidebarMark } from '../src/client/Brand.tsx'
import { SettingsLauncher } from '../src/client/SettingsLauncher.tsx'

beforeEach(() => {
  const TestURL = class extends URL {}
  Object.defineProperties(TestURL, {
    createObjectURL: { value: vi.fn(() => 'blob:rabb-test') },
    revokeObjectURL: { value: vi.fn() },
  })
  vi.stubGlobal('URL', TestURL)
})

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

const HOLES = [
  'sidebar.brand.mark',
  'sidebar.brand.name',
  'sidebar.brand.backdrop',
  'conversation.hero.brand.mark',
  'settings.launcher',
  'settings.section',
] as const

const HERO_HOLE = 'conversation.hero.brand.mark'

async function bench(declare = true) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.provide('locale', new LocaleRuntime(ctx))
  let snapshot = { status: 'ready', value: { artwork: 'pixel' }, writable: true }
  const listeners = new Set<() => void>()
  const appearance = {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    set: vi.fn(async () => true),
  }
  ctx.provide('configForms', { get: () => appearance } as never)
  ctx.provide('remote', {} as never)
  const removeTokens = vi.fn()
  const overrideTokens = vi.fn(() => removeTokens)
  ctx.provide('theme', { overrideTokens } as never)
  const slots = ctx.get('slots') as SlotRegistry
  const declareHoles = () => slots.register({
    name: 'root',
    children: Object.fromEntries(HOLES.map(name => [name, { kind: name === 'settings.section' ? 'list' : 'single', scope: 'root' }])),
  } as never, () => null)
  const disposeHoles = declare ? declareHoles() : undefined
  return { ctx, slots, declareHoles, disposeHoles, overrideTokens, removeTokens, listeners, changeArtwork(artwork: string) {
    snapshot = { ...snapshot, value: { artwork } }
    for (const listener of listeners) listener()
  } }
}

describe('official browser-brand plugin', () => {
  it('synchronizes accepted artwork across header and composer and releases subscriptions on disposal', async () => {
    vi.stubEnv('DSH_CLIENT_BUILD_PROFILE', 'official')
    const subject = await bench()
    const fiber = subject.ctx.plugin({ inject: [...inject], apply })
    try {
      await fiber.await()
      subject.changeArtwork('night')
      expect(subject.overrideTokens).toHaveBeenLastCalledWith('rabb.appearance', expect.objectContaining({
        '--rabb-header-image': { light: 'var(--rabb-artwork-night)', dark: 'var(--rabb-artwork-night)' },
        '--dsw-specific-composer-send-image': { light: 'var(--rabb-send-night, var(--rabb-artwork-night))', dark: 'var(--rabb-send-night, var(--rabb-artwork-night))' },
      }))
      expect(subject.removeTokens).toHaveBeenCalledOnce()
    } finally { await fiber.dispose() }
    expect(subject.listeners.size).toBe(0)
    expect(subject.removeTokens).toHaveBeenCalledTimes(2)
    subject.changeArtwork('blueprint')
    expect(subject.overrideTokens).toHaveBeenCalledTimes(2)
  })
  it('declares the slot and locale services it uses', () => {
    expect(inject).toEqual(['slots', 'locale', 'configForms', 'remote', 'theme'])
  })

  it('leaves every slot empty outside the official build profile', async () => {
    vi.stubEnv('DSH_CLIENT_BUILD_PROFILE', 'local')
    const subject = await bench()
    await subject.ctx.plugin({ inject: [...inject], apply }).await()
    for (const hole of HOLES) expect(subject.slots.entries(hole)).toHaveLength(0)
  })

  it('fills declarations before or after apply and removes every occupant on teardown', async () => {
    vi.stubEnv('DSH_CLIENT_BUILD_PROFILE', 'official')
    const before = await bench()
    const fiber = before.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    for (const hole of HOLES) expect(before.slots.entries(hole)).toHaveLength(1)

    before.disposeHoles?.()
    for (const hole of HOLES) expect(before.slots.entries(hole)).toHaveLength(0)
    before.declareHoles()
    await Promise.resolve()
    for (const hole of HOLES) expect(before.slots.entries(hole)).toHaveLength(1)

    await fiber.dispose()
    for (const hole of HOLES) expect(before.slots.entries(hole)).toHaveLength(0)

    const after = await bench(false)
    await after.ctx.plugin({ inject: [...inject], apply }).await()
    for (const hole of HOLES) expect(after.slots.entries(hole)).toHaveLength(0)
    after.declareHoles()
    await Promise.resolve()
    for (const hole of HOLES) expect(after.slots.entries(hole)).toHaveLength(1)
  })

  it('fills the conversation hero in official builds', async () => {
    vi.stubEnv('DSH_CLIENT_BUILD_PROFILE', 'official')
    const subject = await bench()
    await subject.ctx.plugin({ inject: [...inject], apply }).await()
    expect(subject.slots.entries(HERO_HOLE)).toHaveLength(1)
  })

  it('replaces the account menu with the settings-only launcher in official builds', async () => {
    vi.stubEnv('DSH_CLIENT_BUILD_PROFILE', 'official')
    const subject = await bench()
    subject.slots.register({ name: 'settings.launcher' }, () => null)
    await subject.ctx.plugin({ inject: [...inject], apply }).await()
    expect(subject.slots.entries('settings.launcher')[0]?.component).toBe(SettingsLauncher)
  })

  it('opens settings directly with an accessible icon-only rail button', () => {
    const openSettings = vi.fn()
    const props = {
      ...({} as GlobalStandardProps), settingsOpen: false, openSettings, openOnboarding: () => {},
      settingsShortcut: { keys: ['Ctrl', ','], aria: 'Control+,' },
      t: () => '设置',
    }
    const view = render(<SettingsLauncher {...props} wide />)
    const button = screen.getByRole('button', { name: '设置' })
    expect(button.getAttribute('aria-haspopup')).toBe('dialog')
    expect(button.getAttribute('aria-keyshortcuts')).toBe('Control+,')
    fireEvent.click(button)
    expect(openSettings).toHaveBeenCalledOnce()
    expect(screen.queryByRole('menu')).toBeNull()
    expect(screen.queryByText('意见反馈')).toBeNull()
    expect(screen.queryByText('登录')).toBeNull()
    view.rerender(<SettingsLauncher {...props} wide={false} />)
    expect(screen.getByRole('button', { name: '设置' }).textContent).toBe('')
  })

  it('renders the official name independently from both requested mark sizes', () => {
    const name = render(<OfficialBrandName />)
    expect(name.container.firstElementChild?.className).toContain('name')
    name.unmount()

    const mark = render(<OfficialBrandMark size={34} />)
    expect(mark.container.querySelector('span')?.style.width).toBe('34px')
    mark.rerender(<OfficialBrandMark size={24} />)
    expect(mark.container.querySelector('span')?.style.width).toBe('24px')
  })

  it('uses the Rabb wordmark for the sidebar independently of the rabbit hero', () => {
    const sidebar = render(<OfficialSidebarMark size={24} />)
    expect(sidebar.container.querySelector('span')?.style.width).toBe('36px')
    expect(sidebar.container.querySelector('span')?.className).toContain('sidebarMark')
    sidebar.unmount()
    const hero = render(<OfficialBrandMark size={34} />)
    expect(hero.container.querySelector('svg')).toBeNull()
    expect(hero.container.querySelector('span')?.style.height).toBe('34px')
  })
})
