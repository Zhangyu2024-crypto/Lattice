// SpectrumProWindowStub — canvas placeholder for Spectrum Pro-family
// artifacts that live in their own BrowserWindow.
//
// Replaces the old `SpectrumProLauncherCard` mini-chart launcher. The
// satellite window is the one true UI for XRD / XPS / Raman / FTIR /
// Curve / Spectrum-Pro artifacts; this stub exists solely so the main
// canvas can still surface *which* artifact is focused when the user
// has closed the window (or opened a second workbench). Clicking
// "Open window" re-spawns the satellite — Electron focuses an existing
// window with the same hash, so the user doesn't get duplicates.
//
// Web (non-Electron) fallback: the window flow isn't available without
// `window.electronAPI`, so we render the full `UnifiedProWorkbench`
// inline. The stub itself never shows in web mode.

import { lazy, Suspense, useCallback } from 'react'
import { ExternalLink } from 'lucide-react'
import {
  flushRuntimePersist,
  useRuntimeStore,
} from '@/stores/runtime-store'
import type {
  Artifact,
  SpectrumProPayload,
  SpectrumTechnique,
} from '@/types/artifact'
import {
  isCurveProArtifact,
  isRamanProArtifact,
  isSpectrumProArtifact,
  isXpsProArtifact,
  isXrdProArtifact,
} from '@/types/artifact'
import { toast } from '@/stores/toast-store'
import { ProButton } from '@/components/common/pro'

const UnifiedProWorkbench = lazy(() => import('./UnifiedProWorkbench'))

interface Props {
  artifact: Artifact
  sessionId: string
}

const BADGE_LABELS: Record<SpectrumTechnique, string> = {
  xrd: 'XRD',
  xps: 'XPS',
  raman: 'Raman',
  ftir: 'FTIR',
  curve: 'Curve',
}

function resolveTechnique(artifact: Artifact): SpectrumTechnique | null {
  if (isXrdProArtifact(artifact)) return 'xrd'
  if (isXpsProArtifact(artifact)) return 'xps'
  if (isRamanProArtifact(artifact))
    return artifact.payload.params.mode === 'ftir' ? 'ftir' : 'raman'
  if (isCurveProArtifact(artifact)) return 'curve'
  if (isSpectrumProArtifact(artifact)) return artifact.payload.technique ?? 'xrd'
  return null
}

function extractSpectrum(
  artifact: Artifact,
): SpectrumProPayload['spectrum'] | null {
  if (isSpectrumProArtifact(artifact)) return artifact.payload.spectrum
  if (isXrdProArtifact(artifact)) return artifact.payload.spectrum
  if (isXpsProArtifact(artifact)) return artifact.payload.spectrum
  if (isRamanProArtifact(artifact)) return artifact.payload.spectrum
  if (isCurveProArtifact(artifact)) return artifact.payload.spectrum
  return null
}

function hasWorkbenchWindowApi(): boolean {
  return (
    typeof window !== 'undefined' &&
    Boolean(window.electronAPI?.openWorkbenchWindow)
  )
}

export default function SpectrumProWindowStub({ artifact, sessionId }: Props) {
  const technique = resolveTechnique(artifact)
  const removeArtifact = useRuntimeStore((s) => s.removeArtifact)

  const handleOpen = useCallback(() => {
    const api = window.electronAPI
    if (!api?.openWorkbenchWindow) return
    // Flush persist before spawning the window — the satellite hydrates
    // from localStorage synchronously and the debounced wrapper would
    // otherwise leave it 300 ms stale.
    flushRuntimePersist()
    void api.openWorkbenchWindow({ sessionId, artifactId: artifact.id })
  }, [sessionId, artifact.id])

  const handleRemove = useCallback(() => {
    if (!window.confirm('Remove this workbench from the session?')) return
    removeArtifact(sessionId, artifact.id)
    toast.info('Workbench removed')
  }, [removeArtifact, sessionId, artifact.id])

  // Web-mode fallback: without the Electron bridge we can't spawn a
  // window, so the full workbench renders in-canvas instead. Lazy so
  // the main bundle doesn't pull in the whole Pro surface when the
  // Electron path is the common case.
  if (!hasWorkbenchWindowApi()) {
    return (
      <Suspense fallback={<div className="spectrum-pro-stub-fallback">Loading workbench…</div>}>
        <UnifiedProWorkbench artifact={artifact} sessionId={sessionId} />
      </Suspense>
    )
  }

  if (!technique) {
    return (
      <div className="spectrum-pro-stub-root">
        <p className="spectrum-pro-stub-body">
          Unknown workbench kind <code>{artifact.kind}</code>.
        </p>
      </div>
    )
  }

  const spectrum = extractSpectrum(artifact)
  const fileName = spectrum?.sourceFile ?? '(no spectrum loaded)'

  return (
    <div className="spectrum-pro-stub-root">
      <div className="spectrum-pro-stub-header">
        <span className="spectrum-pro-stub-badge">
          {BADGE_LABELS[technique]}
        </span>
        <span className="spectrum-pro-stub-file" title={fileName}>
          {fileName}
        </span>
      </div>
      <p className="spectrum-pro-stub-body">
        This workbench runs in its own window. Close the window to return
        here; re-open to continue editing.
      </p>
      <div className="spectrum-pro-stub-actions">
        <ProButton variant="primary" onClick={handleOpen}>
          <ExternalLink size={12} /> Open window
        </ProButton>
        <ProButton onClick={handleRemove}>Remove from session</ProButton>
      </div>
    </div>
  )
}
