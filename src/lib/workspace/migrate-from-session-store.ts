import type { IWorkspaceFs } from '@/lib/workspace/fs/IWorkspaceFs'
import type { LatticeFileKind } from '@/lib/workspace/fs/types'
import { writeEnvelope } from '@/lib/workspace/envelope'
import type { Artifact, ArtifactKind } from '@/types/artifact'
import type { Session, TranscriptMessage } from '@/types/session'

export interface MigrationReport {
  migratedSessions: number
  migratedArtifacts: number
  migratedTranscripts: number
  errors: Array<{ sessionId: string; stage: string; message: string }>
  archivePath: string
}

const ARCHIVE_PATH = '.lattice/legacy-session-store.json'
const MIGRATED_ROOT = 'migrated'

interface ArtifactFileMapping {
  extension: string
  kind: LatticeFileKind
}

// Kinds whose extension is declared in `file-kind.ts`. Anything not listed
// here falls back to a generic `.json` envelope with kind=`unknown`.
const ARTIFACT_FILE_MAP: Partial<Record<ArtifactKind, ArtifactFileMapping>> = {
  spectrum: { extension: '.spectrum.json', kind: 'spectrum' },
  'peak-fit': { extension: '.peakfit.json', kind: 'peakfit' },
  'xrd-analysis': { extension: '.xrd.json', kind: 'xrd' },
  'xps-analysis': { extension: '.xps.json', kind: 'xps' },
  'raman-id': { extension: '.raman.json', kind: 'raman' },
  'curve-analysis': { extension: '.curve.json', kind: 'curve' },
  'xrd-pro': { extension: '.workbench.json', kind: 'workbench' },
  'xps-pro': { extension: '.workbench.json', kind: 'workbench' },
  'raman-pro': { extension: '.workbench.json', kind: 'workbench' },
  'curve-pro': { extension: '.workbench.json', kind: 'workbench' },
  'spectrum-pro': { extension: '.workbench.json', kind: 'workbench' },
  'compute-pro': { extension: '.workbench.json', kind: 'workbench' },
  job: { extension: '.job.json', kind: 'job' },
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function tryParse(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

// Zustand's `persist` middleware wraps state as `{ state: {...}, version }`,
// so we probe both that shape and a flat `{ sessions, sessionOrder }` shape.
function extractSessions(parsed: unknown): Record<string, Session> | null {
  if (!isPlainObject(parsed)) return null
  const direct = parsed['sessions']
  if (isPlainObject(direct)) return direct as Record<string, Session>
  const inner = parsed['state']
  if (isPlainObject(inner) && isPlainObject(inner['sessions'])) {
    return inner['sessions'] as Record<string, Session>
  }
  return null
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function uniqueSlug(base: string, used: Set<string>): string {
  if (!used.has(base)) {
    used.add(base)
    return base
  }
  let counter = 2
  while (used.has(`${base}-${counter}`)) counter++
  const final = `${base}-${counter}`
  used.add(final)
  return final
}

function artifactExtension(kind: string): string {
  const mapping = ARTIFACT_FILE_MAP[kind as ArtifactKind]
  return mapping ? mapping.extension : '.json'
}

function artifactFileKind(kind: string): LatticeFileKind {
  const mapping = ARTIFACT_FILE_MAP[kind as ArtifactKind]
  return mapping ? mapping.kind : 'unknown'
}

function safeArtifactFileName(artifact: Artifact): string {
  const idFragment = slugify(artifact.id) || artifact.id || 'artifact'
  const ext = artifactExtension(artifact.kind)
  return `${artifact.kind}-${idFragment}${ext}`
}

function inferModel(session: Session): string | null {
  // The live `Session` type has no `model` field but older persisted shapes
  // sometimes do; probe both the root and the param snapshot before giving up.
  const asRecord = session as unknown as Record<string, unknown>
  const direct = asRecord['model']
  if (typeof direct === 'string') return direct
  const snapshot = session.paramSnapshot
  if (!isPlainObject(snapshot)) return null
  const candidate = snapshot['model']
  return typeof candidate === 'string' ? candidate : null
}

interface ChatPayload {
  messages: TranscriptMessage[]
  mode: Session['chatMode']
  model: string | null
  mentions: unknown[]
}

function buildChatPayload(session: Session): ChatPayload {
  return {
    messages: Array.isArray(session.transcript) ? session.transcript : [],
    mode: session.chatMode,
    model: inferModel(session),
    mentions: [],
  }
}

function buildSessionMetadata(session: Session): Record<string, unknown> {
  return {
    id: session.id,
    title: session.title,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    paramSnapshot: session.paramSnapshot ?? {},
    tasks: session.tasks ?? {},
    taskOrder: session.taskOrder ?? [],
    activeTaskId: session.activeTaskId ?? null,
    files: session.files ?? [],
  }
}

export async function migrateSessionStoreToWorkspace(
  fs: IWorkspaceFs,
  rawLocalStorage: string,
): Promise<MigrationReport> {
  const report: MigrationReport = {
    migratedSessions: 0,
    migratedArtifacts: 0,
    migratedTranscripts: 0,
    errors: [],
    archivePath: ARCHIVE_PATH,
  }

  if (!rawLocalStorage || typeof rawLocalStorage !== 'string') {
    return report
  }

  const parsed = tryParse(rawLocalStorage)
  if (parsed == null) return report

  const sessions = extractSessions(parsed)
  if (!sessions || Object.keys(sessions).length === 0) {
    // Still archive if the caller gave us anything parseable, so the original
    // payload is preserved even when it holds no migratable sessions.
    try {
      await fs.mkdir('.lattice')
      await fs.writeJson(ARCHIVE_PATH, parsed)
    } catch (err) {
      report.errors.push({
        sessionId: '',
        stage: 'archive',
        message: err instanceof Error ? err.message : String(err),
      })
    }
    return report
  }

  const usedSlugs = new Set<string>()

  for (const [sessionId, rawSession] of Object.entries(sessions)) {
    if (!isPlainObject(rawSession)) {
      report.errors.push({
        sessionId,
        stage: 'parse-session',
        message: 'Session entry is not an object',
      })
      continue
    }
    const session = rawSession as unknown as Session

    const title = typeof session.title === 'string' ? session.title : ''
    const baseSlug = slugify(title) || session.id || sessionId
    const slug = uniqueSlug(baseSlug, usedSlugs)
    const sessionDir = `${MIGRATED_ROOT}/${slug}`
    const artifactsDir = `${sessionDir}/artifacts`

    try {
      await fs.mkdir(sessionDir)
    } catch (err) {
      report.errors.push({
        sessionId,
        stage: 'mkdir-session',
        message: err instanceof Error ? err.message : String(err),
      })
      continue
    }

    try {
      const chatPayload = buildChatPayload(session)
      await writeEnvelope(fs, `${sessionDir}/chat.chat.json`, {
        kind: 'chat',
        id: session.id ?? sessionId,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        meta: { title: session.title },
        payload: chatPayload,
      })
      report.migratedTranscripts += chatPayload.messages.length
    } catch (err) {
      report.errors.push({
        sessionId,
        stage: 'write-chat',
        message: err instanceof Error ? err.message : String(err),
      })
    }

    const artifacts = isPlainObject(session.artifacts) ? session.artifacts : {}
    const artifactEntries = Object.values(artifacts) as Artifact[]
    if (artifactEntries.length > 0) {
      try {
        await fs.mkdir(artifactsDir)
      } catch (err) {
        report.errors.push({
          sessionId,
          stage: 'mkdir-artifacts',
          message: err instanceof Error ? err.message : String(err),
        })
      }
    }

    for (const artifact of artifactEntries) {
      if (!isPlainObject(artifact) || typeof artifact.kind !== 'string') {
        report.errors.push({
          sessionId,
          stage: 'parse-artifact',
          message: `Skipped non-object artifact in session ${sessionId}`,
        })
        continue
      }
      try {
        const relPath = `${artifactsDir}/${safeArtifactFileName(artifact)}`
        await writeEnvelope(fs, relPath, {
          kind: artifactFileKind(artifact.kind),
          id: artifact.id,
          createdAt: artifact.createdAt,
          updatedAt: artifact.updatedAt,
          meta: {
            title: artifact.title,
            artifactKind: artifact.kind,
            sourceFile: artifact.sourceFile ?? null,
            parents: artifact.parents ?? [],
          },
          payload: artifact.payload,
        })
        report.migratedArtifacts += 1
      } catch (err) {
        report.errors.push({
          sessionId,
          stage: `write-artifact:${artifact.kind}:${artifact.id}`,
          message: err instanceof Error ? err.message : String(err),
        })
      }
    }

    try {
      await fs.writeJson(
        `${sessionDir}/session.json`,
        buildSessionMetadata(session),
      )
      report.migratedSessions += 1
    } catch (err) {
      report.errors.push({
        sessionId,
        stage: 'write-session-meta',
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }

  try {
    await fs.mkdir('.lattice')
    await fs.writeJson(ARCHIVE_PATH, parsed)
  } catch (err) {
    report.errors.push({
      sessionId: '',
      stage: 'archive',
      message: err instanceof Error ? err.message : String(err),
    })
  }

  return report
}
