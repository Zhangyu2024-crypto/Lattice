// Agent surface for the `compute-experiment` artifact (parameter sweeps).
//
// Four tools cover the lifecycle:
//   - `compute_experiment_create` — upsert a new experiment artifact
//   - `compute_experiment_run`    — drive pending (or all) points
//   - `compute_experiment_stop`   — abort the in-flight run
//   - `compute_experiment_rerun_points` — re-queue failed points
//
// Three create paths are supported:
//   1. **Built-in template** — pass a known `templateId` (e.g.
//      `cp2k_si_bulk_modulus`) and the registry generates objective +
//      parameters + points + per-point script template.
//   2. **Explicit points** — pass `points: Array<Record>` directly.
//      Parameters are inferred from the keys of the first point. Use
//      this when the agent has already laid out an arbitrary grid.
//   3. **Cartesian grid** — pass `parameters: Array<{name, values[]}>`.
//      The Cartesian product expands into points automatically.
//
// All three end in the same artifact shape; downstream tools and the
// runner do not care which path created it.

import type { LocalTool } from '../../types/agent-tool'
import {
  useRuntimeStore,
  genArtifactId,
} from '../../stores/runtime-store'
import type {
  Artifact,
  ComputeExperimentArtifact,
  ComputeExperimentParameter,
  ComputeExperimentPayload,
  ComputeExperimentPoint,
} from '../../types/artifact'
import {
  cancelComputeExperiment,
  runComputeExperiment,
} from '../compute-experiment-runner'
import {
  EXPERIMENT_TEMPLATES,
  type ExperimentTemplateBuild,
} from './compute-experiment-templates'

interface ParameterInput {
  name: string
  label?: string
  unit?: string
  kind?: 'continuous' | 'integer' | 'categorical' | 'boolean'
  values: Array<string | number | boolean>
}

interface MetricInput {
  name: string
  label?: string
  unit?: string
}

interface CreateInput {
  /** Optional title override. Defaults to the template title or the objective. */
  title?: string
  objective?: string
  engine?: 'python' | 'cp2k' | 'lammps' | 'shell'
  pointScriptTemplate?: string
  /** Explicit per-point parameter sets. When present, takes precedence
   *  over `parameters[]` Cartesian expansion. */
  points?: Array<Record<string, string | number | boolean>>
  /** Cartesian-grid parameters; expanded into points if `points` is absent. */
  parameters?: ParameterInput[]
  metrics?: MetricInput[]
  /** Built-in template id (see `EXPERIMENT_TEMPLATES`); also accepts the
   *  passthrough id `custom_parameter_sweep`, which expects the caller
   *  to supply objective / pointScriptTemplate / points-or-parameters. */
  templateId?: string
}

interface CreateOutput {
  ok: true
  artifactId: string
  pointCount: number
}

function inferParameters(
  points: Array<Record<string, string | number | boolean>>,
): ComputeExperimentParameter[] {
  if (points.length === 0) return []
  const seen = new Set<string>()
  const params: ComputeExperimentParameter[] = []
  for (const point of points) {
    for (const name of Object.keys(point)) {
      if (seen.has(name)) continue
      seen.add(name)
      const values = points
        .map((p) => p[name])
        .filter((v): v is string | number | boolean => v !== undefined)
      const distinct = Array.from(new Set(values.map((v) => JSON.stringify(v))))
      const kind: ComputeExperimentParameter['kind'] = (() => {
        if (values.every((v) => typeof v === 'boolean')) return 'boolean'
        if (values.every((v) => typeof v === 'number' && Number.isInteger(v)))
          return 'integer'
        if (values.every((v) => typeof v === 'number')) return 'continuous'
        return 'categorical'
      })()
      params.push({
        name,
        kind,
        values: distinct.map((s) => JSON.parse(s) as string | number | boolean),
        role: 'scan',
      })
    }
  }
  return params
}

function parameterFromInput(p: ParameterInput): ComputeExperimentParameter {
  const values = p.values ?? []
  const kind: ComputeExperimentParameter['kind'] = (() => {
    if (p.kind) return p.kind
    if (values.every((v) => typeof v === 'boolean')) return 'boolean'
    if (values.every((v) => typeof v === 'number' && Number.isInteger(v))) {
      return 'integer'
    }
    if (values.every((v) => typeof v === 'number')) return 'continuous'
    return 'categorical'
  })()
  return {
    name: p.name,
    label: p.label,
    unit: p.unit,
    kind,
    values,
    role: 'scan',
  }
}

