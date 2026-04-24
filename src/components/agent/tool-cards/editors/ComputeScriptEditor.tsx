// Phase ζ.2 — inline approval editor for the `compute_create_script` tool.
//
// When the orchestrator pauses after `compute_create_script`, this
// component renders the generated Python alongside the approval bar so
// the user can tweak the script before `compute_run` picks it up. The
// edited text is published through `onChange` in the same shape the
// orchestrator expects for an edited tool result:
//   { artifactId, code: editedCode, summary }
//
// Pattern mirrors the CodeEditor in `ComputeArtifactCard` — CM6 with
// python() + oneDark, instantiated once, updated via an updateListener
// so we don't ping-pong setState while the user is typing.

import { useEffect, useMemo, useRef, useState } from 'react'
import { EditorView, keymap, lineNumbers } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { python } from '@codemirror/lang-python'
import { oneDark } from '@codemirror/theme-one-dark'
import { defaultKeymap, indentWithTab } from '@codemirror/commands'
import type { TaskStep } from '../../../../types/session'
import { isComputeArtifact } from '../../../../types/artifact'
import {
  selectActiveSession,
  useRuntimeStore,
} from '../../../../stores/runtime-store'

interface ComputeCreateScriptOutput {
  artifactId: string
  summary?: string
}

function parseOutput(output: unknown): ComputeCreateScriptOutput | null {
  if (!output || typeof output !== 'object') return null
  const candidate = output as Partial<ComputeCreateScriptOutput>
  if (typeof candidate.artifactId !== 'string') return null
  return {
    artifactId: candidate.artifactId,
    summary: candidate.summary,
  }
}

interface Props {
  step: TaskStep
  onChange: (edited: unknown) => void
}

export default function ComputeScriptEditor({ step, onChange }: Props) {
  const parsed = useMemo(() => parseOutput(step.output), [step.output])
  const session = useRuntimeStore(selectActiveSession)
  const artifact = parsed
    ? session?.artifacts[parsed.artifactId]
    : undefined
  const initialCode = useMemo(() => {
    if (artifact && isComputeArtifact(artifact)) return artifact.payload.code
    return ''
  }, [artifact])

  // Local mirror of the buffer. Seeded from the freshly-created artifact
  // and only reset when the tool output identity changes (e.g. the LLM
  // re-ran the tool). Mid-edit re-renders of the parent must not clobber
  // user keystrokes.
  const [code, setCode] = useState<string>(initialCode)
  const seededForOutputRef = useRef<unknown>(null)
  useEffect(() => {
    if (seededForOutputRef.current === step.output) return
    seededForOutputRef.current = step.output
    setCode(initialCode)
  }, [step.output, initialCode])

  // Keep the latest onChange in a ref so the CM6 updateListener closure —
  // which is installed once at mount — always publishes through the
  // current callback.
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  const hostRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)

  // Publish the seeded buffer up on mount so AgentCard's editedOutput
  // reflects the script even if the user approves without typing. Without
  // this the orchestrator would fall through to the untouched tool output
  // — same content, but the intent of "edited" is clearer when we always
  // carry the { artifactId, code } envelope through.
  useEffect(() => {
    if (!parsed) return
    onChangeRef.current({
      artifactId: parsed.artifactId,
      code,
      summary: parsed.summary,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const state = EditorState.create({
      doc: initialCode,
      extensions: [
        lineNumbers(),
        keymap.of([...defaultKeymap, indentWithTab]),
        python(),
        oneDark,
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return
          const next = update.state.doc.toString()
          setCode(next)
          if (!parsed) return
          onChangeRef.current({
            artifactId: parsed.artifactId,
            code: next,
            summary: parsed.summary,
          })
        }),
        EditorView.theme({
          '&': { maxHeight: '180px', fontSize: 'var(--text-sm)' },
          '.cm-scroller': {
            fontFamily: 'var(--font-mono)',
            maxHeight: '180px',
            overflow: 'auto',
          },
          '.cm-content': { paddingTop: '4px', paddingBottom: '4px' },
        }),
      ],
    })
    const view = new EditorView({ state, parent: host })
    viewRef.current = view
    return () => {
      view.destroy()
      viewRef.current = null
    }
    // Intentionally single-shot: we seed from `initialCode` once and let
    // the user own the buffer from there. Re-seeding on artifact updates
    // would clobber in-flight edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!parsed) {
    return (
      <div className="tool-approval-editor-empty">
        Output not in the expected shape; approve to use as-is or reject.
      </div>
    )
  }

  if (!artifact || !isComputeArtifact(artifact)) {
    return (
      <div className="tool-approval-editor-empty">
        Compute artifact unavailable — approve to send the script as generated.
      </div>
    )
  }

  const lineCount = code.split('\n').length
  return (
    <div className="tool-approval-editor tool-approval-editor-compute">
      <div className="tool-approval-editor-meta">
        <span className="tool-approval-editor-title">{artifact.title}</span>
        <span className="tool-approval-editor-meta-spacer" />
        <span className="tool-approval-editor-meta-stat">{lineCount} lines</span>
      </div>
      <div ref={hostRef} className="tool-approval-editor-code-host" />
    </div>
  )
}
