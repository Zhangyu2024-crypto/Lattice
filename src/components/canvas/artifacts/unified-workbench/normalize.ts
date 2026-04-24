// Normalisation layer — project any Pro artifact kind onto a common
// shape the technique module expects: a `SpectrumProPayload`-view
// (`ctx.payload`) plus a narrowed `sub` slot for the active technique
// and two write-back functions (`patchShared`, `patchSubState`).
//
// Legacy kinds (`xrd-pro` / `xps-pro` / `raman-pro` / `curve-pro`) each
// have exactly one sub-state at their payload root, so `patchSubState`
// always writes to the same place the module reads `ctx.sub` from. The
// empty sibling sub-states in the unified view are throwaway
// placeholders — the module for a legacy kind never reads them.

import type {
  Artifact,
  CurveProArtifact,
  CurveProPayload,
  RamanProArtifact,
  RamanProPayload,
  SpectrumProArtifact,
  SpectrumProPayload,
  SpectrumTechnique,
  XpsProArtifact,
  XpsProPayload,
  XrdProArtifact,
  XrdProPayload,
} from '@/types/artifact'
import {
  isCurveProArtifact,
  isRamanProArtifact,
  isSpectrumProArtifact,
  isXpsProArtifact,
  isXrdProArtifact,
} from '@/types/artifact'
import { curveSubStateFromDefault } from '@/lib/pro-workbench'
import { useRuntimeStore } from '@/stores/runtime-store'
import { ALL_TECHNIQUES } from './constants'
import { selectSub, stripShared, writeSubToPayload } from './helpers'

// Local alias so we don't depend on the re-export chain from
// `@/types/artifact`.
export type SharedPayloadFieldsLocal = Pick<
  SpectrumProPayload,
  'spectrum' | 'quality' | 'status' | 'lastError'
>

export interface NormalizedArtifact {
  technique: SpectrumTechnique
  isLegacy: boolean
  unified: SpectrumProPayload
  sub: unknown
  availableTechniques: SpectrumTechnique[]
  patchShared: (partial: Partial<SharedPayloadFieldsLocal>) => void
  patchSubState: (partial: Partial<unknown>) => void
}

export interface NormalizeInputs {
  artifact: Artifact
  sessionId: string
  currentTechnique: SpectrumTechnique
  patchArtifact: ReturnType<typeof useRuntimeStore.getState>['patchArtifact']
}

export function normalizeArtifact(inputs: NormalizeInputs): NormalizedArtifact {
  const { artifact, sessionId, currentTechnique, patchArtifact } = inputs

  if (isSpectrumProArtifact(artifact)) {
    return normalizeSpectrumPro({
      artifact,
      sessionId,
      currentTechnique,
      patchArtifact,
    })
  }
  if (isXrdProArtifact(artifact)) {
    return normalizeXrdPro({ artifact, sessionId, patchArtifact })
  }
  if (isXpsProArtifact(artifact)) {
    return normalizeXpsPro({ artifact, sessionId, patchArtifact })
  }
  if (isRamanProArtifact(artifact)) {
    return normalizeRamanPro({ artifact, sessionId, patchArtifact })
  }
  if (isCurveProArtifact(artifact)) {
    return normalizeCurvePro({ artifact, sessionId, patchArtifact })
  }
  // Unreachable given the top-level narrow; fall through to a throw so
  // any future kind addition surfaces loudly.
  throw new Error(`Unsupported Pro artifact kind: ${artifact.kind}`)
}

// ── spectrum-pro ─────────────────────────────────────────────────

function normalizeSpectrumPro(inputs: {
  artifact: SpectrumProArtifact
  sessionId: string
  currentTechnique: SpectrumTechnique
  patchArtifact: NormalizeInputs['patchArtifact']
}): NormalizedArtifact {
  const { artifact, sessionId, currentTechnique, patchArtifact } = inputs
  const payload = artifact.payload

  // spectrum-pro pre-dates the curve sub-state — older persisted payloads
  // will be missing `curve`. Coalesce so the module always sees a live
  // sub-state; writes below propagate a populated `curve` back into the
  // payload the first time a curve write happens.
  const unified: SpectrumProPayload = {
    ...payload,
    curve: payload.curve ?? curveSubStateFromDefault(),
  }

  const sub = selectSub(unified, currentTechnique)

  const patchShared = (partial: Partial<SharedPayloadFieldsLocal>) => {
    const fresh = useRuntimeStore.getState().sessions[sessionId]?.artifacts[artifact.id]
    const currentPayload = (fresh?.payload ?? payload) as SpectrumProPayload
    patchArtifact(sessionId, artifact.id, {
      payload: {
        ...currentPayload,
        ...partial,
      },
    })
  }

  const patchSubState = (partial: Partial<unknown>) => {
    const fresh = useRuntimeStore.getState().sessions[sessionId]?.artifacts[artifact.id]
    const currentPayload = (fresh?.payload ?? payload) as SpectrumProPayload
    const prevSub = selectSub(currentPayload, currentTechnique) as Record<string, unknown>
    const nextSub = {
      ...prevSub,
      ...(partial as unknown as Record<string, unknown>),
    }
    const nextPayload: SpectrumProPayload = {
      ...currentPayload,
      ...writeSubToPayload(currentTechnique, nextSub),
    }
    patchArtifact(sessionId, artifact.id, { payload: nextPayload })
  }

  return {
    technique: currentTechnique,
    isLegacy: false,
    unified,
    sub,
    availableTechniques: [...ALL_TECHNIQUES],
    patchShared,
    patchSubState,
  }
}

