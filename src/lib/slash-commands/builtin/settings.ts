import type { OverlayCommand } from '../types'
import { useModalStore } from '../../../stores/modal-store'
import type { SettingsTabId } from '../../../components/layout/settings-modal/tabs'

const VALID_TABS: readonly SettingsTabId[] = [
  'general',
  'models',
  'compute',
  'sync',
  'extensions',
]

function coerceTab(args: string): SettingsTabId | undefined {
  const trimmed = args.trim().toLowerCase()
  if (!trimmed) return undefined
  return VALID_TABS.find((t) => t === trimmed)
}

export const settingsCommand: OverlayCommand = {
  type: 'overlay',
  name: 'settings',
  description: 'Open the Settings overlay',
  argumentHint: '[general|models|compute|sync|extensions]',
  source: 'builtin',
  paletteGroup: 'Navigation',
  call: (args) => {
    useModalStore.getState().setSettingsOpen(true, coerceTab(args))
    return undefined
  },
}