function buildCartesianPoints(
  params: ComputeExperimentParameter[],
): Array<Record<string, string | number | boolean>> {
  const scanParams = params.filter((p) => (p.values?.length ?? 0) > 0)
  if (scanParams.length === 0) return []
  let combos: Array<Record<string, string | number | boolean>> = [{}]
  for (const p of scanParams) {
    const next: typeof combos = []
    for (const combo of combos) {
      for (const v of p.values ?? []) {
        next.push({ ...combo, [p.name]: v })
      }
    }
    combos = next
  }
  return combos
}

function pointsFromRecords(
  records: Array<Record<string, string | number | boolean>>,
): ComputeExperimentPoint[] {
  return records.map((params, index) => ({
    id: `pt_${index.toString().padStart(4, '0')}`,
    index,
    params,
    status: 'pending' as const,
  }))
}

interface ResolvedBuild {
  title: string
  objective: string
  engine: 'python' | 'cp2k' | 'lammps' | 'shell'
  pointScriptTemplate: string
  parameters: ComputeExperimentParameter[]
  points: ComputeExperimentPoint[]
  metrics: Array<{ name: string; label?: string; unit?: string }>
  templateId: string
}

function resolveBuild(input: CreateInput): ResolvedBuild {
  const templateId = input.templateId
  // Path 1: built-in template
  if (templateId && templateId !== 'custom_parameter_sweep') {
    const tmpl = EXPERIMENT_TEMPLATES[templateId]
    if (!tmpl) {
      throw new Error(
        `Unknown experiment templateId '${templateId}'. Use 'custom_parameter_sweep' for explicit input or pick from: ${Object.keys(EXPERIMENT_TEMPLATES).join(', ')}.`,
      )
    }
    const built: ExperimentTemplateBuild = tmpl.build()
    return {
      title: input.title ?? built.title,
      objective: input.objective ?? built.objective,
      engine: input.engine ?? built.engine,
      pointScriptTemplate: input.pointScriptTemplate ?? built.pointScriptTemplate,
      parameters: built.parameters,
      points: built.points,
      metrics: input.metrics ?? built.metrics,
      templateId,
    }
  }

  // Path 2 / 3: caller-supplied build
  if (!input.pointScriptTemplate?.trim()) {
    throw new Error('pointScriptTemplate is required when no built-in templateId is given')
  }
  let parameters: ComputeExperimentParameter[]
  let points: ComputeExperimentPoint[]
  if (input.points && input.points.length > 0) {
    parameters = inferParameters(input.points)
    points = pointsFromRecords(input.points)
  } else if (input.parameters && input.parameters.length > 0) {
    parameters = input.parameters.map(parameterFromInput)
    const records = buildCartesianPoints(parameters)
    if (records.length === 0) {
      throw new Error('parameters produced 0 points — every parameter has empty values[]')
    }
    points = pointsFromRecords(records)
  } else {
    throw new Error('Either points[] or parameters[] is required')
  }

  return {
    title: input.title ?? input.objective ?? 'Compute experiment',
    objective: input.objective ?? input.title ?? 'Compute experiment',
    engine: input.engine ?? 'python',
    pointScriptTemplate: input.pointScriptTemplate,
    parameters,
    points,
    metrics: input.metrics ?? [],
    templateId: templateId ?? 'custom_parameter_sweep',
  }
}

export const computeExperimentCreateTool: LocalTool<CreateInput, CreateOutput> = {
  name: 'compute_experiment_create',
  description:
    'Create a new compute-experiment artifact (parameter sweep). Three input paths: (1) built-in templateId (e.g. cp2k_si_bulk_modulus); (2) explicit points: Array<Record>; (3) parameters: Array<{name, values[]}> for Cartesian expansion. Per-point script supports {{params_json}}, {{point_id}}, {{point_index}}, {{param:<name>}}; print metric values via __LATTICE_METRIC__ name=value. Returns artifactId + pointCount. Use compute_experiment_run to execute.',
  trustLevel: 'localWrite',
  cardMode: 'review',
  inputSchema: {
    type: 'object',
    properties: {
      templateId: {
        type: 'string',
        description:
          "Built-in template id, or 'custom_parameter_sweep' for explicit input.",
      },
      title: { type: 'string' },
      objective: { type: 'string' },
      engine: {
        type: 'string',
        description: "'python' | 'cp2k' | 'lammps' | 'shell'.",
      },
      pointScriptTemplate: { type: 'string' },
      points: {
        type: 'array',
        description: 'Explicit per-point parameter records.',
      },
      parameters: {
        type: 'array',
        description: 'Cartesian-grid parameters: each entry { name, values[] }.',
      },
      metrics: {
        type: 'array',
        description: 'Expected metric column names.',
      },
    },
  },
  async execute(input, ctx) {
    const build = resolveBuild(input ?? {})
    if (build.points.length === 0) {
      throw new Error('Experiment produced 0 points — supply points[] or parameters[] with non-empty values.')
    }

    const now = Date.now()
    const payload: ComputeExperimentPayload = {
      schemaVersion: 1,
      templateId: build.templateId,
      objective: build.objective,
      pointScriptTemplate: build.pointScriptTemplate,
      engine: build.engine,
      status: 'draft',
      parameters: build.parameters,
      points: build.points,
      metrics: build.metrics,
      analysis: [],
      stdout: '',
      stderr: '',
      activeRunId: null,
    }

    const artifactId = genArtifactId()
    const artifact: ComputeExperimentArtifact = {
      id: artifactId,
      kind: 'compute-experiment',
      title: build.title,
      createdAt: now,
      updatedAt: now,
      payload,
    } as ComputeExperimentArtifact

    useRuntimeStore.getState().upsertArtifact(ctx.sessionId, artifact as Artifact)
    return { ok: true, artifactId, pointCount: build.points.length }
  },
}

