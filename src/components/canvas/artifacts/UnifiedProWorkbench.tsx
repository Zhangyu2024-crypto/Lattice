// UnifiedProWorkbench — single host for every Pro artifact kind.
//
// Phase 3 of the refactor consolidates the five per-kind workbench
// components (XrdProWorkbench / XpsProWorkbench / RamanProWorkbench /
// CurveProWorkbench / SpectrumProWorkbench) behind one entry point. It
// delegates all rendering to `TechniqueWorkbenchUI` plus whichever
// `TechniqueModule` matches the active technique, and slots the
// `ProTechniqueSwitcher` into the ribbon's left edge for lens changes.
//
// A `spectrum-pro` artifact carries five co-resident sub-states
// (`payload.xrd`, `.xps`, `.raman`, `.curve`) and a `technique` cursor —
// switching lenses only changes the cursor, so peaks / fits / params in
// the other sub-states survive round-trips. Legacy kinds (`xrd-pro`,
// `xps-pro`, `raman-pro`, `curve-pro`) still render here, but with the
// switcher frozen to a single segment: their payloads only have one
// sub-state so lens switching would be destructive.
//
// The normalise layer, helpers and static constants live in
// `./unified-workbench/*` — this file only owns the host component
// itself (hook wiring + palette command decoration + JSX).

import { useCallback, useEffect, useMemo, useRef } from 'react'
import { Upload } from 'lucide-react'
import type {
  Artifact,
  ProWorkbenchSpectrum,
  ProWorkbenchStatus,
  SpectrumProArtifact,
  SpectrumTechnique,
} from '@/types/artifact'
import {
  isCurveProArtifact,
  isRamanProArtifact,
  isSpectrumProArtifact,
  isXpsProArtifact,
  isXrdProArtifact,
} from '@/types/artifact'
import { useRuntimeStore } from '@/stores/runtime-store'
import { toast } from '@/stores/toast-store'
import {
  canParseLocally,
  needsBinaryRead,
  parseSpectrumBinary,
  parseSpectrumText,
} from '@/lib/parsers/parse-spectrum-file'
import TechniqueWorkbenchUI from './pro/modules/TechniqueWorkbenchUI'
import type { ModuleCtx, TechniqueModule } from './pro/modules/types'
import type {
  CommandContext,
  CommandDef,
  ProWorkbenchKind,
} from './pro/commandRegistry'
import { getModuleForTechnique } from './pro/modules/registry'
import ProTechniqueSwitcher from './pro/ProTechniqueSwitcher'
import {
  ALL_TECHNIQUES,
  TECHNIQUE_SHORTCUT_KEYS,
  TECHNIQUE_SHORTCUT_ORDER,
} from './unified-workbench/constants'
import {
  isEditableTarget,
  moduleLabel,
  resolveRegistryKind,
  resolveTechnique,
} from './unified-workbench/helpers'
import { normalizeArtifact } from './unified-workbench/normalize'

interface Props {
  artifact: Artifact
  sessionId: string
}

// ─── Component ─────────────────────────────────────────────────────

export default function UnifiedProWorkbench({ artifact, sessionId }: Props) {
  if (
    !isSpectrumProArtifact(artifact) &&
    !isXrdProArtifact(artifact) &&
    !isXpsProArtifact(artifact) &&
    !isRamanProArtifact(artifact) &&
    !isCurveProArtifact(artifact)
  ) {
    return (
      <div style={{ padding: 12, fontSize: "var(--text-sm)", color: 'var(--color-text-muted)' }}>
        UnifiedProWorkbench received unsupported kind: {artifact.kind}
      </div>
    )
  }
  return <Inner artifact={artifact} sessionId={sessionId} />
}

