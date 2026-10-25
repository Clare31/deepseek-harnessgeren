// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import type { ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import { AppearanceSection, type AppearanceSectionProps } from '../src/client/AppearanceSection.tsx'
import type { AppearanceSettings } from '../src/appearance-settings.ts'

afterEach(cleanup)

function props(setArtwork: AppearanceSectionProps['setArtwork']): AppearanceSectionProps {
  const snapshot: ConfigFormSnapshot<AppearanceSettings> = { status: 'ready', value: { artwork: 'pixel' }, base: {}, user: {}, revision: 1, writable: true }
  return {
    ...({} as GlobalStandardProps), close: () => {},
    t: key => key,
    useAppearance: selector => selector(snapshot), setArtwork,
  }
}

it('offers all three artworks and writes the selected choice', async () => {
  const save = vi.fn(async () => true)
  const view = render(<AppearanceSection {...props(save)} />)
  expect(view.asFragment()).toMatchSnapshot()
  expect(screen.getByRole('button', { name: 'pixel' }).getAttribute('aria-pressed')).toBe('true')
  fireEvent.click(screen.getByRole('button', { name: 'blueprint' }))
  await waitFor(() => { expect(save).toHaveBeenCalledWith('blueprint') })
  await waitFor(() => { expect(screen.getByRole('button', { name: 'night' }).hasAttribute('disabled')).toBe(false) })
})

it.each(['refused', 'transport'] as const)('retains the accepted choice and permits retry after %s failure', async (failure) => {
  const save = vi.fn(async () => { if (failure === 'transport') throw new Error('offline'); return false })
  render(<AppearanceSection {...props(save)} />)
  fireEvent.click(screen.getByRole('button', { name: 'night' }))
  expect((await screen.findByRole('alert')).textContent).toContain('saveError')
  expect(screen.getByRole('button', { name: 'pixel' }).getAttribute('aria-pressed')).toBe('true')
  expect(screen.getByRole('button', { name: 'night' }).hasAttribute('disabled')).toBe(false)
})
