// Port of lattice-cli's `format_convert` tool
// (lattice-cli/src/lattice_cli/tools/convert_file.py).
//
// Reads a workspace spectrum file through the shared parser pipeline
// (same 15+ reader registry the in-app editor uses), re-serialises it
// into one of the portable interchange formats (XY / CSV / JCAMP-DX),
// and returns a `WorkspaceWriteProposal` so the write rides the existing
// `workspace_write_file` approval card — the user sees a diff preview of
// the new file before anything lands on disk.

import { useWorkspaceStore } from '@/stores/workspace-store'
import {
  canParseLocally,
  needsBinaryRead,
  parseSpectrumBinary,
  parseSpectrumText,
} from '@/lib/parsers/parse-spectrum-file'
import type { ParsedSpectrum } from '@/lib/parsers/types'
import {
  SPECTRUM_EXPORT_FORMATS,
  deriveOutputPath,
  emitSpectrum,
  type SpectrumExportFormat,
} from '@/lib/spectrum-export'
import type { WorkspaceWriteProposal } from './workspace-files'
import type { LocalTool } from '@/types/agent-tool'

interface Input {
  relPath: string
  outputFormat: SpectrumExportFormat
  outputRelPath?: string
}

// Electron preload exposes the workspace FS under names that aren't in
// the global `electronAPI` type. We keep the cast local to this tool
// (mirrors the pattern in workspace-files.ts) so the typing doesn't leak.
interface RootFsStatOk {
  ok: true
  stat: { exists: boolean; isDirectory: boolean; size: number; mtime: number; relPath: string }
}
interface RootFsErr {
  ok: false
  error: string
}
interface RootFsApi {
  workspaceStat: (rel: string) => Promise<RootFsStatOk | RootFsErr>
  workspaceRead: (rel: string) => Promise<{ ok: true; content: string } | RootFsErr>
}

function rootApi(): RootFsApi {
  const api = (window as unknown as { electronAPI?: unknown }).electronAPI
  if (!api) {
    throw new Error(
      'format_convert requires the Electron shell; run `npm run electron:dev`.',
    )
  }
  return api as unknown as RootFsApi
}

async function readExistingText(relPath: string): Promise<string | null> {
  const api = rootApi()
  const stat = await api.workspaceStat(relPath)
  if (!stat.ok || !stat.stat.exists || stat.stat.isDirectory) return null
  const res = await api.workspaceRead(relPath)
  if (!res.ok) return null
  return res.content
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
      `Source extension is not supported for spectrum parsing: ${relPath}.`,
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
      `Parser returned no spectrum for ${relPath}. Check the devtools console for parser diagnostics.`,
    )
  }
  if (parsed.x.length < 2) {
    throw new Error(
      `Parsed spectrum for ${relPath} has fewer than 2 points (${parsed.x.length}).`,
    )
  }
  return parsed
}

function utf8ByteLength(s: string): number {
  return new Blob([s]).size
}

function basename(relPath: string): string {
  const segs = relPath.split(/[\\/]/)
  return segs[segs.length - 1] || relPath
}

export const formatConvertTool: LocalTool<Input, WorkspaceWriteProposal> = {
  name: 'format_convert',
  description:
    'Convert a workspace spectrum file to a portable interchange format (xy / csv / jcamp). Reads any format the in-app parsers support (.vms / .vamas / .xrdml / .chi / .csv / .xy / .dat / .jdx / .spc / .wdf / .rruf / ...) and re-serialises to the chosen target. Returns a write proposal — the user reviews the new file contents in the AgentCard before it lands on disk. `outputRelPath` is optional; if omitted, the source extension is replaced automatically (e.g. `sample.vms` → `sample.csv`).',
  trustLevel: 'localWrite',
  cardMode: 'edit',
  inputSchema: {
    type: 'object',
    properties: {
      relPath: {
        type: 'string',
        description: 'Source file path relative to the workspace root.',
      },
      outputFormat: {
        type: 'string',
        description: `Target format. One of: ${SPECTRUM_EXPORT_FORMATS.join(', ')}.`,
      },
      outputRelPath: {
        type: 'string',
        description:
          'Optional destination path inside the workspace. Defaults to the source path with the extension replaced.',
      },
    },
    required: ['relPath', 'outputFormat'],
  },
  async execute(input) {
    if (!input?.relPath) throw new Error('relPath is required')
    if (!input?.outputFormat) throw new Error('outputFormat is required')
    if (!SPECTRUM_EXPORT_FORMATS.includes(input.outputFormat)) {
      throw new Error(
        `outputFormat must be one of: ${SPECTRUM_EXPORT_FORMATS.join(', ')}. Got: ${String(input.outputFormat)}`,
      )
    }

    const parsed = await readAndParse(input.relPath)
    const outRel =
      input.outputRelPath && input.outputRelPath.trim().length > 0
        ? input.outputRelPath.trim()
        : deriveOutputPath(input.relPath, input.outputFormat)

    if (outRel === input.relPath) {
      throw new Error(
        `outputRelPath would overwrite the source (${outRel}). Choose a different destination.`,
      )
    }

    const proposedContent = emitSpectrum(parsed, input.outputFormat, {
      title: basename(input.relPath).replace(/\.[^.]+$/, ''),
    })
    const existingContent = await readExistingText(outRel)

    return {
      relPath: outRel,
      proposedContent,
      sizeBytes: utf8ByteLength(proposedContent),
      existingContent,
    }
  },
}
