import type {
  Artifact,
  LatexDocumentArtifact,
} from '../../../../types/artifact'
import type { PreviewBlocks } from '../preview-registry'
import PlotInlinePreview from './PlotInlinePreview'
import ResearchReportInlinePreview from './ResearchReportInlinePreview'

type Meta = { label: string; value: string }

function m(label: string, value: string | number | null | undefined): Meta | null {
  if (value == null || value === '') return null
  return { label, value: String(value) }
}

function fmtNum(n: number, digits = 2): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(digits)
}

export function getArtifactPreview(artifact: Artifact): PreviewBlocks {
  switch (artifact.kind) {
    case 'latex-document':
      return renderLatexPreview(artifact as LatexDocumentArtifact)
    case 'xrd-pro':
    case 'xps-pro':
    case 'raman-pro':
    case 'spectrum-pro':
    case 'curve-pro':
      return renderProPreview(artifact)
    case 'xrd-analysis':
      return renderXrdAnalysisPreview(artifact)
    case 'xps-analysis':
      return renderXpsAnalysisPreview(artifact)
    case 'raman-id':
      return renderRamanIdPreview(artifact)
    case 'compute':
    case 'compute-pro':
      return renderComputePreview(artifact)
    case 'compute-experiment':
      return renderComputeExperimentPreview(artifact)
    case 'structure':
      return renderStructurePreview(artifact)
    case 'paper':
      return renderPaperPreview(artifact)
    case 'peak-fit':
      return renderPeakFitPreview(artifact)
    case 'spectrum':
      return renderSpectrumPreview(artifact)
    case 'research-report':
      return renderResearchReportPreview(artifact)
    case 'plot':
      return renderPlotPreview(artifact)
    default:
      return {}
  }
}

function renderLatexPreview(a: LatexDocumentArtifact): PreviewBlocks {
  const files = a.payload.files ?? []
  const chars = files.reduce((n, f) => n + f.content.length, 0)
  return {
    oneLiner: `${files.length} file${files.length === 1 ? '' : 's'} · ${(chars / 1000).toFixed(1)}k chars`,
    meta: [
      m('Files', files.length),
      m('Characters', `${(chars / 1000).toFixed(1)}k`),
      m('Main', files[0]?.path),
    ].filter((x): x is Meta => x != null),
  }
}

function renderProPreview(artifact: Artifact): PreviewBlocks {
  const payload = artifact.payload as {
    peaks?: unknown[]
    detectedPeaks?: unknown[]
    technique?: string
    xRange?: [number, number]
  }
  const peakCount = Array.isArray(payload.peaks)
    ? payload.peaks.length
    : Array.isArray(payload.detectedPeaks)
      ? payload.detectedPeaks.length
      : 0
  const technique = payload.technique
  const parts: string[] = []
  if (technique) parts.push(String(technique).toUpperCase())
  parts.push(`${peakCount} peak${peakCount === 1 ? '' : 's'}`)
  return {
    oneLiner: parts.join(' · '),
    meta: [
      m('Technique', technique?.toUpperCase()),
      m('Peaks', peakCount),
      payload.xRange
        ? m('Range', `${fmtNum(payload.xRange[0])}–${fmtNum(payload.xRange[1])}`)
        : null,
    ].filter((x): x is Meta => x != null),
  }
}

function renderXrdAnalysisPreview(artifact: Artifact): PreviewBlocks {
  const payload = artifact.payload as {
    phases?: Array<{ name?: string; confidence?: number }>
    wavelength?: number
  }
  const phases = payload.phases ?? []
  const top3 = phases.slice(0, 3)
  return {
    oneLiner: `${phases.length} phase${phases.length === 1 ? '' : 's'}`,
    meta: [
      m('Phases', phases.length),
      m('Top match', phases[0]?.name),
      phases[0]?.confidence != null
        ? m('Confidence', `${Math.round(phases[0].confidence * 100)}%`)
        : null,
      payload.wavelength ? m('λ', `${payload.wavelength} Å`) : null,
    ].filter((x): x is Meta => x != null),
    compact:
      top3.length > 0 ? (
        <ul className="agent-card-list">
          {top3.map((p, i) => (
            <li key={i}>
              <span className="agent-card-row-main">{p.name ?? '—'}</span>
              <span className="agent-card-row-meta">
                {p.confidence != null
                  ? `${Math.round(p.confidence * 100)}%`
                  : ''}
              </span>
            </li>
          ))}
        </ul>
      ) : undefined,
  }
}

