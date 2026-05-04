import * as awarenessProtocol from 'y-protocols/awareness'
import * as Y from 'yjs'
import {
  decryptBytes,
  encodeDocumentState,
  encryptBytes,
  type EncryptedCollaborationPacket,
  importDataKey,
  isEncryptedCollaborationPacket,
  keyIdForRoom,
} from './encrypted-collaboration'

type Status = 'connected' | 'connecting' | 'disconnected'

interface Options {
  serverUrl: string
  roomName: string
  ticket: string
  roomSecret: string
  doc: Y.Doc
  awareness: awarenessProtocol.Awareness
  onStatus: (status: Status) => void
  onError: (error: string) => void
}

type ServerMessage =
  | {
      type: 'sync_start'
      snapshot?: { seq: number; packet: unknown } | null
      update_count?: number
      last_seq?: number
    }
  | { type: 'encrypted_update'; seq?: number; packet: unknown }
  | { type: 'update_stored'; seq?: number }
  | { type: 'sync_done'; last_seq?: number }
  | { type: 'snapshot_stored'; seq?: number }
  | { type: 'encrypted_awareness'; packet: unknown }

export class EncryptedLatexCollaborationClient {
  private readonly serverUrl: string
  private readonly roomName: string
  private readonly ticket: string
  private readonly doc: Y.Doc
  private readonly awareness: awarenessProtocol.Awareness
  private readonly onStatus: (status: Status) => void
  private readonly onError: (error: string) => void
  private readonly keyReady: Promise<CryptoKey>
  private readonly kid: string
  private ws: WebSocket | null = null
  private closed = false
  private synced = false
  private applyingRemote = false
  private snapshotTimer: ReturnType<typeof setTimeout> | null = null
  private lastStoredSeq = 0
  private readonly remoteAwarenessClients = new Set<number>()

  constructor(options: Options) {
    this.serverUrl = options.serverUrl
    this.roomName = options.roomName
    this.ticket = options.ticket
    this.doc = options.doc
    this.awareness = options.awareness
    this.onStatus = options.onStatus
    this.onError = options.onError
    this.kid = keyIdForRoom(options.roomName)
    this.keyReady = importDataKey(options.roomSecret, options.roomName)
  }

  connect(): void {
    this.closed = false
    this.onStatus('connecting')
    this.keyReady
      .then(() => {
        if (!this.closed) this.openSocket()
      })
      .catch((err: unknown) => {
        this.onError(err instanceof Error ? err.message : String(err))
      })
  }

  destroy(): void {
    this.closed = true
    this.synced = false
    if (this.snapshotTimer) clearTimeout(this.snapshotTimer)
    this.snapshotTimer = null
    awarenessProtocol.removeAwarenessStates(
      this.awareness,
      Array.from(this.remoteAwarenessClients),
      this,
    )
    this.remoteAwarenessClients.clear()
    this.doc.off('update', this.handleDocUpdate)
    this.awareness.off('update', this.handleAwarenessUpdate)
    this.ws?.close(1000, 'client_shutdown')
    this.ws = null
  }

  private openSocket(): void {
    const ws = new WebSocket(this.connectionUrl())
    this.ws = ws
    ws.addEventListener('open', () => {
      this.synced = false
      this.onStatus('connecting')
      this.doc.on('update', this.handleDocUpdate)
      this.awareness.on('update', this.handleAwarenessUpdate)
      this.sendAwareness(Array.from(this.awareness.getStates().keys()))
    })
    ws.addEventListener('close', () => {
      if (this.ws === ws) this.ws = null
      this.doc.off('update', this.handleDocUpdate)
      this.awareness.off('update', this.handleAwarenessUpdate)
      this.onStatus(this.closed ? 'disconnected' : 'disconnected')
    })
    ws.addEventListener('error', () => {
      this.onError('Collaboration connection failed.')
    })
    ws.addEventListener('message', (event) => {
      void this.handleMessage(event.data)
    })
  }

  private connectionUrl(): string {
    const base = this.serverUrl.replace(/\/+$/, '')
    const url = new URL(`${base}/${encodeURIComponent(this.roomName)}`)
    url.searchParams.set('ticket', this.ticket)
    return url.toString()
  }

