// Singleton wrapper around the vendored BusyTeX WebAssembly pipeline.
//
// BusyTeX ships a Worker script (`busytex_worker.js`) that internally loads
// `busytex_pipeline.js`, which in turn loads the WASM binary and data
// packages from `public/busytex/` (bundled with the app — no network fetch).
// We pre-warm the worker on card mount so the first compile is fast.
//
// Protocol (from the upstream Worker source):
//   → post { busytex_wasm, busytex_js, preload_data_packages_js,
//            data_packages_js, texmf_local, preload, verbose, driver }  — init
//   ← post { initialized: applet_versions }  — engine ready
//   → post { files, main_tex_path, bibtex }                              — compile
//   ← post { pdf, log, exit_code, logs }                                 — result
//   ← post { print: string }                                             — progress line
//   ← post { exception: string }                                         — fatal
//
// Ref: public/busytex/busytex_worker.js + busytex_pipeline.js (compile at L441).

// All URLs use the full origin so Worker importScripts and Emscripten's
// internal locateFile / XMLHttpRequest resolve correctly (relative paths
// break inside Workers and blob: URLs break Emscripten's scriptDirectory).
const ORIGIN = typeof window !== 'undefined' ? window.location.origin : ''
const BASE_URL = `${ORIGIN}/busytex`

const WORKER_URL = `${BASE_URL}/busytex_worker.js`
const BUSYTEX_JS = `${BASE_URL}/busytex.js`
const BUSYTEX_WASM = `${BASE_URL}/busytex.wasm`

const PRELOAD_PACKAGES: readonly string[] = [
  `${BASE_URL}/texlive-basic.js`,
  `${BASE_URL}/ubuntu-texlive-latex-base.js`,
  `${BASE_URL}/ubuntu-texlive-fonts-recommended.js`,
]

const DATA_PACKAGES: readonly string[] = [
  ...PRELOAD_PACKAGES,
  `${BASE_URL}/ubuntu-texlive-latex-recommended.js`,
  `${BASE_URL}/ubuntu-texlive-latex-extra.js`,
  `${BASE_URL}/ubuntu-texlive-science.js`,
]

type Driver =
  | 'pdftex_bibtex8'
  | 'xetex_bibtex8_dvipdfmx'
  | 'luahbtex_bibtex8'
  | 'luatex_bibtex8'

export interface CompileFile {
  path: string
  contents: string | Uint8Array
}

export interface CompileRequest {
  files: CompileFile[]
  rootFile: string
  driver?: Driver
  /** Called with each line the pipeline prints (pdftex stdout, pipeline
   *  status, etc.). Used by the UI for a live progress ticker. */
  onProgress?: (line: string) => void
}

export interface CompileResult {
  ok: boolean
  pdf: Uint8Array | null
  log: string
  exitCode: number
  durationMs: number
}

export class BusytexRunnerError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BusytexRunnerError'
  }
}

interface Pipeline {
  compile(req: CompileRequest): Promise<CompileResult>
  terminate(): void
}

let pipelinePromise: Promise<Pipeline> | null = null

export function getBusytexRunner(): Promise<Pipeline> {
  if (!pipelinePromise) {
    pipelinePromise = createPipeline().catch((err) => {
      // Reset so a retry can try again — a transient network failure on the
      // wasm fetch shouldn't leave the runner permanently broken.
      pipelinePromise = null
      throw err
    })
  }
  return pipelinePromise
}

/** Release the Worker + WASM — useful for tests, or when the user explicitly
 *  wants to free memory. Next compile re-initializes. */
export function disposeBusytexRunner(): void {
  if (!pipelinePromise) return
  const p = pipelinePromise
  pipelinePromise = null
  p.then((pipeline) => pipeline.terminate()).catch(() => void 0)
}

function createPipeline(): Promise<Pipeline> {
  return new Promise((resolve, reject) => {
    let worker: Worker
    try {
      worker = new Worker(WORKER_URL, { type: 'classic' })
    } catch (err) {
      reject(
        new BusytexRunnerError(
          `Failed to spawn BusyTeX worker: ${err instanceof Error ? err.message : String(err)}`,
        ),
      )
      return
    }

    let activeCompile: {
      resolve: (r: CompileResult) => void
      reject: (e: Error) => void
      startedAt: number
      onProgress?: (line: string) => void
    } | null = null
    const initLog: string[] = []

    worker.onerror = (e) => {
      const message = e.message || 'worker crashed'
      if (activeCompile) {
        activeCompile.reject(new BusytexRunnerError(message))
        activeCompile = null
      } else {
        reject(new BusytexRunnerError(`BusyTeX init failed: ${message}`))
      }
    }

    worker.onmessage = (event: MessageEvent) => {
      const data = event.data as {
        initialized?: unknown
        print?: string
        exception?: string
        pdf?: Uint8Array
        log?: string
        exit_code?: number
      }
      if (data.exception) {
        const err = new BusytexRunnerError(data.exception)
        if (activeCompile) {
          activeCompile.reject(err)
          activeCompile = null
        } else {
          reject(err)
        }
        return
      }
      if (data.print != null) {
        activeCompile?.onProgress?.(data.print)
        initLog.push(data.print)
        return
      }
      if (data.initialized !== undefined) {
        resolve({
          compile: (req) => compileOne(worker, req),
          terminate: () => worker.terminate(),
        })
        return
      }
      // Compile response. BusyTeX returns an ArrayBuffer-backed Uint8Array on
      // the PDF; we pass it through unchanged.
      if (activeCompile) {
        const ac = activeCompile
        activeCompile = null
        ac.resolve({
          ok: (data.exit_code ?? 1) === 0 && !!data.pdf,
          pdf: data.pdf ?? null,
          log: data.log ?? '',
          exitCode: data.exit_code ?? 1,
          durationMs: Date.now() - ac.startedAt,
        })
      }
    }

    worker.postMessage({
      busytex_wasm: BUSYTEX_WASM,
      busytex_js: BUSYTEX_JS,
      preload_data_packages_js: PRELOAD_PACKAGES,
      data_packages_js: DATA_PACKAGES,
      texmf_local: [],
      preload: true,
      verbose: 'silent',
      driver: 'pdftex_bibtex8',
    })

    // One compile at a time is enforced by the closure-captured `activeCompile`
    // pointer; callers queue on the returned Promise.
    function compileOne(
      w: Worker,
      req: CompileRequest,
    ): Promise<CompileResult> {
      return new Promise<CompileResult>((res, rej) => {
        if (activeCompile) {
          rej(
            new BusytexRunnerError(
              'BusyTeX is already compiling; wait for the previous compile to finish',
            ),
          )
          return
        }
        activeCompile = {
          resolve: res,
          reject: rej,
          startedAt: Date.now(),
          onProgress: req.onProgress,
        }
        w.postMessage({
          files: req.files.map((f) => ({ path: f.path, contents: f.contents })),
          main_tex_path: req.rootFile,
          bibtex: null,
          driver: req.driver ?? 'pdftex_bibtex8',
          verbose: 'silent',
          data_packages_js: DATA_PACKAGES,
        })
      })
    }
  })
}