function renderXpsAnalysisPreview(artifact: Artifact): PreviewBlocks {
  const payload = artifact.payload as {
    fits?: Array<{ element?: string; components?: unknown[] }>
    passEnergy?: number
  }
  const fits = payload.fits ?? []
  const elements = fits.map((f) => f.element).filter(Boolean) as string[]
  const totalComponents = fits.reduce(
    (n, f) => n + (Array.isArray(f.components) ? f.components.length : 0),
    0,
  )
  return {
    oneLiner: elements.length > 0 ? elements.join(' / ') : `${fits.length} fits`,
    meta: [
      m('Elements', elements.join(', ') || `${fits.length} fits`),
      m('Components', totalComponents || null),
      payload.passEnergy ? m('Pass energy', `${payload.passEnergy} eV`) : null,
    ].filter((x): x is Meta => x != null),
  }
}

function renderRamanIdPreview(artifact: Artifact): PreviewBlocks {
  const payload = artifact.payload as {
    matches?: Array<{ name?: string; score?: number }>
    laserWavelength?: number
  }
  const matches = payload.matches ?? []
  const top = matches[0]
  return {
    oneLiner: top
      ? `top: ${top.name ?? '—'}${top.score != null ? ` (${Math.round(top.score * 100)}%)` : ''}`
      : undefined,
    meta: [
      m('Top match', top?.name),
      top?.score != null ? m('Score', `${Math.round(top.score * 100)}%`) : null,
      m('Candidates', matches.length || null),
      payload.laserWavelength ? m('Laser', `${payload.laserWavelength} nm`) : null,
    ].filter((x): x is Meta => x != null),
  }
}


function renderComputeExperimentPreview(artifact: Artifact): PreviewBlocks {
  const payload = artifact.payload as {
    status?: string
    points?: Array<{ status?: string }>
    result?: { metrics?: Record<string, unknown>; warnings?: string[] }
  }
  const points = Array.isArray(payload.points) ? payload.points : []
  const done = points.filter((point) => point.status === 'succeeded').length
  const b = payload.result?.metrics?.bulk_modulus_gpa
  const parts = [payload.status ?? 'draft', `${done}/${points.length} points`]
  if (typeof b === 'number') parts.push(`${b.toFixed(2)} GPa`)
  return {
    oneLiner: parts.join(' · '),
    meta: [
      m('Status', payload.status),
      m('Points', `${done}/${points.length}`),
      m('Bulk modulus', typeof b === 'number' ? `${b.toFixed(2)} GPa` : null),
      m('Warnings', payload.result?.warnings?.length ?? null),
    ].filter((x): x is Meta => x != null),
  }
}

function renderComputePreview(artifact: Artifact): PreviewBlocks {
  const payload = artifact.payload as {
    code?: string
    status?: string
    language?: string
  }
  const lines = (payload.code ?? '').split('\n').length
  const firstLine = (payload.code ?? '').split('\n')[0]?.trim() ?? ''
  const trimmed = firstLine.length > 60 ? `${firstLine.slice(0, 59)}…` : firstLine
  return {
    oneLiner: [payload.language, payload.status]
      .filter(Boolean)
      .join(' · '),
    meta: [
      m('Language', payload.language),
      m('Status', payload.status),
      payload.code ? m('Lines', lines) : null,
    ].filter((x): x is Meta => x != null),
    compact: trimmed ? (
      <code className="agent-card-code">{trimmed}</code>
    ) : undefined,
  }
}

function renderStructurePreview(artifact: Artifact): PreviewBlocks {
  const payload = artifact.payload as {
    formula?: string
    cellVolume?: number
    spaceGroup?: string
    latticeParams?: { a?: number; b?: number; c?: number; alpha?: number; beta?: number; gamma?: number }
    sites?: unknown[]
    crystalSystem?: string
  }
  const parts: string[] = []
  if (payload.formula) parts.push(payload.formula)
  if (payload.spaceGroup) parts.push(payload.spaceGroup)
  if (payload.cellVolume)
    parts.push(`${payload.cellVolume.toFixed(2)} Å³`)
  const lp = payload.latticeParams
  return {
    oneLiner: parts.join(' · '),
    meta: [
      m('Formula', payload.formula),
      m('Space group', payload.spaceGroup),
      m('Crystal system', payload.crystalSystem),
      payload.cellVolume ? m('Volume', `${fmtNum(payload.cellVolume)} ų`) : null,
      lp?.a != null ? m('a, b, c', `${fmtNum(lp.a)}, ${fmtNum(lp.b ?? lp.a)}, ${fmtNum(lp.c ?? lp.a)} Å`) : null,
      Array.isArray(payload.sites) ? m('Sites', payload.sites.length) : null,
    ].filter((x): x is Meta => x != null),
  }
}

