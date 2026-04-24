// Tier 2 · component tests for AddStructureDialog. The dialog is a small
// orchestrator — gate container health, dispatch the build tool, surface
// errors inline, and on success focus the new artifact. These tests mock
// the two module-level dependencies (`buildStructureDirect` and
// `localProCompute.computeHealth`) so we can walk every branch without
// an LLM or a real compute container.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AddStructureDialog from './AddStructureDialog'

// Mocks — these files do not tree-shake in vitest, so we hoist the
// mock declarations above the component import via vi.mock factories.
vi.mock('../../../lib/agent-tools/build-structure', () => ({
  buildStructureDirect: vi.fn(),
}))
vi.mock('../../../lib/local-pro-compute', () => ({
  localProCompute: {
    computeHealth: vi.fn(),
  },
}))
vi.mock('../../../lib/agent/orchestrator-ctx', () => ({
  createOrchestratorCtx: () => ({ workspaceRoot: null, fs: null }),
}))
vi.mock('../../../stores/toast-store', () => ({
  toast: {
    success: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}))
vi.mock('../../../stores/runtime-store', async () => {
  // Minimal shape the dialog reads: selectActiveSession + focusArtifact.
  const activeSession = { id: 'ses_test', title: 'Test Session' }
  const focusArtifact = vi.fn()
  return {
    selectActiveSession: () => activeSession,
    useRuntimeStore: Object.assign(
      (selector: (s: unknown) => unknown) =>
        selector({ focusArtifact, sessions: { ses_test: activeSession } }),
      {
        getState: () => ({
          focusArtifact,
          sessions: { ses_test: activeSession },
        }),
      },
    ),
  }
})

// Pull the mocked references after vi.mock fires.
import { buildStructureDirect } from '../../../lib/agent-tools/build-structure'
import { localProCompute } from '../../../lib/local-pro-compute'
import { toast } from '../../../stores/toast-store'
import { useRuntimeStore } from '../../../stores/runtime-store'

const mockBuild = buildStructureDirect as unknown as ReturnType<typeof vi.fn>
const mockHealth = localProCompute.computeHealth as unknown as ReturnType<typeof vi.fn>

function healthyContainer() {
  mockHealth.mockResolvedValue({
    container_up: true,
    python_version: '3.12.0',
    error: null,
  })
}

describe('AddStructureDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders nothing when closed', () => {
    render(<AddStructureDialog open={false} onClose={() => {}} />)
    expect(screen.queryByText('Build a crystal structure')).toBeNull()
  })

  it('renders the dialog with textarea + 9 quick-prompt chips when open', () => {
    render(<AddStructureDialog open={true} onClose={() => {}} />)
    expect(screen.getByText('Build a crystal structure')).toBeInTheDocument()
    expect(screen.getByRole('textbox')).toBeInTheDocument()
    // The 9 chips:
    for (const label of [
      'Perovskite',
      'Rock-salt',
      'Spinel',
      'Wurtzite',
      'Fluorite',
      'Diamond',
      'BCC',
      'FCC',
      'HCP',
    ]) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
  })

  it('prefills the textarea when a quick-prompt chip is clicked', async () => {
    const user = userEvent.setup()
    render(<AddStructureDialog open={true} onClose={() => {}} />)
    await user.click(screen.getByRole('button', { name: 'Perovskite' }))
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    expect(textarea.value).toContain('Perovskite')
    expect(textarea.value).toContain('BaTiO3') // sample in parentheses
  })

  it('refuses to build when description is empty and keeps modal open', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<AddStructureDialog open={true} onClose={onClose} />)
    // Build button is disabled until there's text — assert + click no-ops.
    const build = screen.getByRole('button', { name: /build/i })
    expect(build).toBeDisabled()
    await user.click(build)
    expect(mockBuild).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('surfaces a container-down error inline (no LLM call burned)', async () => {
    mockHealth.mockResolvedValue({
      container_up: false,
      error: 'Docker daemon not reachable',
    })
    const user = userEvent.setup()
    render(<AddStructureDialog open={true} onClose={() => {}} />)
    await user.type(screen.getByRole('textbox'), 'Perovskite BaTiO3')
    await user.click(screen.getByRole('button', { name: /build/i }))
    await waitFor(() => {
      expect(
        screen.getByRole('alert'),
      ).toHaveTextContent(/Compute container is not running/i)
    })
    // LLM path was short-circuited.
    expect(mockBuild).not.toHaveBeenCalled()
  })

  it('calls buildStructureDirect, toasts success, and closes on a happy path', async () => {
    healthyContainer()
    mockBuild.mockResolvedValue({
      success: true,
      artifactId: 'art_foo',
      formula: 'BaTiO3',
      spaceGroup: 'P 1',
      cellVolume: 64.4,
      summary: 'Built BaTiO3 · P 1',
    })
    const onClose = vi.fn()
    const onBuilt = vi.fn()
    const user = userEvent.setup()
    render(
      <AddStructureDialog open={true} onClose={onClose} onBuilt={onBuilt} />,
    )
    await user.type(screen.getByRole('textbox'), 'Perovskite BaTiO3')
    await user.click(screen.getByRole('button', { name: /build/i }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(mockBuild).toHaveBeenCalledTimes(1)
    expect(mockBuild.mock.calls[0][0]).toEqual({
      description: 'Perovskite BaTiO3',
    })
    expect(onBuilt).toHaveBeenCalledWith('art_foo')
    expect(toast.success).toHaveBeenCalled()
    expect(useRuntimeStore.getState().focusArtifact).toHaveBeenCalledWith(
      'ses_test',
      'art_foo',
    )
  })

  it('keeps the modal open and shows an error panel on build failure', async () => {
    healthyContainer()
    mockBuild.mockResolvedValue({
      success: false,
      error: 'pymatgen execution failed: NameError',
      stderr: 'Traceback (most recent call last):\n  NameError: foo',
    })
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(<AddStructureDialog open={true} onClose={onClose} />)
    await user.type(screen.getByRole('textbox'), 'Wrong thing')
    await user.click(screen.getByRole('button', { name: /build/i }))
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/pymatgen/i)
    })
    // The detail <pre> should include the stderr trace.
    expect(screen.getByRole('alert')).toHaveTextContent(/NameError/)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('Enter submits the build without a modifier key', async () => {
    healthyContainer()
    mockBuild.mockResolvedValue({
      success: true,
      artifactId: 'art_enter',
      formula: 'Fe',
      spaceGroup: 'P 1',
      cellVolume: 23.5,
      summary: 'Built Fe',
    })
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<AddStructureDialog open={true} onClose={onClose} />)
    const ta = screen.getByRole('textbox')
    await user.type(ta, 'BCC Fe')
    fireEvent.keyDown(ta, { key: 'Enter' })
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(mockBuild).toHaveBeenCalledTimes(1)
  })
})
