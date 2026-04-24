type EventHandler = (event: any) => void

export class WebSocketClient {
  private ws: WebSocket | null = null
  private url: string = ''
  private token: string = ''
  private handlers = new Map<string, Set<EventHandler>>()
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private _connected = false

  get connected(): boolean {
    return this._connected
  }

  connect(port: number, token: string): void {
    this.token = token
    this.url = `ws://localhost:${port}/ws?token=${token}`
    this.doConnect()
  }

  private doConnect(): void {
    if (this.ws) {
      this.ws.close()
    }

    this.ws = new WebSocket(this.url)

    this.ws.onopen = () => {
      this._connected = true
      this.emit('connection', { connected: true })
      this.startPing()
    }

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        const type = data.type || 'message'
        this.emit(type, data)
        this.emit('*', data)
      } catch {
        // ignore non-JSON messages
      }
    }

    this.ws.onclose = () => {
      this._connected = false
      this.stopPing()
      this.emit('connection', { connected: false })
      this.scheduleReconnect()
    }

    this.ws.onerror = () => {
      // onclose will be called after onerror
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.doConnect()
    }, 3000)
  }

  private startPing(): void {
    this.stopPing()
    this.pingTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'ping' }))
      }
    }, 30000)
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer)
      this.pingTimer = null
    }
  }

  on(event: string, handler: EventHandler): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set())
    }
    this.handlers.get(event)!.add(handler)
    return () => this.handlers.get(event)?.delete(handler)
  }

  /**
   * Transport-agnostic local dispatch.
   *
   * Lets in-process producers (dev mocks today; embedded agent/tool runners
   * later) push the exact same event shapes that would otherwise arrive over
   * the backend WebSocket. This keeps the renderer's task/artifact handling
   * path independent from the transport layer.
   */
  dispatch(event: string, data: any): void {
    this.emit(event, data)
  }

  private emit(event: string, data: any): void {
    this.handlers.get(event)?.forEach(h => h(data))
  }

  send(data: any): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data))
    }
  }

  disconnect(): void {
    this.stopPing()
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    this._connected = false
  }
}

export const wsClient = new WebSocketClient()