// ── legacy kinds ─────────────────────────────────────────────────

interface LegacyInputs<A extends Artifact> {
  artifact: A
  sessionId: string
  patchArtifact: NormalizeInputs['patchArtifact']
}

interface LegacyDescriptor<A extends Artifact> {
  technique: SpectrumTechnique
  /** Where the active sub-state lives on the unified view. */
  slot: 'xrd' | 'xps' | 'raman' | 'curve'
  /** Re-inflates the legacy payload after a patch. The type cast keeps
   *  the store's generic `Artifact` patch signature happy. */
  rebuild: (payload: A['payload'], patch: Record<string, unknown>) => A['payload']
}

function normalizeLegacy<A extends Artifact>(
  inputs: LegacyInputs<A>,
  desc: LegacyDescriptor<A>,
): NormalizedArtifact {
  const { artifact, sessionId, patchArtifact } = inputs
  // Widen to a plain record for the generic projection. All legacy Pro
  // payloads carry `spectrum / quality / status / lastError` at the top
  // level, so reading them via bracket access is sound.
  const payload = artifact.payload as unknown as Record<string, unknown>

  const sub = stripShared(payload)

  const unified: SpectrumProPayload = {
    technique: desc.technique,
    spectrum: (payload.spectrum as SpectrumProPayload['spectrum']) ?? null,
    quality: (payload.quality as SpectrumProPayload['quality']) ?? null,
    status: (payload.status as SpectrumProPayload['status']) ?? 'idle',
    lastError: (payload.lastError as string | null | undefined) ?? null,
    xrd: (desc.slot === 'xrd' ? sub : {}) as SpectrumProPayload['xrd'],
    xps: (desc.slot === 'xps' ? sub : {}) as SpectrumProPayload['xps'],
    raman: (desc.slot === 'raman' ? sub : {}) as SpectrumProPayload['raman'],
    ...(desc.slot === 'curve'
      ? { curve: sub as SpectrumProPayload['curve'] }
      : null),
  }

  const patchShared = (partial: Partial<SharedPayloadFieldsLocal>) => {
    const fresh = useRuntimeStore.getState().sessions[sessionId]?.artifacts[artifact.id]
    const currentPayload = fresh?.payload ?? artifact.payload
    patchArtifact(sessionId, artifact.id, {
      payload: desc.rebuild(
        currentPayload,
        partial as unknown as Record<string, unknown>,
      ),
    })
  }
  const patchSubState = (partial: Partial<unknown>) => {
    const fresh = useRuntimeStore.getState().sessions[sessionId]?.artifacts[artifact.id]
    const currentPayload = fresh?.payload ?? artifact.payload
    patchArtifact(sessionId, artifact.id, {
      payload: desc.rebuild(
        currentPayload,
        partial as unknown as Record<string, unknown>,
      ),
    })
  }

  return {
    technique: desc.technique,
    isLegacy: true,
    unified,
    sub,
    availableTechniques: [desc.technique],
    patchShared,
    patchSubState,
  }
}

function normalizeXrdPro(inputs: LegacyInputs<XrdProArtifact>): NormalizedArtifact {
  return normalizeLegacy(inputs, {
    technique: 'xrd',
    slot: 'xrd',
    rebuild: (p, patch) => ({ ...p, ...patch } as XrdProPayload),
  })
}

function normalizeXpsPro(inputs: LegacyInputs<XpsProArtifact>): NormalizedArtifact {
  return normalizeLegacy(inputs, {
    technique: 'xps',
    slot: 'xps',
    rebuild: (p, patch) => ({ ...p, ...patch } as XpsProPayload),
  })
}

function normalizeRamanPro(inputs: LegacyInputs<RamanProArtifact>): NormalizedArtifact {
  // `params.mode` distinguishes raman from ftir; only the cursor differs.
  const technique: SpectrumTechnique =
    inputs.artifact.payload.params.mode === 'ftir' ? 'ftir' : 'raman'
  return normalizeLegacy(inputs, {
    technique,
    slot: 'raman',
    rebuild: (p, patch) => ({ ...p, ...patch } as RamanProPayload),
  })
}

function normalizeCurvePro(inputs: LegacyInputs<CurveProArtifact>): NormalizedArtifact {
  return normalizeLegacy(inputs, {
    technique: 'curve',
    slot: 'curve',
    rebuild: (p, patch) => ({ ...p, ...patch } as CurveProPayload),
  })
}
