import type { LocalTool } from '../../types/agent-tool'
import type {
  Artifact,
  StructureArtifact,
  StructureArtifactPayload,
  StructureTransform,
  StructureTransformKind,
} from '../../types/artifact'
import {
  computeFormula,
  computeLatticeParams,
  parseCif,
  supercell,
  writeCif,
  type CifSite,
  type ParsedCif,
} from '../cif'
import { genArtifactId, useRuntimeStore } from '../../stores/runtime-store'

type Operation = 'supercell' | 'replace_element'

interface Input {
  artifactId?: string
  operation: Operation
  params: Record<string, unknown>
}

interface SuccessOutput {
  success: true
  newArtifactId: string
  formula: string
  /** Source formula + artifactId so the card can render a before/after
   *  without re-reading the (now superseded) source payload. */
  sourceArtifactId: string
  sourceFormula: string
  operation: Operation
  summary: string
}

interface ErrorOutput {
  success: false
  error: string
}

type Output = SuccessOutput | ErrorOutput

function isStructureArtifact(a: Artifact | undefined): a is StructureArtifact {
  return !!a && a.kind === 'structure'
}

function parseSupercellDims(params: Record<string, unknown>): [number, number, number] | string {
  const raw = params.dims ?? params.nxyz ?? params.size ?? [
    params.nx,
    params.ny,
    params.nz,
  ]
  if (!Array.isArray(raw) || raw.length !== 3) {
    return 'supercell params must include dims: [nx, ny, nz]'
  }
  const [nx, ny, nz] = raw.map((v) => Number(v))
  if (![nx, ny, nz].every((n) => Number.isInteger(n) && n >= 1 && n <= 10)) {
    return 'supercell dims must be integers in [1, 10]'
  }
  return [nx, ny, nz]
}

interface ReplaceOpts {
  from: string
  to: string
}

function parseReplaceParams(params: Record<string, unknown>): ReplaceOpts | string {
  const from = typeof params.from === 'string' ? params.from.trim() : ''
  const to = typeof params.to === 'string' ? params.to.trim() : ''
  if (!from || !to) {
    return 'replace_element requires params { from: string, to: string }'
  }
  if (from === to) {
    return `replace_element: "from" and "to" are identical ("${from}")`
  }
  return { from, to }
}

function replaceElement(parsed: ParsedCif, opts: ReplaceOpts): ParsedCif {
  let replaced = 0
  const sites: CifSite[] = parsed.sites.map((s) => {
    if (s.element !== opts.from) return s
    replaced++
    return {
      ...s,
      element: opts.to,
      label: s.label.replace(new RegExp(`^${opts.from}`), opts.to),
    }
  })
  if (replaced === 0) {
    throw new Error(`No atoms matched element "${opts.from}"`)
  }
  return {
    dataBlock: `${parsed.dataBlock}_sub${opts.from}-${opts.to}`,
    lattice: parsed.lattice,
    // Element substitution breaks the original symmetry in general — drop
    // to P 1 so downstream consumers don't assume retained space group.
    spaceGroup: 'P 1',
    sites,
  }
}