  private readonly handleDocUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === this || this.applyingRemote || this.closed) return
    if (!this.synced) return
    void this.sendEncryptedUpdate(update)
    this.scheduleSnapshot()
  }

  private readonly handleAwarenessUpdate = (
    event: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ) => {
    if (origin === this || this.closed) return
    this.sendAwareness(event.added.concat(event.updated, event.removed))
  }

  private async sendEncryptedUpdate(update: Uint8Array): Promise<void> {
    try {
      const packet = await encryptBytes(update, await this.keyReady, this.kid)
      this.send({ type: 'encrypted_update', packet })
    } catch (err) {
      this.onError(err instanceof Error ? err.message : String(err))
    }
  }

  private async sendEncryptedSnapshot(): Promise<void> {
    if (this.closed || this.ws?.readyState !== WebSocket.OPEN) return
    try {
      const packet = await encryptBytes(
        encodeDocumentState(this.doc),
        await this.keyReady,
        this.kid,
      )
      this.send({ type: 'encrypted_snapshot', seq: this.lastStoredSeq, packet })
    } catch (err) {
      this.onError(err instanceof Error ? err.message : String(err))
    }
  }

  private scheduleSnapshot(): void {
    if (this.snapshotTimer) return
    this.snapshotTimer = setTimeout(() => {
      this.snapshotTimer = null
      void this.sendEncryptedSnapshot()
    }, 5000)
  }

  private sendAwareness(changedClients: number[]): void {
    if (changedClients.length === 0) return
    const update = awarenessProtocol.encodeAwarenessUpdate(this.awareness, changedClients)
    void this.sendEncryptedAwareness(update)
  }

  private async sendEncryptedAwareness(update: Uint8Array): Promise<void> {
    try {
      const packet = await encryptBytes(update, await this.keyReady, this.kid)
      this.send({ type: 'encrypted_awareness', packet })
    } catch (err) {
      this.onError(err instanceof Error ? err.message : String(err))
    }
  }

  private async handleMessage(raw: unknown): Promise<void> {
    let message: ServerMessage
    try {
      message = JSON.parse(String(raw)) as ServerMessage
    } catch {
      this.onError('Received an invalid collaboration message.')
      return
    }
    if (message.type === 'sync_start') {
      if (message.snapshot?.packet && isEncryptedCollaborationPacket(message.snapshot.packet)) {
        await this.applyPacket(message.snapshot.packet)
      }
      return
    }
    if (message.type === 'encrypted_update') {
      if (typeof message.seq === 'number' && message.seq > this.lastStoredSeq) {
        this.lastStoredSeq = message.seq
      }
      if (isEncryptedCollaborationPacket(message.packet)) {
        await this.applyPacket(message.packet)
      }
      return
    }
    if (message.type === 'update_stored') {
      if (typeof message.seq === 'number' && message.seq > this.lastStoredSeq) {
        this.lastStoredSeq = message.seq
      }
      return
    }
    if (message.type === 'sync_done') {
      if (typeof message.last_seq === 'number' && message.last_seq > this.lastStoredSeq) {
        this.lastStoredSeq = message.last_seq
      }
      this.synced = true
      this.onStatus('connected')
      void this.sendEncryptedUpdate(Y.encodeStateAsUpdate(this.doc))
      this.scheduleSnapshot()
      return
    }
    if (message.type === 'snapshot_stored') return
    if (message.type === 'encrypted_awareness') {
      try {
        if (!isEncryptedCollaborationPacket(message.packet)) return
        const update = await decryptBytes(message.packet, await this.keyReady, this.kid)
        const before = new Set(this.awareness.getStates().keys())
        awarenessProtocol.applyAwarenessUpdate(this.awareness, update, this)
        for (const id of this.awareness.getStates().keys()) {
          if (!before.has(id) && id !== this.awareness.clientID) {
            this.remoteAwarenessClients.add(id)
          }
        }
      } catch {
        this.onError('Received an invalid collaborator presence update.')
      }
    }
  }

  private async applyPacket(packet: EncryptedCollaborationPacket): Promise<void> {
    try {
      const update = await decryptBytes(packet, await this.keyReady, this.kid)
      this.applyingRemote = true
      Y.applyUpdate(this.doc, update, this)
    } catch (err) {
      this.onError(err instanceof Error ? err.message : String(err))
    } finally {
      this.applyingRemote = false
    }
  }

  private send(payload: unknown): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return
    this.ws.send(JSON.stringify(payload))
  }
}
