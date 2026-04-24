import type { Command, OpenProWorkbench } from '../types'

export interface ProDeps {
  onClose: () => void
  onOpenProWorkbench: OpenProWorkbench
}

/**
 * Pro workbench launchers. "Spectrum: Open Lab" is the generic entry that
 * prompts the user for a technique; the technique-specific entries below
 * it skip the initial picker and seed the workbench's technique cursor
 * directly. All three are backed by the same `spectrum-pro` artifact
 * kind.
 */
export function buildProCommands({
  onClose,
  onOpenProWorkbench,
}: ProDeps): Command[] {
  return [
    {
      id: 'pro-spectrum',
      label: 'Spectrum: Open Lab',
      action: () => {
        onOpenProWorkbench('spectrum-pro')
        onClose()
      },
    },
    // Technique-specific Pro entries — skip the initial picker and land
    // on the right technique immediately. Backed by the same
    // `spectrum-pro` artifact kind; the `technique` arg seeds the
    // workbench's technique cursor.
    {
      id: 'pro-xrd',
      label: 'Pro: XRD Lab',
      action: () => {
        onOpenProWorkbench('spectrum-pro', 'xrd')
        onClose()
      },
    },
    {
      id: 'pro-xps',
      label: 'Pro: XPS Lab',
      action: () => {
        onOpenProWorkbench('spectrum-pro', 'xps')
        onClose()
      },
    },
  ]
}

export interface WindowDeps {
  onClose: () => void
  onOpenLibrary: () => void
  onOpenKnowledge: () => void
}

/**
 * "Open in separate window" entries for the Library and Knowledge tabs.
 * These sit between the cross-workbench bridges and the agent prompts so
 * users scanning the palette find all module entry points together.
 */
export function buildWindowCommands({
  onClose,
  onOpenLibrary,
  onOpenKnowledge,
}: WindowDeps): Command[] {
  return [
    {
      id: 'open-library',
      label: 'Library: Open in separate window',
      action: () => {
        onOpenLibrary()
        onClose()
      },
    },
    {
      id: 'open-knowledge',
      label: 'Knowledge: Open in separate window',
      action: () => {
        onOpenKnowledge()
        onClose()
      },
    },
  ]
}
