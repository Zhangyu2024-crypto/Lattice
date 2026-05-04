import * as Y from 'yjs'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as syncProtocol from 'y-protocols/sync'
import * as decoding from 'lib0/decoding'
import * as encoding from 'lib0/encoding'
import type { LatexFile } from '../../types/latex'
import { kindFromLatexPath, normalizeLatexProjectFiles } from './project-paths'
import { idbGet, idbSet } from '../idb-storage'

const messageSync = 0
const messageAwareness = 1
const messageAuth = 2
const messageQueryAwareness = 3

const CACHE_PREFIX = 'latex-collab-room:'

export type LatexCollabConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'error'

export interface LatexCollabPeer {
  clientId: number
  id?: string
  name: string
  role?: string
  color: string
}

export interface LatexCollabSnapshot {
  files: LatexFile[]
  rootFile?: string
}

export interface LatexCollabClientOptions {
  roomName: string
  wsUrl: string
  initialFiles: LatexFile[]
  rootFile: string
  username: string
  userId?: string
  onStatus: (status: LatexCollabConnectionStatus, error?: string) => void
  onSnapshot: (snapshot: LatexCollabSnapshot) => void
  onPeers: (peers: LatexCollabPeer[]) => void
}

export interface LatexCollabClient {
  connect: () => void
  disconnect: () => void
  replaceFile: (path: string, content: string) => void
  renameFile: (from: string, to: string) => void
  removeFile: (path: string) => void
  setRootFile: (path: string) => void
  getSnapshot: () => LatexCollabSnapshot
}

type FileMeta = { path: string; kind: LatexFile['kind'] }

function cacheKey(roomName: string): string {
  return `${CACHE_PREFIX}${roomName}`
}

function textKey(path: string): string {
  return `file:${path}`
}

function colorForIdentity(seed: string): string {
  const colors = ['#2563eb', '#059669', '#d97706', '#dc2626', '#7c3aed', '#0891b2']
  let hash = 0
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0
  }
  return colors[hash % colors.length]
}

function ytextToString(text: Y.Text): string {
  return text.toString()
}

function replaceYText(text: Y.Text, content: string): void {
  text.delete(0, text.length)
  text.insert(0, content)
}

function snapshotFromDoc(ydoc: Y.Doc): LatexCollabSnapshot {
  const meta = ydoc.getMap<FileMeta>('files')
  const root = ydoc.getMap<string>('meta').get('rootFile')
  const files = Array.from(meta.values())
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((m) => ({
      path: m.path,
      kind: m.kind ?? kindFromLatexPath(m.path),
      content: ytextToString(ydoc.getText(textKey(m.path))),
    }))
  return { files, rootFile: root }
}

function applyInitialFiles(
  ydoc: Y.Doc,
  files: LatexFile[],
  rootFile: string,
): void {
  const meta = ydoc.getMap<FileMeta>('files')
  if (meta.size > 0) return
  const normalized = normalizeLatexProjectFiles(files)
  ydoc.transact(() => {
    for (const file of normalized) {
      meta.set(file.path, { path: file.path, kind: file.kind })
      replaceYText(ydoc.getText(textKey(file.path)), file.content)
    }
    ydoc.getMap<string>('meta').set('rootFile', rootFile)
  })
}

async function restoreCachedDoc(ydoc: Y.Doc, roomName: string): Promise<void> {
  const cached = await idbGet(cacheKey(roomName))
  if (!cached) return
  try {
    const bytes = Uint8Array.from(atob(cached), (ch) => ch.charCodeAt(0))
    Y.applyUpdate(ydoc, bytes, null)
  } catch {
    // Ignore corrupt local cache; the room state will arrive from the server.
  }
}

function persistDocSoon(ydoc: Y.Doc, roomName: string): () => void {
  let timer: number | null = null
  return () => {
    if (timer != null) window.clearTimeout(timer)
    timer = window.setTimeout(() => {
      timer = null
      const update = Y.encodeStateAsUpdate(ydoc)
      let text = ''
      for (const byte of update) text += String.fromCharCode(byte)
      void idbSet(cacheKey(roomName), btoa(text))
    }, 500)
  }
}

