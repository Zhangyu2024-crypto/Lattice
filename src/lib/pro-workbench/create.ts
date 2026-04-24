// Artifact factory that turns a `CreateOpts` bundle into the matching
// Pro workbench artifact, registers it in the runtime store, and focuses
// it (unless the caller is opening a dedicated Electron window).
//
// Phase 5 migration note: new entry points should always create
// `spectrum-pro`; the legacy per-technique kinds are kept for back-compat
// and warn loudly when invoked so remaining call sites surface.

import type {
  Artifact,
  ArtifactId,
  ComputeProArtifact,
  CurveProArtifact,
  RamanProArtifact,
  SpectrumProArtifact,
  XpsProArtifact,
  XpsProPayload,
  XrdProArtifact,
  XrdProPayload,
  XrdSubState,
} from '../../types/artifact'
import { genArtifactId, useRuntimeStore } from '../../stores/runtime-store'
import type { CreateOpts, InitialXrdState } from './types'
import {
  defaultComputeProPayload,
  defaultCurveProPayload,
  defaultRamanProPayload,
  defaultSpectrumProPayload,
  defaultXpsProPayload,
  defaultXrdProPayload,
} from './defaults'

/** Title picker for the multiplexed `spectrum-pro` workbench. */
function titleForSpectrumPro(
  technique: SpectrumProArtifact['payload']['technique'],
): string {
  switch (technique) {
    case 'xps':
      return 'XPS Lab'
    case 'raman':
      return 'Raman Lab'
    case 'ftir':
      return 'FTIR Lab'
    case 'xrd':
      return 'XRD Lab'
    case 'curve':
      return 'Curve Lab'
    default:
      return 'Spectrum Lab'
  }
}

function mergeXrdParams(
  base: XrdProPayload['params'],
  seed?: InitialXrdState['params'],
): XrdProPayload['params'] {
  if (!seed) return base
  return {
    ...base,
    ...seed,
    peakDetect: {
      ...base.peakDetect,
      ...(seed.peakDetect ?? {}),
    },
    phaseSearch: {
      ...base.phaseSearch,
      ...(seed.phaseSearch ?? {}),
    },
    refinement: {
      ...base.refinement,
      ...(seed.refinement ?? {}),
    },
    scherrer: {
      ...base.scherrer,
      ...(seed.scherrer ?? {}),
    },
  }
}

function applyInitialXrdPayload(
  base: XrdProPayload,
  seed?: InitialXrdState,
): XrdProPayload {
  if (!seed) return base
  return {
    ...base,
    ...seed,
    params: mergeXrdParams(base.params, seed.params),
  }
}

function applyInitialXrdSubState(
  base: XrdSubState,
  seed?: InitialXrdState,
): XrdSubState {
  if (!seed) return base
  return {
    ...base,
    ...seed,
    params: mergeXrdParams(base.params, seed.params),
  }
}

/**
 * Create a new Pro workbench artifact, register it in the session store,
 * and focus it. Returns the new artifact id.
 */
export function createProWorkbench(opts: CreateOpts): ArtifactId {
  // Phase 5: new work should always create `spectrum-pro`. We still
  // honour the legacy kinds for back-compat (older entry points / session
  // snapshots), but we flag them so the remaining call sites surface in
  // the dev console. Phase 6 collapses these branches into a single
  // `spectrum-pro` path.
  if (
    opts.kind === 'xrd-pro' ||
    opts.kind === 'xps-pro' ||
    opts.kind === 'raman-pro' ||
    opts.kind === 'curve-pro'
  ) {
    // eslint-disable-next-line no-console
    console.warn(
      `[pro-workbench] Legacy kind '${opts.kind}' is deprecated — prefer creating 'spectrum-pro' with a technique instead. Proceeding for back-compat.`,
    )
  }
  const store = useRuntimeStore.getState()
  const now = Date.now()
  const id = genArtifactId()
  const parents = opts.sourceArtifactId ? [opts.sourceArtifactId] : undefined

  let artifact: Artifact
  switch (opts.kind) {
    case 'xrd-pro': {
      const base = defaultXrdProPayload(opts.spectrum ?? null)
      artifact = {
        id,
        kind: 'xrd-pro',
        title: opts.title ?? 'XRD Lab',
        createdAt: now,
        updatedAt: now,
        parents,
        payload: applyInitialXrdPayload(base, opts.initialXrdState),
      } satisfies XrdProArtifact
      break
    }
    case 'xps-pro': {
      const base = defaultXpsProPayload(opts.spectrum ?? null)
      const xpsPayload: XpsProPayload = {
        ...base,
        peakDefinitions:
          opts.initialPeaks && opts.initialPeaks.length > 0
            ? opts.initialPeaks
            : base.peakDefinitions,
        params: {
          ...base.params,
          energyWindow: opts.initialEnergyWindow
            ? {
                min: opts.initialEnergyWindow.min,
                max: opts.initialEnergyWindow.max,
              }
            : base.params.energyWindow,
        },
      }
      artifact = {
        id,
        kind: 'xps-pro',
        title: opts.title ?? 'XPS Lab',
        createdAt: now,
        updatedAt: now,
        parents,
        payload: xpsPayload,
      } satisfies XpsProArtifact
      break
    }
    case 'raman-pro':
      artifact = {
        id,
        kind: 'raman-pro',
        title:
          opts.title ??
          (opts.ramanMode === 'ftir'
            ? 'FTIR Lab'
            : 'Raman Lab'),
        createdAt: now,
        updatedAt: now,
        parents,
        payload: defaultRamanProPayload(
          opts.spectrum ?? null,
          opts.ramanMode ?? 'raman',
        ),
      } satisfies RamanProArtifact
      break
    case 'curve-pro':
      artifact = {
        id,
        kind: 'curve-pro',
        title: opts.title ?? 'Curve Lab',
        createdAt: now,
        updatedAt: now,
        parents,
        payload: defaultCurveProPayload(opts.spectrum ?? null),
      } satisfies CurveProArtifact
      break
    case 'spectrum-pro': {
      const technique = opts.technique ?? null
      const base = defaultSpectrumProPayload(technique, opts.spectrum ?? null)
      artifact = {
        id,
        kind: 'spectrum-pro',
        title: opts.title ?? titleForSpectrumPro(technique),
        createdAt: now,
        updatedAt: now,
        parents,
        payload: {
          ...base,
          xrd: applyInitialXrdSubState(base.xrd, opts.initialXrdState),
        },
      } satisfies SpectrumProArtifact
      break
    }
    case 'compute-pro':
      artifact = {
        id,
        kind: 'compute-pro',
        title: opts.title ?? 'Compute Lab',
        createdAt: now,
        updatedAt: now,
        parents,
        payload: defaultComputeProPayload(),
      } satisfies ComputeProArtifact
      break
  }

  store.upsertArtifact(opts.sessionId, artifact, {
    preserveFocus: Boolean(opts.openInNewWindow),
  })
  if (!opts.openInNewWindow) {
    store.focusArtifact(opts.sessionId, id)
  }
  return id
}