function renderPaperPreview(artifact: Artifact): PreviewBlocks {
  const payload = artifact.payload as {
    authors?: string[]
    year?: number
    venue?: string
    doi?: string
    abstract?: string
  }
  const first = payload.authors?.[0]
  const rest = (payload.authors?.length ?? 0) > 1 ? ' et al.' : ''
  const author = first ? `${first}${rest}` : ''
  const parts = [author, payload.year?.toString(), payload.venue].filter(Boolean)
  return {
    oneLiner: parts.join(' · '),
    meta: [
      m('Authors', author),
      m('Year', payload.year),
      m('Venue', payload.venue),
      m('DOI', payload.doi),
    ].filter((x): x is Meta => x != null),
  }
}

function renderPeakFitPreview(artifact: Artifact): PreviewBlocks {
  const payload = artifact.payload as {
    algorithm?: string
    peaks?: Array<{ position?: number; fwhm?: number; area?: number }>
    residual?: number
  }
  const peaks = payload.peaks ?? []
  return {
    oneLiner: `${payload.algorithm ?? 'fit'} · ${peaks.length} peaks`,
    meta: [
      m('Algorithm', payload.algorithm),
      m('Peaks', peaks.length),
      payload.residual != null ? m('Residual', fmtNum(payload.residual, 4)) : null,
      peaks[0]?.position != null ? m('Strongest', `${fmtNum(peaks[0].position)}`) : null,
    ].filter((x): x is Meta => x != null),
  }
}

function renderSpectrumPreview(artifact: Artifact): PreviewBlocks {
  const payload = artifact.payload as {
    spectrumType?: string | null
    x?: number[]
    y?: number[]
    xLabel?: string
    yLabel?: string
  }
  const pts = payload.x?.length ?? 0
  const xMin = payload.x?.[0]
  const xMax = payload.x?.[pts - 1]
  return {
    oneLiner: [
      payload.spectrumType ?? undefined,
      pts ? `${pts} pts` : undefined,
    ]
      .filter(Boolean)
      .join(' · '),
    meta: [
      m('Type', payload.spectrumType),
      m('Points', pts || null),
      xMin != null && xMax != null
        ? m('Range', `${fmtNum(xMin)}–${fmtNum(xMax)}${payload.xLabel ? ` ${payload.xLabel}` : ''}`)
        : null,
      m('X axis', payload.xLabel),
      m('Y axis', payload.yLabel),
    ].filter((x): x is Meta => x != null),
  }
}

function renderResearchReportPreview(artifact: Artifact): PreviewBlocks {
  const payload = artifact.payload as {
    status?: string
    sections?: unknown[]
    citations?: unknown[]
    topic?: string
    style?: string
  }
  const status = payload.status ?? 'complete'
  const sCount = payload.sections?.length ?? 0
  const cCount = payload.citations?.length ?? 0
  return {
    oneLiner: `${status === 'complete' ? 'Complete' : status === 'drafting' ? 'Drafting' : 'Planning'} · ${sCount} sections · ${cCount} refs`,
    meta: [
      m('Status', status === 'complete' ? 'Complete' : status === 'drafting' ? 'Drafting' : 'Planning'),
      m('Sections', sCount),
      m('References', cCount),
      m('Style', payload.style),
    ].filter((x): x is Meta => x != null),
    compact: <ResearchReportInlinePreview artifact={artifact} />,
  }
}

function renderPlotPreview(artifact: Artifact): PreviewBlocks {
  const payload = artifact.payload as {
    mode?: string
    series?: Array<{ name?: string; data?: unknown[] }>
    peaks?: unknown[]
    xLabel?: string
    yLabel?: string
  }
  const series = Array.isArray(payload.series) ? payload.series : []
  const peakCount = Array.isArray(payload.peaks) ? payload.peaks.length : 0
  const parts = [`${series.length} series`]
  if (peakCount > 0) parts.push(`${peakCount} peaks`)
  return {
    oneLiner: parts.join(' · '),
    meta: [
      m('Series', series.map((s) => s.name).filter(Boolean).join(', ') || String(series.length)),
      peakCount > 0 ? m('Peaks', peakCount) : null,
      m('X axis', payload.xLabel),
      m('Y axis', payload.yLabel),
    ].filter((x): x is Meta => x != null),
    compact: <PlotInlinePreview artifact={artifact} />,
  }
}