export async function createLatexCollabClient(
  opts: LatexCollabClientOptions,
): Promise<LatexCollabClient> {
  const ydoc = new Y.Doc()
  await restoreCachedDoc(ydoc, opts.roomName)
  applyInitialFiles(ydoc, opts.initialFiles, opts.rootFile)

  const awareness = new awarenessProtocol.Awareness(ydoc)
  const persist = persistDocSoon(ydoc, opts.roomName)
  let ws: WebSocket | null = null
  let suppressSnapshot = false

  const emitSnapshot = () => {
    if (suppressSnapshot) return
    opts.onSnapshot(snapshotFromDoc(ydoc))
  }

  const emitPeers = () => {
    const peers: LatexCollabPeer[] = []
    for (const [clientId, state] of awareness.getStates()) {
      if (clientId === awareness.clientID) continue
      const user = state?.user && typeof state.user === 'object'
        ? state.user as Record<string, unknown>
        : {}
      peers.push({
        clientId,
        id: typeof user.id === 'string' ? user.id : undefined,
        name: typeof user.name === 'string' && user.name.trim()
          ? user.name
          : 'Collaborator',
        role: typeof user.role === 'string' ? user.role : undefined,
        color: typeof user.color === 'string' ? user.color : '#64748b',
      })
    }
    opts.onPeers(peers)
  }

  const send = (bytes: Uint8Array) => {
    if (ws?.readyState === WebSocket.OPEN) ws.send(bytes)
  }

  ydoc.on('update', (update, origin) => {
    persist()
    emitSnapshot()
    if (origin === ws) return
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, messageSync)
    syncProtocol.writeUpdate(encoder, update)
    send(encoding.toUint8Array(encoder))
  })

  awareness.on('update', (
    event: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ) => {
    emitPeers()
    if (origin === ws) return
    const changedClients = event.added.concat(event.updated).concat(event.removed)
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, messageAwareness)
    encoding.writeVarUint8Array(
      encoder,
      awarenessProtocol.encodeAwarenessUpdate(awareness, changedClients),
    )
    send(encoding.toUint8Array(encoder))
  })

  awareness.setLocalStateField('user', {
    id: opts.userId || opts.username,
    name: opts.username,
    color: colorForIdentity(opts.userId || opts.username),
  })

  const handleMessage = (data: ArrayBuffer) => {
    const decoder = decoding.createDecoder(new Uint8Array(data))
    const messageType = decoding.readVarUint(decoder)
    switch (messageType) {
      case messageSync:
      {
        const encoder = encoding.createEncoder()
        encoding.writeVarUint(encoder, messageSync)
        syncProtocol.readSyncMessage(decoder, encoder, ydoc, ws)
        if (encoding.length(encoder) > 1) {
          send(encoding.toUint8Array(encoder))
        }
        break
      }
      case messageAwareness:
        awarenessProtocol.applyAwarenessUpdate(
          awareness,
          decoding.readVarUint8Array(decoder),
          ws,
        )
        break
      case messageAuth:
        opts.onStatus('error', 'Collaboration authorization failed.')
        ws?.close()
        break
      default:
        opts.onStatus('error', 'Unsupported collaboration message.')
        ws?.close()
    }
  }

  return {
    connect() {
      if (ws && ws.readyState !== WebSocket.CLOSED) return
      opts.onStatus('connecting')
      ws = new WebSocket(opts.wsUrl)
      ws.binaryType = 'arraybuffer'
      ws.onopen = () => {
        opts.onStatus('connected')
        const encoder = encoding.createEncoder()
        encoding.writeVarUint(encoder, messageSync)
        syncProtocol.writeSyncStep1(encoder, ydoc)
        send(encoding.toUint8Array(encoder))

        const awarenessEncoder = encoding.createEncoder()
        encoding.writeVarUint(awarenessEncoder, messageQueryAwareness)
        send(encoding.toUint8Array(awarenessEncoder))
      }
      ws.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) {
          handleMessage(event.data)
        } else if (event.data instanceof Blob) {
          void event.data.arrayBuffer().then(handleMessage)
        }
      }
      ws.onclose = () => {
        opts.onStatus('disconnected')
        emitPeers()
      }
      ws.onerror = () => {
        opts.onStatus('error', 'Collaboration WebSocket failed.')
      }
    },
    disconnect() {
      awareness.setLocalState(null)
      ws?.close()
      ws = null
      ydoc.destroy()
      awareness.destroy()
      opts.onStatus('disconnected')
    },
    replaceFile(path, content) {
      const meta = ydoc.getMap<FileMeta>('files')
      suppressSnapshot = true
      ydoc.transact(() => {
        meta.set(path, { path, kind: kindFromLatexPath(path) })
        replaceYText(ydoc.getText(textKey(path)), content)
      })
      suppressSnapshot = false
    },
    renameFile(from, to) {
      const meta = ydoc.getMap<FileMeta>('files')
      const oldText = ytextToString(ydoc.getText(textKey(from)))
      suppressSnapshot = true
      ydoc.transact(() => {
        meta.delete(from)
        meta.set(to, { path: to, kind: kindFromLatexPath(to) })
        replaceYText(ydoc.getText(textKey(to)), oldText)
        const root = ydoc.getMap<string>('meta').get('rootFile')
        if (root === from) ydoc.getMap<string>('meta').set('rootFile', to)
      })
      suppressSnapshot = false
    },
    removeFile(path) {
      suppressSnapshot = true
      ydoc.transact(() => {
        ydoc.getMap<FileMeta>('files').delete(path)
        const root = ydoc.getMap<string>('meta').get('rootFile')
        if (root === path) {
          const first = Array.from(ydoc.getMap<FileMeta>('files').keys())[0]
          if (first) ydoc.getMap<string>('meta').set('rootFile', first)
        }
      })
      suppressSnapshot = false
    },
    setRootFile(path) {
      suppressSnapshot = true
      ydoc.getMap<string>('meta').set('rootFile', path)
      suppressSnapshot = false
    },
    getSnapshot() {
      return snapshotFromDoc(ydoc)
    },
  }
}
