import type { ParsedSpectrum } from './types'

const TEXT_PARSEABLE: ReadonlySet<string> = new Set([
  '.jdx',
  '.dx',
  '.xrdml',
  '.csv',
  '.tsv',
  '.xy',
  '.dat',
  '.txt',
  '.chi',
  '.uxd',
  '.vms',
  '.vamas',
  '.npl',
  '.gsa',
  '.fxye',
  '.cpi',
  '.rruf',
  '.udf',
])

const BINARY_PARSEABLE: ReadonlySet<string> = new Set([
  '.raw',
  '.spc', '.wdf', '.spe',
  '.spa', '.sp', '.rd', '.sd',
  '.cha',
])

const BACKEND_ONLY: ReadonlySet<string> = new Set([
  '.ngs',
])

function extOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot).toLowerCase() : ''
}

export function canParseLocally(fileName: string): boolean {
  const ext = extOf(fileName)
  return TEXT_PARSEABLE.has(ext) || BINARY_PARSEABLE.has(ext)
}

export function needsBinaryRead(fileName: string): boolean {
  return BINARY_PARSEABLE.has(extOf(fileName))
}

export async function parseSpectrumText(
  text: string,
  fileName: string,
): Promise<ParsedSpectrum | null> {
  const ext = extOf(fileName)

  switch (ext) {
    case '.jdx':
    case '.dx': {
      const { parseJdx } = await import('./jdx-parser')
      return parseJdx(text, fileName)
    }
    case '.xrdml': {
      const { parseXrdml } = await import('./xrdml-parser')
      return parseXrdml(text, fileName)
    }
    case '.csv':
    case '.tsv':
    case '.xy':
    case '.dat':
    case '.txt':
    case '.chi':
    case '.uxd': {
      const { parseCsv } = await import('./csv-parser')
      return parseCsv(text, fileName)
    }
    case '.vms':
    case '.vamas':
    case '.npl': {
      const { parseVamas } = await import('./vamas-parser')
      return parseVamas(text, fileName)
    }
    case '.gsa': {
      const { parseGsas } = await import('./gsas-parser')
      return parseGsas(text, fileName)
    }
    case '.fxye': {
      const { parseFxye } = await import('./gsas-parser')
      return parseFxye(text, fileName)
    }
    case '.cpi': {
      const { parseCpi } = await import('./cpi-parser')
      return parseCpi(text, fileName)
    }
    case '.rruf': {
      const { parseRruf } = await import('./rruf-parser')
      return parseRruf(text, fileName)
    }
    case '.udf': {
      const { parsePhilipsUdf } = await import('./philips-udf-parser')
      return parsePhilipsUdf(text, fileName)
    }
    default:
      return null
  }
}

export async function parseSpectrumBinary(
  buffer: ArrayBuffer,
  fileName: string,
): Promise<ParsedSpectrum | null> {
  const ext = extOf(fileName)

  switch (ext) {
    case '.raw': {
      const { parseBrukerRaw } = await import('./bruker-raw-parser')
      return parseBrukerRaw(buffer, fileName)
    }
    case '.spc': {
      const { parseSpc } = await import('./spc-parser')
      return parseSpc(buffer, fileName)
    }
    case '.wdf': {
      const { parseWdf } = await import('./wdf-parser')
      return parseWdf(buffer, fileName)
    }
    case '.spe': {
      const { parseSpe } = await import('./spe-parser')
      return parseSpe(buffer, fileName)
    }
    case '.spa':
    case '.sp': {
      const { parseThermoSp } = await import('./thermo-sp-parser')
      return parseThermoSp(buffer, fileName)
    }
    case '.rd':
    case '.sd': {
      const { parsePhilipsRd } = await import('./philips-rd-parser')
      return parsePhilipsRd(buffer, fileName)
    }
    case '.cha': {
      const { parseHoribaCha } = await import('./horiba-cha-parser')
      return parseHoribaCha(buffer, fileName)
    }
    default:
      return null
  }
}

export function needsBackendParse(fileName: string): boolean {
  return BACKEND_ONLY.has(extOf(fileName))
}

/**
 * Upper bound for a single spectrum-overlay text read. Real XRD / XPS
 * files top out around a few MB even at 5k-point resolution; 10 MB is
 * generous enough to accept most operando time-series exports while
 * blocking users from accidentally dragging in a 100 MB log file and
 * blowing up the renderer heap on `file.text()`.
 */
export const OVERLAY_MAX_BYTES = 10 * 1024 * 1024

/**
 * Upper bound for a CIF dragged into the XRD workbench for DARA
 * refinement. Genuine CIFs are almost always < 50 KB; 500 KB is an
 * order-of-magnitude safety margin that still blocks log files / stray
 * binaries from entering the artifact payload (where they'd also get
 * persisted to disk as part of the snapshot).
 */
export const CIF_MAX_BYTES = 500 * 1024

export type { ParsedSpectrum, SpectroscopyTechnique } from './types'
