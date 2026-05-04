import type {
  LatexCollaborationMember,
  LatexCollaborationMetadata,
  LatexCollaborationRole,
} from '../../types/collaboration'
import type { LatexDocumentPayload } from '../../types/latex'

const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export const DEFAULT_LATEX_COLLABORATION_SERVER_URL =
  'wss://chaxiejun.xyz/_collab'

const USER_COLORS = [
  '#2563eb',
  '#059669',
  '#d97706',
  '#dc2626',
  '#7c3aed',
  '#0891b2',
  '#be123c',
  '#4f46e5',
]

export function createLatexCollaborationRoomId(now = Date.now()): string {
  const stamp = now.toString(36).toUpperCase().slice(-5).padStart(5, '0')
  return `LAT-${stamp}-${randomToken(4)}`
}

export function createLatexCollaborationProjectId(
  artifactId: string,
  now = Date.now(),
): string {
  const safe = artifactId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
  return `latex-${safe || 'project'}-${now.toString(36)}`
}

export function normalizeCollaborationServerUrl(raw?: string): string | undefined {
  const value = raw?.trim()
  if (!value) return undefined
  try {
    const url = new URL(value)
    if (url.protocol !== 'ws:' && url.protocol !== 'wss:') return undefined
    url.hash = ''
    url.search = ''
    return url.toString().replace(/\/$/, '')
  } catch {
    return undefined
  }
}

export function collaborationTicketEndpoint(serverUrl: string): string | undefined {
  const normalized = normalizeCollaborationServerUrl(serverUrl)
  if (!normalized) return undefined
  const url = new URL(normalized)
  url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:'
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/ticket`
  return url.toString()
}

export function buildLatexCollaborationRoomName(
  collab: Pick<LatexCollaborationMetadata, 'projectId' | 'roomId'>,
  filePath: string,
): string {
  return [collab.projectId, collab.roomId, filePath]
    .map((part) => encodeRoomPart(part))
    .join(':')
}

export function createLocalCollaborationMember(
  collab: LatexCollaborationMetadata,
  lastSeenAt = Date.now(),
): LatexCollaborationMember {
  return {
    id: collab.localUserId,
    name: collab.localUserName,
    role: collab.role,
    color: collab.localUserColor,
    isLocal: true,
    lastSeenAt,
  }
}

export function createLatexCollaborationMetadata(args: {
  artifactId: string
  documentTitle: string
  userName?: string
  serverUrl?: string
  role?: LatexCollaborationRole
  now?: number
}): LatexCollaborationMetadata {
  const now = args.now ?? Date.now()
  const name = normalizeUserName(args.userName, 'Local author')
  const localUserId = `local-${stableHash(`${args.artifactId}:${name}`).slice(0, 10)}`
  return {
    enabled: true,
    provider: 'yjs-websocket',
    projectId: createLatexCollaborationProjectId(args.artifactId, now),
    roomId: createLatexCollaborationRoomId(now),
    role: args.role ?? 'owner',
    initialSync: 'seed-from-artifact',
    localUserId,
    localUserName: name,
    localUserColor: colorForId(localUserId),
    serverUrl:
      args.serverUrl === undefined
        ? DEFAULT_LATEX_COLLABORATION_SERVER_URL
        : normalizeCollaborationServerUrl(args.serverUrl),
    workspaceRelDir: defaultWorkspaceRelDir(args.documentTitle, args.artifactId),
    createdAt: now,
    updatedAt: now,
  }
}

export function normalizeLatexCollaborationMetadata(
  payload: LatexDocumentPayload,
  artifactId: string,
  documentTitle: string,
  now = Date.now(),
): LatexCollaborationMetadata | undefined {
  const cur = payload.collaboration
  if (!cur) return undefined
  const localUserName = normalizeUserName(cur.localUserName, 'Local author')
  const localUserId =
    typeof cur.localUserId === 'string' && cur.localUserId.trim()
      ? cur.localUserId.trim()
      : `local-${stableHash(`${artifactId}:${localUserName}`).slice(0, 10)}`
  const projectId =
    typeof cur.projectId === 'string' && cur.projectId.trim()
      ? cur.projectId.trim()
      : createLatexCollaborationProjectId(artifactId, now)
  const roomId =
    typeof cur.roomId === 'string' && cur.roomId.trim()
      ? cur.roomId.trim()
      : createLatexCollaborationRoomId(now)
  return {
    enabled: Boolean(cur.enabled),
    provider: 'yjs-websocket',
    projectId,
    roomId,
    role: cur.role ?? 'owner',
    initialSync: cur.initialSync ?? 'seed-from-artifact',
    localUserId,
    localUserName,
    localUserColor: cur.localUserColor || colorForId(localUserId),
    serverUrl: normalizeCollaborationServerUrl(cur.serverUrl),
    workspaceRelDir:
      typeof cur.workspaceRelDir === 'string' && cur.workspaceRelDir.trim()
        ? cur.workspaceRelDir.trim()
        : defaultWorkspaceRelDir(documentTitle, artifactId),
    createdAt: cur.createdAt || now,
    updatedAt: cur.updatedAt || now,
    lastConnectedAt: cur.lastConnectedAt,
  }
}

export function summarizeCollaborationMembers(
  collab: LatexCollaborationMetadata | undefined,
  remoteMembers: readonly LatexCollaborationMember[],
): LatexCollaborationMember[] {
  const byId = new Map<string, LatexCollaborationMember>()
  if (collab) {
    byId.set(collab.localUserId, createLocalCollaborationMember(collab))
  }
  for (const member of remoteMembers) {
    if (!member.id || byId.has(member.id)) continue
    byId.set(member.id, {
      ...member,
      name: normalizeUserName(member.name, 'Collaborator'),
      color: member.color || colorForId(member.id),
      role: member.role ?? 'editor',
    })
  }
  return Array.from(byId.values())
}

function randomToken(length: number): string {
  const cryptoApi = globalThis.crypto
  if (cryptoApi?.getRandomValues) {
    const bytes = cryptoApi.getRandomValues(new Uint8Array(length))
    return Array.from(bytes, (byte) => ROOM_ALPHABET[byte % ROOM_ALPHABET.length]).join('')
  }
  let out = ''
  for (let i = 0; i < length; i += 1) {
    out += ROOM_ALPHABET[Math.floor(Math.random() * ROOM_ALPHABET.length)]
  }
  return out
}

function normalizeUserName(raw: string | undefined, fallback: string): string {
  const name = raw?.trim().replace(/\s+/g, ' ')
  return name ? name.slice(0, 80) : fallback
}

function defaultWorkspaceRelDir(title: string, artifactId: string): string {
  const slug =
    title
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || artifactId.slice(0, 16)
  return `papers/${slug}`
}

function encodeRoomPart(part: string): string {
  return part.trim().replace(/[:/\\?#\s]+/g, '-')
}

function colorForId(id: string): string {
  const hash = stableHash(id)
  const idx = parseInt(hash.slice(0, 8), 16) % USER_COLORS.length
  return USER_COLORS[idx]
}

function stableHash(input: string): string {
  let h = 2166136261
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}
