import type { LocalTool } from '../../types/agent-tool'
import type { ComputeLanguage } from '../../types/pro-api'
import { getComputeSnippets } from '../compute-snippets-catalog'
import { sendLlmChat } from '../llm-chat'
import {
  createComputeArtifact,
} from './compute-helpers'

interface Input {
  snippetId: string
  customizations?: string
}

interface Output {
  artifactId: string
  summary: string
}

const CODE_FENCE_RE = /```(?:python|lammps|cp2k|py)?\s*\n([\s\S]*?)\n```/i

/** Compress a free-form customization instruction into a short artifact
 *  title suffix. Keeps the user's intent visible even when the LLM
 *  rewrite path fails silently — without this, a customized BaTiO3
 *  template stays labeled "CP2K CELL_OPT (template)" instead of showing
 *  the requested material. */
function summarizeCustomization(raw: string): string {
  const oneLine = raw.replace(/\s+/g, ' ').trim()
  if (!oneLine) return ''
  const MAX = 48
  return oneLine.length <= MAX ? oneLine : `${oneLine.slice(0, MAX - 1)}…`
}

export const computeFromSnippetTool: LocalTool<Input, Output> = {
  name: 'compute_from_snippet',
  description:
    'Create a compute artifact from a built-in snippet template. Covers XRD simulation, supercell, slab, doping, vacancy, ASE optimization, phonon dispersion, bond analysis, LAMMPS MD (NVE/NPT/minimize/dump), CP2K DFT (cell_opt/md/band/single_point/Si bulk modulus), and more. Call list_compute_snippets to browse available IDs.',
  trustLevel: 'localWrite',
  cardMode: 'edit',
  inputSchema: {
    type: 'object',
    properties: {
      snippetId: {
        type: 'string',
        description:
          'Snippet ID. Common: space_group, supercell, xrd_simulate, slab, bond_analysis, dope, ase_optimize, vacancy, phonon_dispersion, lammps_nve, lammps_npt, lammps_minimize, cp2k_cell_opt, cp2k_md, cp2k_band, cp2k_single_point, cp2k_si_bulk_modulus.',
      },
      customizations: {
        type: 'string',
        description:
          'Optional NL instruction to customize the snippet before creating (e.g. "use 3x3x3 supercell", "set temperature to 500K").',
      },
    },
    required: ['snippetId'],
  },

  async execute(input, ctx) {
    const id = input?.snippetId?.trim()
    if (!id) throw new Error('snippetId is required')

    const all = getComputeSnippets()
    const snippet = all.find((s) => s.id === id)
    if (!snippet) {
      const ids = all.map((s) => s.id).join(', ')
      throw new Error(`Unknown snippet "${id}". Available: ${ids}`)
    }

    let code = snippet.code ?? ''
    const language = (snippet.language ?? 'python') as ComputeLanguage

    const customization = input?.customizations?.trim() ?? ''
    if (customization) {
      const prompt =
        `Modify the following ${language} script according to the instruction. ` +
        `Return ONLY the modified script in a code fence.\n\n` +
        `### Instruction\n${customization}\n\n` +
        `### Script\n\`\`\`${language}\n${code}\n\`\`\``
      const llm = await sendLlmChat({
        mode: 'agent',
        userMessage: prompt,
        transcript: [],
        sessionId: ctx.sessionId,
      })
      if (llm.success) {
        const m = CODE_FENCE_RE.exec(llm.content)
        if (m) code = m[1]
      }
    }

    // When a customization was requested, surface it in the artifact
    // title so the user doesn't mistake the starting-point snippet
    // material (e.g. BaTiO3) for the material actually being computed.
    const baseTitle = snippet.title ?? snippet.id ?? 'Compute'
    const suffix = customization ? ` — ${summarizeCustomization(customization)}` : ''
    const artifact = createComputeArtifact(ctx.sessionId, {
      title: `${baseTitle}${suffix}`,
      code,
      language,
    })

    return {
      artifactId: artifact.id,
      summary: `Created "${snippet.title}" (${language}, idle). Run it with compute_run.`,
    }
  },
}
