import type { PaperArtifactPayload } from '../stores/demo-library'
import { genArtifactId } from '../stores/runtime-store'
import type { Artifact } from '../types/artifact'

interface LocalPaperArtifactArgs {
  title: string
  sourceArtifactId: string
  reference?: string
  authors?: string[]
  year?: number
  venue?: string
  abstract?: string
  note?: string
}

interface MaterialPropertySummary {
  label: string
  value: number | null
  unit?: string
  higherIsBetter?: boolean
}

interface MaterialBriefArtifactArgs {
  name: string
  formula: string
  sourceArtifactId: string
  properties: MaterialPropertySummary[]
  paperRef?: string
  discoveryYear?: number
}

export function buildLocalPaperArtifact({
  title,
  sourceArtifactId,
  reference,
  authors,
  year,
  venue,
  abstract,
  note,
}: LocalPaperArtifactArgs): Artifact {
  const now = Date.now()
  const metadataYear = year ?? new Date(now).getFullYear()
  const payload: PaperArtifactPayload = {
    paperId: `local_${slugify(title)}_${now.toString(36)}`,
    metadata: {
      title,
      authors: authors && authors.length > 0 ? authors : ['Unknown'],
      year: metadataYear,
      venue: venue ?? 'Local Reference',
      doi: referenceAsDoi(reference),
      abstract:
        abstract ??
        `Local reference note created from "${title}" while backend paper lookup is not yet wired.`,
    },
    annotations: [
      {
        id: `ann_${now.toString(36)}`,
        page: 1,
        note:
          note ??
          `Created from source artifact ${sourceArtifactId}${reference ? ` using reference ${reference}.` : '.'}`,
        createdAt: now,
      },
    ],
    extractions: [
      ...(reference ? [{ key: 'reference', value: reference }] : []),
      { key: 'source_artifact', value: sourceArtifactId },
    ],
  }

  return {
    id: genArtifactId(),
    kind: 'paper',
    title,
    createdAt: now,
    updatedAt: now,
    parents: [sourceArtifactId],
    payload: payload as never,
  } as Artifact
}

export function buildMaterialBriefArtifact({
  name,
  formula,
  sourceArtifactId,
  properties,
  paperRef,
  discoveryYear,
}: MaterialBriefArtifactArgs): Artifact {
  const now = Date.now()
  const currentYear = new Date(now).getFullYear()
  const citationId = paperRef ? `mat_ref_${slugify(formula)}` : null
  const citations = paperRef
    ? [
        {
          id: citationId ?? 'mat_ref',
          title: `${name} seed reference`,
          authors: ['Unknown'],
          year: discoveryYear ?? currentYear,
          venue: 'Local comparison reference',
          doi: referenceAsDoi(paperRef),
          url: looksLikeUrl(paperRef) ? paperRef : undefined,
        },
      ]
    : []

  const sections = [
    {
      id: 'snapshot',
      heading: '1. Snapshot',
      level: 1 as const,
      markdown: [
        `**Material**: ${name}`,
        `**Formula**: ${formula}`,
        `**Discovery year**: ${discoveryYear ?? 'Not provided'}`,
        paperRef
          ? `**Seed reference**: ${paperRef}${citationId ? ` [@cite:${citationId}]` : ''}`
          : '**Seed reference**: Not provided',
      ].join('\n'),
      citationIds: citationId ? [citationId] : [],
    },
    {
      id: 'properties',
      heading: '2. Property Summary',
      level: 1 as const,
      markdown:
        properties.length > 0
          ? properties.map((property) => `- ${formatProperty(property)}`).join('\n')
          : 'No property values were attached to this comparison row.',
      citationIds: [],
    },
    {
      id: 'follow-up',
      heading: '3. Suggested Follow-up',
      level: 1 as const,
      markdown: [
        '- Compare this material against the highest-performing neighbors in the same table.',
        '- Cross-check any standout metrics against the linked literature before promoting it.',
        '- Open or generate a structure artifact if this composition moves into a design shortlist.',
      ].join('\n'),
      citationIds: [],
    },
  ]

  return {
    id: genArtifactId(),
    kind: 'research-report',
    title: `Material Brief - ${formula}`,
    createdAt: now,
    updatedAt: now,
    parents: [sourceArtifactId],
    payload: {
      topic: `${name} material brief`,
      mode: 'survey',
      style: 'concise',
      sections,
      citations,
      generatedAt: now,
    } as never,
  } as Artifact
}

function formatProperty({
  label,
  value,
  unit,
  higherIsBetter,
}: MaterialPropertySummary): string {
  const valueLabel = value == null ? 'missing' : `${formatNumber(value)}${unit ? ` ${unit}` : ''}`
  const direction =
    higherIsBetter === true
      ? 'higher is better'
      : higherIsBetter === false
        ? 'lower is better'
        : null
  return direction ? `${label}: ${valueLabel} (${direction})` : `${label}: ${valueLabel}`
}

function formatNumber(value: number): string {
  if (Number.isInteger(value)) return String(value)
  if (Math.abs(value) >= 100) return value.toFixed(1)
  if (Math.abs(value) >= 10) return value.toFixed(2)
  return value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
}

function referenceAsDoi(reference?: string): string | undefined {
  if (!reference) return undefined
  const trimmed = reference.trim()
  return /^10\.\d{4,9}\/\S+$/i.test(trimmed) ? trimmed : undefined
}

function looksLikeUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim())
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return slug || 'artifact'
}
