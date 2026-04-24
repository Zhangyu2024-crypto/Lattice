// Bridge tool: workspace spectrum file → focused Pro workbench artifact.
//
// The downstream analysis tools (`detect_peaks`, `xps_fit_peaks`,
// `raman_identify`, `xrd_refine`, ...) all go through `resolveWorkbench`
// and require a focused `xrd-pro` / `xps-pro` / `raman-pro` / `curve-pro`
// artifact in the session. Opening a spectrum file in the workspace
// editor only renders a preview chart — it does NOT create a workbench
// artifact. Without this tool the agent has no legal path from "user
// points at 1.vms in workspace" to "run peak detection on it", so all
// those analyses collapse into a text-only answer with no AgentCards.
//
// This tool reads the file via the workspace IPC, parses it with the
// shared `parseSpectrumText` / `parseSpectrumBinary` pipeline, then calls
// `createProWorkbench` (which also focuses the new artifact). After it
// returns, the agent can immediately call the analysis tools on the
// fresh workbench and each step renders a proper card.

import { useWorkspaceStore } from '@/stores/workspace-store'
import {
  canParseLocally,
  needsBinaryRead,
  parseSpectrumBinary,
  parseSpectrumText,
} from '@/lib/parsers/parse-spectrum-file'
import type { ParsedSpectrum, SpectroscopyTechnique } from '@/lib/parsers/types'
import { createProWorkbench } from '@/lib/pro-workbench'
import type { ProWorkbenchKind } from '@/lib/pro-workbench'
import type { ProWorkbenchSpectrum } from '@/types/artifact'
import type { LocalTool } from '@/types/agent-tool'

type TechniqueKey = 'xrd' | 'xps' | 'raman' | 'ftir' | 'curve'

interface Input {
  relPath: string
  technique?: TechniqueKey
}

interface Output {
  artifactId: string
  kind: ProWorkbenchKind
  technique: TechniqueKey
  title: string
  points: number
  summary: string
}

// Legacy kinds — these are what `resolveWorkbench` (workbench-shared.ts)
// still accepts. `spectrum-pro` is the forward-looking replacement but
// isn't yet recognised by the analysis tools' type guards; using the
// legacy kind keeps the "open → detect_peaks → fit" chain functional
// today. The `[pro-workbench] Legacy kind ... is deprecated` warning in
// the devtools console is expected and harmless.
const TECHNIQUE_TO_KIND: Record<TechniqueKey, ProWorkbenchKind> = {
  xrd: 'xrd-pro',
  xps: 'xps-pro',
  raman: 'raman-pro',
  ftir: 'raman-pro',
  curve: 'curve-pro',
}

function normaliseTechnique(
  explicit: TechniqueKey | undefined,
  parsed: SpectroscopyTechnique,
): TechniqueKey {
  if (explicit) return explicit
  switch (parsed) {
    case 'XRD':
      return 'xrd'
    case 'XPS':
      return 'xps'
    case 'Raman':
      return 'raman'
    case 'FTIR':
      return 'ftir'
    default:
      return 'curve'
  }
}

function basename(relPath: string): string {
  const segs = relPath.split(/[\\/]/)
  return segs[segs.length - 1] || relPath
}

async function readAndParse(relPath: string): Promise<ParsedSpectrum> {
  const store = useWorkspaceStore.getState()
  if (!store.rootPath) {
    throw new Error(
      'No workspace root configured. Set it in Settings → Workspace.',
    )
  }
  if (!canParseLocally(relPath)) {
    throw new Error(
      `File extension not supported for spectrum parsing: ${relPath}. Supported: .vms, .vamas, .xrdml, .chi, .csv, .xy, .dat, .jdx, .spc, .wdf, .rruf, ...`,
    )
  }

  let parsed: ParsedSpectrum | null = null
  if (needsBinaryRead(relPath)) {
    const ab = await store.readBinary(relPath)
    if (!ab) throw new Error(`Could not read binary file: ${relPath}`)
    parsed = await parseSpectrumBinary(ab, relPath)
  } else {
    const text = await store.readFile(relPath)
    if (text == null) throw new Error(`Could not read file: ${relPath}`)
    parsed = await parseSpectrumText(text, relPath)
  }

  if (!parsed) {
    throw new Error(
      `Parser returned no spectrum for ${relPath}. The file may be malformed or use an unsupported dialect — check the devtools console for parser diagnostics.`,
    )
  }
  if (parsed.x.length < 2 || parsed.y.length < 2) {
    throw new Error(
      `Parsed spectrum for ${relPath} has fewer than 2 points (${parsed.x.length}).`,
    )
  }
  return parsed
}

export const openSpectrumWorkbenchTool: LocalTool<Input, Output> = {
  name: 'open_spectrum_workbench',
  description:
    'Open a workspace spectrum file (.vms / .vamas / .xrdml / .chi / .csv / .xy / .dat / .jdx / .spc / .wdf / .rruf / ...) as a focused Pro workbench artifact. Call this BEFORE detect_peaks, xps_fit_peaks, raman_identify, xrd_refine, or any other workbench-scoped analysis tool when the user references a workspace file that does not yet have an associated workbench. The technique is auto-detected from the file extension + content; pass `technique` (xrd | xps | raman | ftir | curve) to override. Returns the new artifactId so subsequent analysis calls can reference it explicitly.',
  trustLevel: 'safe',
  cardMode: 'info',
  inputSchema: {
    type: 'object',
    properties: {
      relPath: {
        type: 'string',
        description:
          'Path inside the workspace root, e.g. "data/1.vms" or "patterns/sample.xrdml".',
      },
      technique: {
        type: 'string',
        description:
          'Force the Pro workbench technique. One of: xrd, xps, raman, ftir, curve. Omit for auto-detect.',
      },
    },
    required: ['relPath'],
  },
  async execute(input, ctx) {
    if (!input?.relPath) throw new Error('relPath is required')
    const parsed = await readAndParse(input.relPath)
    const technique = normaliseTechnique(input.technique, parsed.technique)
    const kind = TECHNIQUE_TO_KIND[technique]

    const spectrum: ProWorkbenchSpectrum = {
      x: parsed.x,
      y: parsed.y,
      xLabel: parsed.xLabel,
      yLabel: parsed.yLabel,
      spectrumType: parsed.technique,
      sourceFile: parsed.metadata.sourceFile ?? input.relPath,
    }
    const title = parsed.metadata.sampleName || basename(input.relPath)

    const artifactId = createProWorkbench({
      sessionId: ctx.sessionId,
      kind,
      title,
      spectrum,
      ramanMode: technique === 'ftir' ? 'ftir' : undefined,
    })

    return {
      artifactId,
      kind,
      technique,
      title,
      points: parsed.x.length,
      summary: `Opened ${basename(input.relPath)} as ${kind} · ${parsed.x.length} points · ${parsed.xLabel} → ${parsed.yLabel}`,
    }
  },
}
