// Shared renderer for any TechniqueModule. Owns the ProWorkbenchShell +
// ProRibbon + ProCommandPalette + command registration lifecycle so the
// legacy per-kind shims (XrdProWorkbench.tsx, XpsProWorkbench.tsx, …) and
// the Phase-3 UnifiedProWorkbench don't each re-implement the same 30
// lines of plumbing.
//
// This component is a thin composition layer — it calls the module's
// hooks / builders, wires the results into the shell, and surfaces a
// small `ribbonLeftSlot` prop so UnifiedProWorkbench can inject its
// technique switcher without this layer knowing anything about it.

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import ProWorkbenchShell from '../ProWorkbenchShell'
import ProRibbon from '../ProRibbon'
import ProDataTabs, { type ProDataTabDef } from '../ProDataTabs'
import ProCommandPalette, {
  useProCommandPaletteHotkey,
} from '../ProCommandPalette'
import {
  registerWorkbench,
  unregisterWorkbench,
  type ProWorkbenchKind,
} from '../commandRegistry'
import {
  genArtifactId,
  useRuntimeStore,
} from '../../../../../stores/runtime-store'
import { pickJsonFile, readSnapshotFile } from '../../../../../lib/pro-export'
import { toast } from '../../../../../stores/toast-store'
import type { Artifact } from '../../../../../types/artifact'
import type { ModuleCtx, TechniqueModule } from './types'

interface Props<Sub, Actions> {
  module: TechniqueModule<Sub, Actions>
  ctx: ModuleCtx<Sub>
  /** Registered as the workbench `kind` in the command registry. Typically
   *  the artifact's `kind` (`xrd-pro` etc.) — UnifiedProWorkbench passes
   *  `'spectrum-pro'` here so global commands resolve there. */
  registryKind: ProWorkbenchKind
  /** Ribbon kind label, e.g. `"XRD"`. UnifiedProWorkbench may replace this
   *  with its live technique label. */
  kindLabel: string
  /** Document title in the ribbon. Usually `payload.spectrum?.sourceFile`. */
  title: string
  /** Optional ReactNode slotted at the ribbon's left (before the kind
   *  label) — UnifiedProWorkbench uses it for the technique switcher. */
  ribbonLeftSlot?: ReactNode
  /** Extra content appended to the ribbon's right side, after whatever
   *  the module provides via `renderRibbonRight`. */
  ribbonRightExtra?: ReactNode
}

export default function TechniqueWorkbenchUI<Sub, Actions>({
  module,
  ctx,
  registryKind,
  kindLabel,
  title,
  ribbonLeftSlot,
  ribbonRightExtra,
}: Props<Sub, Actions>) {
  const [paletteOpen, setPaletteOpen] = useState(false)
  const focusedArtifactId = useRuntimeStore(
    (s) => s.sessions[ctx.sessionId]?.focusedArtifactId ?? null,
  )

  const actions = module.useActions(ctx)

  const overlays = useMemo(
    () => module.buildOverlays(ctx),
    // Payload identity drives overlay rebuild; module is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [module, ctx.payload, ctx.sub],
  )

  const dataTabs = useMemo(
    () => module.buildDataTabs(ctx, actions),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [module, ctx.payload, ctx.sub, actions],
  )

  const mainViz = module.renderMainViz(ctx, actions)
  const inspector = module.renderInspector(ctx, actions)
  const footer = module.renderFooter(ctx, actions)
  const moduleRight = module.renderRibbonRight?.(ctx, actions) ?? null
  const ribbonRight = moduleRight || ribbonRightExtra
    ? <>{moduleRight}{ribbonRightExtra}</>
    : null

  // Run history rail — duck-typed: any sub-state / actions shape is
  // welcome to participate. A module that doesn't track runHistory (or
  // hasn't wired a restore handler yet) gets the empty-state render for
  // free and no restore button.
  // Register commands for this artifact id. Re-runs whenever the module,
  // ctx, or derived actions change so command closures stay fresh.
  // A cross-module "import snapshot" entry is appended here so every
  // Pro-workbench palette picks it up without each module re-declaring.
  useEffect(() => {
    const commands = module.commands(ctx, actions)
    const importCommand = {
      name: 'import pro snapshot',
      description: 'Restore a Pro workbench from a .json snapshot file.',
      technique: ['xrd', 'xps', 'raman', 'ftir', 'curve'] as const,
      execute: async () => {
        try {
          const file = await pickJsonFile()
          if (!file) return
          const doc = await readSnapshotFile(file)
          const sessionId = ctx.sessionId
          const newArtifact = {
            id: genArtifactId(),
            kind: doc.artifact.kind,
            title: doc.artifact.title ?? doc.artifact.kind,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            payload: doc.artifact.payload,
          } as Artifact
          useRuntimeStore.getState().upsertArtifact(sessionId, newArtifact)
          useRuntimeStore.getState().focusArtifact(sessionId, newArtifact.id)
          toast.success(`Imported ${doc.artifact.kind} snapshot`)
        } catch (err) {
          toast.error(err instanceof Error ? err.message : String(err))
        }
      },
    }
    registerWorkbench(ctx.artifact.id, {
      kind: registryKind,
      artifact: ctx.artifact,
      sessionId: ctx.sessionId,
      handlers: {},
      commands: [...commands, importCommand],
    })
    return () => unregisterWorkbench(ctx.artifact.id)
  }, [module, ctx, actions, registryKind])

  useProCommandPaletteHotkey({
    artifactId: ctx.artifact.id,
    focusedArtifactId,
    onOpen: () => setPaletteOpen(true),
  })

  return (
    <div style={S.root} className="technique-workbench-ui-root">
      <ProWorkbenchShell
        topRibbon={
          <ProRibbon
            kindLabel={kindLabel}
            title={title}
            onOpenCommandPalette={() => setPaletteOpen(true)}
            leftSlot={ribbonLeftSlot}
            right={ribbonRight}
          />
        }
        mainViz={mainViz}
        dataTabs={<DataTabsHost tabs={dataTabs} />}
        inspector={inspector}
        footer={footer}
      />
      <ProCommandPalette
        artifactId={ctx.artifact.id}
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
      />
    </div>
  )
}

// ─── Data-tabs host ────────────────────────────────────────────────
// Lightweight wrapper that owns which tab id is active. Separate from the
// module so the module can be a bag of tab definitions without having to
// manage UI state.

function DataTabsHost({ tabs }: { tabs: ProDataTabDef[] }) {
  const [activeId, setActiveId] = useState<string>(tabs[0]?.id ?? '')
  // If the active tab id disappears (module returned a different set),
  // fall back to the first tab.
  const safeId = tabs.find((t) => t.id === activeId)?.id ?? tabs[0]?.id ?? ''
  return (
    <ProDataTabs tabs={tabs} activeId={safeId} onChange={setActiveId} />
  )
}

const S = {
  root: {
    flex: 1,
    height: '100%',
    minHeight: 0,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column' as const,
    overflow: 'hidden',
    position: 'relative' as const,
  },
}