export const structureModifyTool: LocalTool<Input, Output> = {
  name: 'structure_modify',
  description:
    'Apply a simple transformation to a structure artifact and register the result as a new artifact. Supported operations: "supercell" (params: { dims: [nx,ny,nz] }) and "replace_element" (params: { from: string, to: string }).',
  trustLevel: 'localWrite',
  cardMode: 'review',
  contextParams: ['artifactId'],
  inputSchema: {
    type: 'object',
    properties: {
      artifactId: {
        type: 'string',
        description: 'Source structure artifact id. Falls back to focused artifact.',
      },
      operation: {
        type: 'string',
        description: '"supercell" | "replace_element"',
      },
      params: {
        type: 'object',
        description:
          'Operation-specific params. supercell: { dims: [nx,ny,nz] }; replace_element: { from, to }.',
      },
    },
    required: ['operation', 'params'],
  },
  async execute(input, ctx) {
    const session = useRuntimeStore.getState().sessions[ctx.sessionId]
    if (!session) {
      return { success: false, error: `Session not found: ${ctx.sessionId}` }
    }
    const targetId = input?.artifactId ?? session.focusedArtifactId
    if (!targetId) {
      return {
        success: false,
        error: 'No artifactId provided and no focused artifact in the session.',
      }
    }
    const source = session.artifacts[targetId]
    if (!isStructureArtifact(source)) {
      return {
        success: false,
        error: `Artifact ${targetId} is not a structure artifact (kind=${source?.kind ?? 'missing'}).`,
      }
    }
    const op = input?.operation
    if (op !== 'supercell' && op !== 'replace_element') {
      return {
        success: false,
        error: `Unsupported operation: "${String(op)}" (expected "supercell" or "replace_element")`,
      }
    }
    const params = input?.params ?? {}

    let parsed: ParsedCif
    try {
      parsed = parseCif(source.payload.cif)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, error: `CIF parse failed: ${msg}` }
    }

    let nextParsed: ParsedCif
    let transformKind: StructureTransformKind
    let transformParams: Record<string, unknown>
    let transformNote: string
    try {
      if (op === 'supercell') {
        const dims = parseSupercellDims(params)
        if (typeof dims === 'string') return { success: false, error: dims }
        const [nx, ny, nz] = dims
        nextParsed = supercell(parsed, nx, ny, nz)
        transformKind = 'supercell'
        transformParams = { nx, ny, nz }
        transformNote = `${nx}x${ny}x${nz} supercell`
      } else {
        const opts = parseReplaceParams(params)
        if (typeof opts === 'string') return { success: false, error: opts }
        nextParsed = replaceElement(parsed, opts)
        transformKind = 'dope'
        transformParams = { from: opts.from, to: opts.to, fraction: 1 }
        transformNote = `Replaced ${opts.from} → ${opts.to}`
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, error: `${op} failed: ${msg}` }
    }

    const now = Date.now()
    const newCif = writeCif(nextParsed)
    const newFormula = computeFormula(nextParsed.sites)
    const newLattice = computeLatticeParams(nextParsed)
    const transform: StructureTransform = {
      id: `xfm_${now.toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      kind: transformKind,
      params: transformParams,
      appliedAt: now,
      note: transformNote,
    }
    const payload: StructureArtifactPayload = {
      cif: newCif,
      formula: newFormula,
      spaceGroup: nextParsed.spaceGroup ?? 'P 1',
      latticeParams: newLattice,
      transforms: [...source.payload.transforms, transform],
      computedFromArtifactId: source.id,
    }
    const artifact: StructureArtifact = {
      id: genArtifactId(),
      kind: 'structure',
      title: `${source.title} · ${transformNote}`,
      createdAt: now,
      updatedAt: now,
      parents: [source.id],
      payload,
    }
    useRuntimeStore.getState().upsertArtifact(ctx.sessionId, artifact)

    // Phase 7c — dual-file structure write for the newly derived child.
    if (ctx.orchestrator?.fs) {
      try {
        const slug = newFormula.toLowerCase().replace(/[^a-z0-9]+/g, '-')
          .replace(/(^-|-$)/g, '').slice(0, 48) || 'structure'
        await ctx.orchestrator.emitStructureArtifact(
          newCif,
          {
            formula: newFormula,
            spaceGroup: nextParsed.spaceGroup ?? 'P 1',
            latticeParams: newLattice,
            transforms: payload.transforms,
            computedFromArtifactId: source.id,
          },
          {
            basename: `${slug}-${artifact.id.slice(-6)}`,
            id: artifact.id,
            meta: { title: artifact.title, artifactId: artifact.id },
            parents: [source.id],
          },
        )
      } catch (err) {
        console.warn('[structure_modify] workspace emit failed', err)
      }
    }

    return {
      success: true,
      newArtifactId: artifact.id,
      formula: newFormula,
      sourceArtifactId: source.id,
      sourceFormula: source.payload.formula,
      operation: op,
      summary: `${transformNote} → ${newFormula} (${nextParsed.sites.length} atoms)`,
    }
  },
}