function Inner({ artifact, sessionId }: Props) {
  const patchArtifact = useRuntimeStore((s) => s.patchArtifact)

  // Resolve the active technique first — spectrum-pro uses the payload
  // cursor (with a persisted fallback on mount); legacy kinds are fixed.
  const resolvedTechnique = useMemo(
    () => resolveTechnique(artifact),
    [artifact],
  )

  // If spectrum-pro's cursor is still null, commit the resolved default
  // back to the payload so subsequent renders see a stable value. This
  // runs once per artifact-id (the effect depends on the artifact) and
  // only fires when the payload is actually missing a technique.
  useEffect(() => {
    if (
      isSpectrumProArtifact(artifact) &&
      artifact.payload.technique == null
    ) {
      patchArtifact(sessionId, artifact.id, {
        payload: {
          ...artifact.payload,
          technique: resolvedTechnique,
        },
      })
    }
    // `patchArtifact` is stable; only re-run when artifact identity or
    // the resolved default changes.
  }, [artifact, sessionId, resolvedTechnique, patchArtifact])

  const normalized = useMemo(
    () =>
      normalizeArtifact({
        artifact,
        sessionId,
        currentTechnique: resolvedTechnique,
        patchArtifact,
      }),
    [artifact, sessionId, resolvedTechnique, patchArtifact],
  )

  const onSwitchTechnique = useCallback(
    (t: SpectrumTechnique) => {
      if (normalized.isLegacy) return
      if (t === resolvedTechnique) return
      const spectrumArt = artifact as SpectrumProArtifact
      patchArtifact(sessionId, spectrumArt.id, {
        payload: {
          ...spectrumArt.payload,
          technique: t,
        },
      })
    },
    [normalized.isLegacy, resolvedTechnique, artifact, sessionId, patchArtifact],
  )

  // Palette / shortcut entry point — called from both the always-on
  // `switch technique` command and `Ctrl/⌘+1..5`. Validates the target
  // technique against what the artifact actually supports (legacy kinds
  // are locked to a single slot) and surfaces a toast on rejection so
  // scripted commands give the user a hint.
  const handleSwitchCommand = useCallback(
    (name: string): void => {
      const lower = name.toLowerCase()
      if (!(ALL_TECHNIQUES as readonly string[]).includes(lower)) {
        toast.warn(
          `Unknown technique "${name}" — expected one of xrd / xps / raman / ftir / curve.`,
        )
        return
      }
      // Checked above — safe to narrow.
      const target = lower as SpectrumTechnique
      if (normalized.isLegacy) {
        toast.warn(
          `This artifact is locked to ${moduleLabel(resolvedTechnique)} — create a new spectrum-pro to use the switcher.`,
        )
        return
      }
      if (!normalized.availableTechniques.includes(target)) {
        toast.warn(`${moduleLabel(target)} isn't available on this artifact.`)
        return
      }
      onSwitchTechnique(target)
    },
    [
      normalized.isLegacy,
      normalized.availableTechniques,
      resolvedTechnique,
      onSwitchTechnique,
    ],
  )

  // ── Keyboard shortcuts: Ctrl/Cmd+1..5 → technique 1..5 ────────────
  //
  // Only fires when this artifact is the focused one in the session so
  // multiple open workbenches don't all race for the same chord. Skipped
  // entirely while the user is typing into an input / textarea /
  // contenteditable so param editors can keep their numeric shortcuts.
  const focusedArtifactId = useRuntimeStore(
    (s) => s.sessions[sessionId]?.focusedArtifactId ?? null,
  )
  useEffect(() => {
    if (focusedArtifactId !== artifact.id) return
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return
      // Keep modifier combos that Pro already owns (⌘K palette etc.) out
      // of our way — only plain Ctrl/⌘ + digit triggers a switch.
      if (e.shiftKey || e.altKey) return
      const idx = TECHNIQUE_SHORTCUT_KEYS.indexOf(e.key)
      if (idx === -1) return
      if (isEditableTarget(document.activeElement)) return
      const target = TECHNIQUE_SHORTCUT_ORDER[idx]
      if (!normalized.availableTechniques.includes(target)) return
      e.preventDefault()
      e.stopImmediatePropagation()
      if (target !== resolvedTechnique) onSwitchTechnique(target)
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
  }, [
    focusedArtifactId,
    artifact.id,
    normalized.availableTechniques,
    resolvedTechnique,
    onSwitchTechnique,
  ])

  // ── Busy-on-switch toast ──────────────────────────────────────────
  //
  // UnifiedProWorkbench can't peek into a module's private `busy` state,
  // but modules propagate in-flight async via `payload.status = 'loading'`
  // (patched through `patchShared`). When the technique cursor moves
  // while the previous cursor was still loading, that's a mid-flight
  // switch — surface a best-effort warning so the user knows the old
  // technique's work is still running in the background.
  const prevTechStatusRef = useRef<{
    technique: SpectrumTechnique
    status: ProWorkbenchStatus
  } | null>(null)
  useEffect(() => {
    const prev = prevTechStatusRef.current
    const currStatus = normalized.unified.status
    if (
      prev &&
      prev.technique !== resolvedTechnique &&
      prev.status === 'loading'
    ) {
      toast.warn(
        `${moduleLabel(prev.technique)} action still running — it will complete in the background`,
      )
    }
    prevTechStatusRef.current = {
      technique: resolvedTechnique,
      status: currStatus,
    }
  }, [resolvedTechnique, normalized.unified.status])

  const techniqueModule = getModuleForTechnique(resolvedTechnique)

  const ctx: ModuleCtx<unknown> = {
    artifact,
    sessionId,
    payload: normalized.unified,
    sub: normalized.sub,
    patchShared: normalized.patchShared,
    patchSubState: normalized.patchSubState,
  }

  const title =
    normalized.unified.spectrum?.sourceFile ?? '(no spectrum loaded)'

  // `spectrum-pro` is the unified kind; legacy kinds keep their own
  // registry bucket so per-kind command scopes still work.
  const registryKind: ProWorkbenchKind = resolveRegistryKind(artifact)

  // ── Decorate module with always-on commands ───────────────────────
  //
  // The unified workbench adds two technique-agnostic commands on top of
  // whatever the active module exposes:
  //   • `switch technique --name=<xrd|xps|raman|ftir|curve>` — route the
  //     switcher through the palette so scripts / shortcuts share one path
  //   • `snapshot` — delegate to the module's own snapshot if it has one,
  //     otherwise fall back to a friendly toast. Filters any existing
  //     same-named command first so we don't end up with duplicates in
  //     the palette hit list.
  //
  // A fresh `decoratedModule` is built whenever the underlying module or
  // one of the handlers changes; `TechniqueWorkbenchUI`'s
  // `useEffect([module, ctx, actions, registryKind])` picks up the new
  // command list and re-registers with the palette registry.
  const decoratedModule = useMemo<TechniqueModule<unknown>>(
    () => ({
      ...techniqueModule,
      commands(innerCtx, actions) {
        const base = techniqueModule.commands(innerCtx, actions)
        const baseWithoutSnapshot = base.filter((c) => c.name !== 'snapshot')
        const snapshotBase = base.find((c) => c.name === 'snapshot')
        const extras: CommandDef[] = [
          {
            name: 'switch technique',
            description:
              'Switch the active technique (XRD / XPS / Raman / FTIR / Curve).',
            argsSchema: [
              {
                name: 'name',
                type: 'string',
                required: true,
                choices: [...ALL_TECHNIQUES] as readonly string[],
                description: 'Target technique',
              },
            ],
            execute: (_c, args) => {
              const raw = args.name
              handleSwitchCommand(typeof raw === 'string' ? raw : String(raw))
            },
          },
          {
            name: 'snapshot',
            description: snapshotBase
              ? snapshotBase.description
              : 'Save a snapshot of the current technique analysis.',
            execute: async (cmdCtx: CommandContext, args) => {
              if (snapshotBase) {
                await snapshotBase.execute(cmdCtx, args)
              } else {
                toast.warn('Snapshot not available for this technique yet.')
              }
            },
          },
        ]
        return [...baseWithoutSnapshot, ...extras]
      },
    }),
    [techniqueModule, handleSwitchCommand],
  )

  // Indicator dots on the switcher — segments with any existing work on
  // their sub-state flash a dot so users can tell at a glance which
  // lenses they've already touched. FTIR shares Raman's sub-state so
  // their hint mirrors.
  const switcherHints = useMemo<Partial<Record<SpectrumTechnique, boolean>>>(
    () => ({
      xrd: (normalized.unified.xrd?.peaks?.length ?? 0) > 0,
      xps:
        (normalized.unified.xps?.detectedPeaks?.length ?? 0) > 0 ||
        (normalized.unified.xps?.peakDefinitions?.length ?? 0) > 0,
    }),
    [normalized.unified],
  )

  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const handleLoadSpectrum = useCallback(
    async (file: File) => {
      if (!canParseLocally(file.name)) {
        toast.error(`Unsupported format: ${file.name}`)
        return
      }
      try {
        const parsed = needsBinaryRead(file.name)
          ? await parseSpectrumBinary(await file.arrayBuffer(), file.name)
          : await parseSpectrumText(await file.text(), file.name)
        if (!parsed || parsed.x.length === 0) {
          toast.error('Could not parse spectrum — check the file format')
          return
        }
        const spectrum: ProWorkbenchSpectrum = {
          x: parsed.x,
          y: parsed.y,
          xLabel: parsed.xLabel,
          yLabel: parsed.yLabel,
          spectrumType: parsed.technique,
          sourceFile: file.name,
        }
        normalized.patchShared({ spectrum })
        toast.success(`Loaded ${file.name} · ${parsed.x.length} points`)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Parse error')
      }
    },
    [normalized],
  )

  const loadButton = (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,.tsv,.xy,.dat,.txt,.chi,.uxd,.xrdml,.jdx,.dx,.vms,.vamas,.npl,.gsa,.fxye,.cpi,.rruf,.udf,.raw,.spc,.wdf,.spe,.spa,.sp,.rd,.sd,.cha"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void handleLoadSpectrum(file)
          e.target.value = ''
        }}
      />
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        className="pro-ribbon-load-btn"
        title="Load spectrum file"
      >
        <Upload size={13} strokeWidth={1.75} />
        <span>Load</span>
      </button>
    </>
  )

  return (
    <TechniqueWorkbenchUI
      key={resolvedTechnique}
      module={decoratedModule}
      ctx={ctx}
      registryKind={registryKind}
      kindLabel={moduleLabel(resolvedTechnique)}
      title={title}
      ribbonRightExtra={loadButton}
      ribbonLeftSlot={
        <ProTechniqueSwitcher
          active={resolvedTechnique}
          available={normalized.availableTechniques}
          onChange={onSwitchTechnique}
          hints={switcherHints}
          disabled={normalized.isLegacy}
        />
      }
    />
  )
}
