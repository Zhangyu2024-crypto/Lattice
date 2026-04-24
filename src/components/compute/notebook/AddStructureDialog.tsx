// "Add Structure" modal — the notebook's "+ Structure" action opens
// this instead of inserting a cell. The dialog shepherds the user from
// a one-line description to a StructureArtifact via the shared
// `buildStructureDirect` helper, then closes itself and focuses the
// artifact so the structure-pro workbench can render it.
//
// Design canon:
//   • Grayscale only — no blue/purple accent colors on chrome
//   • Max border-radius 6px, flat surface, no gradients
//   • All fonts via --font-sans / --font-mono tokens
//   • Overlay dismiss + Esc close (useEscapeKey)

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'
import { AlertTriangle, Loader2, X } from 'lucide-react'
import { buildStructureDirect } from '../../../lib/agent-tools/build-structure'
import { toast } from '../../../stores/toast-store'
import {
  selectActiveSession,
  useRuntimeStore,
} from '../../../stores/runtime-store'
import { createOrchestratorCtx } from '../../../lib/agent/orchestrator-ctx'
import { localProCompute } from '../../../lib/local-pro-compute'
import { useEscapeKey } from '../../../hooks/useEscapeKey'

interface Props {
  open: boolean
  onClose: () => void
  /** Called after a successful build with the new artifact id. The
   *  notebook uses this to focus the artifact; callers may also close
   *  themselves off it, though the dialog closes internally. */
  onBuilt?: (artifactId: string) => void
}

/** Prefill presets — clicking fills the textarea with a starter
 *  phrase the user is expected to edit (fill in the formula). The
 *  verbatim strings were tuned to push the LLM toward canonical
 *  defaults and explicit phase/technique hints so ambiguity doesn't
 *  trigger a conversational response. */
const QUICK_PROMPTS: ReadonlyArray<{ label: string; prompt: string }> = [
  { label: 'Perovskite', prompt: 'Perovskite ABO3 tetragonal (e.g. BaTiO3)' },
  { label: 'Rock-salt', prompt: 'Rock-salt NaCl-type cubic (e.g. MgO)' },
  { label: 'Spinel', prompt: 'Spinel AB2O4 (e.g. Fe3O4 inverse spinel)' },
  { label: 'Wurtzite', prompt: 'Wurtzite hexagonal (e.g. ZnO)' },
  { label: 'Fluorite', prompt: 'Fluorite AB2 cubic (e.g. CaF2)' },
  { label: 'Diamond', prompt: 'Diamond cubic (e.g. Si)' },
  { label: 'BCC', prompt: 'BCC metal (e.g. Fe α-iron)' },
  { label: 'FCC', prompt: 'FCC metal (e.g. Cu)' },
  { label: 'HCP', prompt: 'HCP metal (e.g. Ti α)' },
]

interface DialogError {
  summary: string
  detail?: string
}

