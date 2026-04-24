import type { OverlayCommand } from '../types'
import { useModalStore } from '../../../stores/modal-store'

export const libraryCommand: OverlayCommand = {
  type: 'overlay',
  name: 'library',
  description: 'Open the Library browser',
  source: 'builtin',
  paletteGroup: 'Navigation',
  call: () => {
    useModalStore.getState().setLibraryOpen(true)
    return undefined
  },
}
