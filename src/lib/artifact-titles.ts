import type { Artifact, ArtifactKind } from '../types/artifact'
import { sanitizePaperTitle } from './paper-metadata'

const KIND_DISPLAY_LABEL: Readonly<Partial<Record<ArtifactKind, string>>> = {
  spectrum: 'Spectrum',
  'peak-fit': 'Peak Fit',
  'xrd-analysis': 'XRD',
  'xps-analysis': 'XPS',
  'raman-id': 'Raman',
  structure: 'Structure',
  compute: 'Compute',
  job: 'Job',
  'research-report': 'Report',
  batch: 'Batch',
  'material-comparison': 'Compare',
  paper: 'Paper',
  'similarity-matrix': 'Similarity',
  optimization: 'Optim',
  hypothesis: 'Hypothesis',
  'xrd-pro': 'XRD Lab',
  'xps-pro': 'XPS Lab',
  'raman-pro': 'Raman Lab',
  'curve-pro': 'Curve Lab',
  'curve-analysis': 'Curve',
  'spectrum-pro': 'Spectrum Lab',
  'compute-pro': 'Compute Lab',
}

export function getArtifactDisplayTitle(
  artifactOrKind: Artifact | ArtifactKind,
  rawTitle?: string,
): string {
  const kind =
    typeof artifactOrKind === 'string' ? artifactOrKind : artifactOrKind.kind
  const title =
    typeof artifactOrKind === 'string' ? rawTitle ?? '' : artifactOrKind.title

  return normalizeArtifactTitle(kind, title)
}

function normalizeArtifactTitle(kind: ArtifactKind, title: string): string {
  const trimmed = title.trim()
  if (!trimmed) return title

  let next = trimmed
  const kindLabel = KIND_DISPLAY_LABEL[kind]
  if (kindLabel) {
    const escaped = escapeRegExp(kindLabel)
    next = next.replace(new RegExp(`^${escaped}\\s*[:\\-—]\\s*`, 'i'), '')
  }

  if (kind === 'structure') {
    next = next.replace(/^Structure Scaffold\s*[—-]\s*/i, '')
  }

  if (kind === 'paper') {
    next = sanitizePaperTitle(next)
  }

  return next.trim() || trimmed
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