export default function AddStructureDialog({ open, onClose, onBuilt }: Props) {
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [lastError, setLastError] = useState<DialogError | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const isComposingRef = useRef(false)
  const focusArtifact = useRuntimeStore((s) => s.focusArtifact)

  useEscapeKey(onClose, open && !busy)

  // Autofocus on open. We also reset the draft + error so a reopen
  // starts clean — persisting the last prompt across opens is a minor
  // feature some users would like, but it makes "+ Structure" feel laggy.
  useEffect(() => {
    if (!open) return
    setDescription('')
    setLastError(null)
    const t = window.setTimeout(() => textareaRef.current?.focus(), 0)
    return () => window.clearTimeout(t)
  }, [open])

  const handleBuild = useCallback(async () => {
    const desc = description.trim()
    if (!desc) {
      toast.warn('Describe the material you want to build.')
      textareaRef.current?.focus()
      return
    }
    const session = selectActiveSession(useRuntimeStore.getState())
    if (!session) {
      setLastError({
        summary:
          'No active session. Open a conversation from the file tree first.',
      })
      return
    }
    setBusy(true)
    setLastError(null)
    const controller = new AbortController()
    try {
      // Pre-flight the container — pymatgen can't run if it's stopped
      // and we'd rather short-circuit here than burn an LLM roundtrip
      // to discover that.
      const health = await localProCompute.computeHealth()
      if (!health.container_up) {
        setLastError({
          summary:
            'Compute container is not running. Start it from the notebook toolbar before building a structure.',
          detail: health.error ?? undefined,
        })
        return
      }

      const result = await buildStructureDirect(
        { description: desc },
        {
          sessionId: session.id,
          signal: controller.signal,
          orchestrator: createOrchestratorCtx(),
        },
      )
      if (!result.success) {
        setLastError({
          summary: result.error,
          detail: [result.stderr, result.generatedCode]
            .filter((s): s is string => !!s && s.trim().length > 0)
            .join('\n\n---\n\n'),
        })
        return
      }
      toast.success(
        `Built ${result.formula} · key \`${result.loadKey}\` — use load_structure('${result.loadKey}')`,
      )
      focusArtifact(session.id, result.artifactId)
      onBuilt?.(result.artifactId)
      onClose()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const stack = err instanceof Error ? err.stack : undefined
      // Always mirror to console so DevTools has the full stack with
      // source maps — the modal panel shows a cleaner 1-line summary.
      console.error('[AddStructureDialog] build failed', err)
      setLastError({ summary: `Build failed: ${msg}`, detail: stack })
    } finally {
      setBusy(false)
    }
  }, [description, focusArtifact, onBuilt, onClose])

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const composing =
      e.nativeEvent.isComposing ||
      e.keyCode === 229 ||
      isComposingRef.current
    if (composing && e.key === 'Enter') {
      e.preventDefault()
      return
    }
    // Cmd/Ctrl+Enter or plain Enter submits; Shift+Enter inserts newline
    // so multi-line descriptions (rare but possible) stay typable.
    if (e.key === 'Enter' && !e.shiftKey && !busy) {
      e.preventDefault()
      void handleBuild()
    }
  }

  if (!open) return null
  return (
    <div
      className="add-structure-overlay"
      onMouseDown={(e) => {
        // Only close when the user clicks the dim background, not when
        // a drag starts inside the dialog and releases on the overlay.
        if (e.target === e.currentTarget && !busy) onClose()
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-structure-title"
    >
      <div className="add-structure-dialog">
        <div className="add-structure-header">
          <div className="add-structure-title" id="add-structure-title">
            Build a crystal structure
          </div>
          <button
            type="button"
            className="add-structure-close"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            title="Close (Esc)"
          >
            <X size={14} strokeWidth={1.8} />
          </button>
        </div>

        <div className="add-structure-body">
          <label
            className="add-structure-label"
            htmlFor="add-structure-desc"
          >
            Describe the material
          </label>
          <textarea
            ref={textareaRef}
            id="add-structure-desc"
            className="add-structure-textarea"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onKeyDown={handleKeyDown}
            onCompositionStart={() => {
              isComposingRef.current = true
            }}
            onCompositionEnd={() => {
              isComposingRef.current = false
            }}
            placeholder={'e.g. "Perovskite BaTiO3 tetragonal", "2x2x2 NaCl supercell", "Diamond cubic Si"'}
            rows={3}
            disabled={busy}
            spellCheck={false}
          />

          <div
            className="add-structure-quick-label"
            aria-label="Quick prompt templates"
          >
            Quick prompts
          </div>
          <div className="add-structure-quick-chips">
            {QUICK_PROMPTS.map((q) => (
              <button
                key={q.label}
                type="button"
                className="add-structure-chip"
                onClick={() => {
                  setDescription(q.prompt)
                  textareaRef.current?.focus()
                  textareaRef.current?.select()
                }}
                disabled={busy}
                title={q.prompt}
              >
                {q.label}
              </button>
            ))}
          </div>

          <div className="add-structure-hint">
            The agent writes a pymatgen script, runs it in the compute
            container, and registers the resulting CIF as a structure
            artifact. To consume it from a LAMMPS / CP2K / Python cell,
            call <code>load_structure('&lt;key&gt;')</code> — the
            success toast shows the key, or click{' '}
            <strong>Simulate&nbsp;▾</strong> on the new structure card
            to spawn a pre-wired MD / DFT cell automatically.
          </div>

          {lastError && (
            <div className="add-structure-error" role="alert">
              <div className="add-structure-error-head">
                <AlertTriangle
                  size={12}
                  strokeWidth={1.8}
                  aria-hidden
                />
                <span className="add-structure-error-summary">
                  {lastError.summary}
                </span>
                <button
                  type="button"
                  className="add-structure-error-dismiss"
                  onClick={() => setLastError(null)}
                  aria-label="Dismiss error"
                  title="Dismiss"
                >
                  <X size={10} strokeWidth={1.8} aria-hidden />
                </button>
              </div>
              {lastError.detail ? (
                <pre className="add-structure-error-detail">
                  {lastError.detail}
                </pre>
              ) : null}
            </div>
          )}
        </div>

        <div className="add-structure-actions">
          <button
            type="button"
            className="add-structure-btn is-ghost"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            className="add-structure-btn is-primary"
            onClick={() => void handleBuild()}
            disabled={busy || description.trim().length === 0}
          >
            {busy ? (
              <>
                <Loader2
                  size={12}
                  strokeWidth={1.8}
                  className="add-structure-spin"
                />
                Building…
              </>
            ) : (
              'Build'
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