interface RunInput {
  artifactId: string
  mode?: 'pending' | 'failed' | 'all'
}

interface RunOutput {
  ok: true
  artifactId: string
  succeeded: number
  failed: number
  cancelled: boolean
}

export const computeExperimentRunTool: LocalTool<RunInput, RunOutput> = {
  name: 'compute_experiment_run',
  description:
    'Run pending (or all) points in a compute-experiment artifact. Sequential — points execute one at a time through the same hostExec compute IPC as compute_run. Returns summary counts after completion. Long-running.',
  trustLevel: 'hostExec',
  cardMode: 'review',
  contextParams: ['artifactId'],
  inputSchema: {
    type: 'object',
    properties: {
      artifactId: { type: 'string' },
      mode: {
        type: 'string',
        description: "'pending' (default) | 'failed' | 'all'.",
      },
    },
    required: ['artifactId'],
  },
  async execute(input, ctx) {
    if (!input?.artifactId) throw new Error('artifactId is required')
    const mode = input.mode ?? 'pending'
    if (mode !== 'pending' && mode !== 'failed' && mode !== 'all') {
      throw new Error(`mode must be 'pending' | 'failed' | 'all', got '${mode}'`)
    }
    await runComputeExperiment({
      sessionId: ctx.sessionId,
      artifactId: input.artifactId,
      mode,
    })
    return summariseResult(ctx.sessionId, input.artifactId)
  },
}

interface StopInput {
  artifactId: string
}

interface StopOutput {
  ok: true
  stopped: boolean
}

export const computeExperimentStopTool: LocalTool<StopInput, StopOutput> = {
  name: 'compute_experiment_stop',
  description:
    'Abort an in-flight compute-experiment run. Returns stopped=true if there was an active run, false otherwise.',
  trustLevel: 'hostExec',
  cardMode: 'review',
  contextParams: ['artifactId'],
  inputSchema: {
    type: 'object',
    properties: {
      artifactId: { type: 'string' },
    },
    required: ['artifactId'],
  },
  async execute(input, ctx) {
    if (!input?.artifactId) throw new Error('artifactId is required')
    const stopped = await cancelComputeExperiment(ctx.sessionId, input.artifactId)
    return { ok: true, stopped }
  },
}

interface RerunInput {
  artifactId: string
}

interface RerunOutput {
  ok: true
  artifactId: string
  succeeded: number
  failed: number
  cancelled: boolean
}

export const computeExperimentRerunTool: LocalTool<RerunInput, RerunOutput> = {
  name: 'compute_experiment_rerun_points',
  description:
    'Re-run failed points in a compute-experiment artifact. Sequential, same hostExec gate as compute_experiment_run. Cleared metrics + error fields are repopulated by each rerun.',
  trustLevel: 'hostExec',
  cardMode: 'review',
  contextParams: ['artifactId'],
  inputSchema: {
    type: 'object',
    properties: {
      artifactId: { type: 'string' },
    },
    required: ['artifactId'],
  },
  async execute(input, ctx) {
    if (!input?.artifactId) throw new Error('artifactId is required')
    await runComputeExperiment({
      sessionId: ctx.sessionId,
      artifactId: input.artifactId,
      mode: 'failed',
    })
    return summariseResult(ctx.sessionId, input.artifactId)
  },
}

function summariseResult(
  sessionId: string,
  artifactId: string,
): { ok: true; artifactId: string; succeeded: number; failed: number; cancelled: boolean } {
  const session = useRuntimeStore.getState().sessions[sessionId]
  const artifact = session?.artifacts[artifactId]
  const payload = artifact?.payload as ComputeExperimentPayload | undefined
  const points = payload?.points ?? []
  return {
    ok: true,
    artifactId,
    succeeded: points.filter((p) => p.status === 'succeeded').length,
    failed: points.filter((p) => p.status === 'failed').length,
    cancelled: payload?.status === 'cancelled',
  }
}
