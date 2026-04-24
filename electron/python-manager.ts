import { ChildProcess, spawn } from 'child_process'
import { EventEmitter } from 'events'
import http from 'http'

export interface PythonManagerEvents {
  ready: (port: number, token: string) => void
  error: (error: Error) => void
  exit: (code: number | null) => void
  stdout: (data: string) => void
  stderr: (data: string) => void
}

export class PythonManager extends EventEmitter {
  private process: ChildProcess | null = null
  private port: number = 0
  private token: string = ''
  private _ready = false

  get isReady(): boolean {
    return this._ready
  }

  get backendPort(): number {
    return this.port
  }

  get backendToken(): string {
    return this.token
  }

  get baseUrl(): string {
    return `http://localhost:${this.port}`
  }

  async start(options?: { pythonPath?: string; latticeCliPath?: string; port?: number }): Promise<void> {
    const python = options?.pythonPath || 'python3'
    this.port = options?.port || await this.findFreePort()

    const args = [
      '-m', 'lattice_cli.web.server',
      '--standalone',
      '--port', String(this.port),
    ]

    const cwd = options?.latticeCliPath || undefined

    this.process = spawn(python, args, {
      cwd,
      env: {
        ...process.env,
        PYTHONPATH: cwd ? `${cwd}/src` : undefined,
        PYTHONUNBUFFERED: '1',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    this.process.stdout?.on('data', (data: Buffer) => {
      const text = data.toString()
      this.emit('stdout', text)

      // Parse the startup message: LATTICE_BACKEND_READY port=XXXX token=XXXX
      const readyMatch = text.match(/LATTICE_BACKEND_READY\s+port=(\d+)\s+token=([a-zA-Z0-9_-]+)/)
      if (readyMatch) {
        this.port = parseInt(readyMatch[1], 10)
        this.token = readyMatch[2]
      }
    })

    this.process.stderr?.on('data', (data: Buffer) => {
      this.emit('stderr', data.toString())
    })

    this.process.on('exit', (code) => {
      this._ready = false
      this.emit('exit', code)
    })

    this.process.on('error', (err) => {
      this.emit('error', err)
    })

    // Poll for readiness
    await this.waitForReady()
  }

  private async waitForReady(timeoutMs: number = 30000): Promise<void> {
    const start = Date.now()
    const interval = 500

    while (Date.now() - start < timeoutMs) {
      try {
        const status = await this.healthCheck()
        if (status) {
          this._ready = true
          this.emit('ready', this.port, this.token)
          return
        }
      } catch {
        // Not ready yet
      }
      await new Promise(resolve => setTimeout(resolve, interval))
    }

    throw new Error(`Python backend did not start within ${timeoutMs}ms`)
  }

  private healthCheck(): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const url = `http://localhost:${this.port}/api/status`
      const tokenParam = this.token ? `?token=${this.token}` : ''

      const req = http.get(url + tokenParam, (res) => {
        if (res.statusCode === 200) {
          resolve(true)
        } else {
          resolve(false)
        }
        res.resume()
      })

      req.on('error', () => resolve(false))
      req.setTimeout(2000, () => {
        req.destroy()
        resolve(false)
      })
    })
  }

  private findFreePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = http.createServer()
      server.listen(0, () => {
        const addr = server.address()
        if (addr && typeof addr === 'object') {
          const port = addr.port
          server.close(() => resolve(port))
        } else {
          reject(new Error('Could not find free port'))
        }
      })
      server.on('error', reject)
    })
  }

  async stop(): Promise<void> {
    if (!this.process) return

    this._ready = false

    // Graceful shutdown
    this.process.kill('SIGTERM')

    // Wait up to 5 seconds for graceful exit
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        if (this.process) {
          this.process.kill('SIGKILL')
        }
        resolve()
      }, 5000)

      this.process?.on('exit', () => {
        clearTimeout(timeout)
        resolve()
      })
    })

    this.process = null
  }
}
