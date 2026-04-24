// Phase 3a · workspace_grep preview card.
//
// Groups raw match rows by file; each block is collapsible so a 200-match
// result doesn't drown the chat thread. Clicking on an individual match
// fires a composer mention-add for the file, letting the user carry the
// hit straight back into their next turn.
//
// The card was split into ./workspace-grep/* helpers after it crossed
// 500 lines — this file keeps the resolver, the registry-facing export,
// and the top-level Body layout so the preview-registry wiring stays at
// the same import path.

import { useMemo } from 'react'
import type { ToolPreviewResolver } from '../preview-registry'
import { groupByFile } from './workspace-grep/helpers'
import { FileBlock } from './workspace-grep/MatchRow'
import { QueryHeader } from './workspace-grep/QueryHeader'
import { Footer, Malformed } from './workspace-grep/states'
import {
  narrowInput,
  narrowOutput,
  type GrepInput,
  type GrepOutput,
} from './workspace-grep/types'

// Self-contained body component — allows hooks inside (useMemo grouping)
// without the resolver running them at the wrong level.
function GrepBody({
  input,
  output,
  openAll,
  maxHeight,
  capFiles,
}: {
  input: GrepInput | null
  output: GrepOutput
  openAll: boolean
  maxHeight: number | null
  capFiles: number | null
}) {
  const grouped = useMemo(() => groupByFile(output.matches), [output.matches])
  const fileCount = grouped.length
  const capped = capFiles != null ? grouped.slice(0, capFiles) : grouped

  const body = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {capped.map(([relPath, matches]) => (
        <FileBlock
          key={relPath}
          relPath={relPath}
          matches={matches}
          input={input}
          initiallyOpen={openAll}
        />
      ))}
      {capFiles != null && grouped.length > capFiles ? (
        <span
          style={{
            fontSize: 'var(--text-xs)',
            color: 'var(--color-text-muted)',
            fontStyle: 'italic',
            padding: '2px 6px',
          }}
        >
          +{grouped.length - capFiles} more file
          {grouped.length - capFiles === 1 ? '' : 's'}
        </span>
      ) : null}
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {input ? <QueryHeader input={input} /> : null}
      {output.matches.length === 0 ? (
        <span
          style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}
        >
          No matches
        </span>
      ) : maxHeight != null ? (
        <div style={{ maxHeight, overflow: 'auto' }}>{body}</div>
      ) : (
        body
      )}
      <Footer
        matches={output.matches.length}
        fileCount={fileCount}
        truncated={output.truncated}
      />
    </div>
  )
}

// ─── Resolver ─────────────────────────────────────────────────────────

export const WorkspaceGrepPreview: ToolPreviewResolver = (step) => {
  const input = narrowInput(step.input)
  const output = narrowOutput(step.output)

  if (!output) {
    return {
      oneLiner: input ? `grep · ${input.pattern}` : 'workspace_grep',
      compact: <Malformed />,
    }
  }

  // Count files without running a hook at the resolver level.
  const seen = new Set<string>()
  for (const m of output.matches) seen.add(m.file)
  const fileCount = seen.size

  const oneLiner = `${output.matches.length} match${
    output.matches.length === 1 ? '' : 'es'
  } · ${fileCount} file${fileCount === 1 ? '' : 's'}${
    output.truncated ? ' · truncated' : ''
  }`

  return {
    oneLiner,
    compact: (
      <GrepBody
        input={input}
        output={output}
        openAll={false}
        maxHeight={null}
        capFiles={3}
      />
    ),
    expanded: (
      <GrepBody
        input={input}
        output={output}
        openAll
        maxHeight={480}
        capFiles={null}
      />
    ),
  }
}
