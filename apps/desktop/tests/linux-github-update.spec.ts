import { describe, expect, it } from 'vitest'
import { createElectronBuilderConfig } from '../scripts/electron-builder-config.mjs'

const environment = { DSH_DESKTOP_APP_ID: 'com.deepseek.harness', DSH_DESKTOP_UNSIGNED: '1' }

describe('Linux GitHub package configuration', () => {
  it('matches the Wayland app ID and X11 window class to the installed launcher', () => {
    const config = createElectronBuilderConfig(environment, 'linux', 'x64')
    expect(config.extraMetadata).toHaveProperty('desktopName', 'deepseek-harness.desktop')
    expect(config.linux).toHaveProperty('syncDesktopName', true)
    expect(config.linux).toHaveProperty('desktop.entry.StartupWMClass', 'deepseek-harness')
  })
  it('embeds the stable channel and public repository for the existing update coordinator', () => {
    const config = createElectronBuilderConfig({ ...environment,
      DSH_DESKTOP_GITHUB_UPDATE_REPOSITORY: 'Clare31/deepseek-harnessgeren',
    }, 'linux', 'x64')
    expect(config.publish).toEqual([{
      provider: 'github', owner: 'Clare31', repo: 'deepseek-harnessgeren', channel: 'latest', releaseType: 'release',
    }])
    expect(config.extraMetadata.dshDesktopUpdateChannel).toBe('latest')
    expect(config.extraMetadata).not.toHaveProperty('dshMandatoryUpdatePolicy')
    expect(config.linux.target).toContain('deb')
    expect(config.asar).toBe(false)
  })

  it('keeps the ordinary unsigned package without an update source', () => {
    const config = createElectronBuilderConfig(environment, 'linux', 'x64')
    expect(config.publish).toBeNull()
    expect(config.extraMetadata.dshDesktopUpdateChannel).toBe('nightly')
  })
})
