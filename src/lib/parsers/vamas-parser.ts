import type { ParsedSpectrum, SpectroscopyTechnique } from './types'

// ISO 14976 (VAMAS) text parser — line-by-line, ported from
// lattice-cli readers/native_readers.py::_vamas_parse + load_vamas.
// Handles NORM/MAP experiment modes and REGULAR scan mode. Returns block 0.

const MODES_WITH_SPECTRAL_REGIONS = new Set(['MAP', 'MAPD', 'NORM', 'SDP'])
const MODES_WITH_ANALYSIS_POS = new Set(['MAP', 'MAPD'])
const MODES_WITH_DISCRETE_XY = new Set(['MAP', 'MAPD'])
const MODES_WITH_FIELD_VIEW = new Set(['MAP', 'MAPDP', 'MAPSV', 'MAPSVDP', 'SEM'])
const MODES_WITH_LINESCAN = new Set(['MAPSV', 'MAPSVDP', 'SEM'])
const SPUTTERING_MODES = new Set(['MAPDP', 'MAPSVDP', 'SDP', 'SDPSV'])
const SPUTTERING_TECHNIQUES = new Set([
  'SNMS energy spec', 'FABMS', 'FABMS energy spec',
  'ISS', 'SIMS', 'SIMS energy spec', 'SNMS',
])
const SPUTTER_SOURCE_MODES = new Set(['MAPDP', 'MAPSVDP', 'SDP', 'SDPSV'])
const SPUTTER_SOURCE_TECHNIQUES = new Set([
  'AES diff', 'AES dir', 'EDX', 'ELS', 'UPS', 'XRF',
])

interface VamasBlock {
  block_identifier?: string
  sample_identifier?: string
  date?: string
  time?: string
  comments?: string[]
  technique?: string
  analysis_source_label?: string
  source_energy?: number
  source_strength?: number
  beam_width_x?: number
  beam_width_y?: number
  polar_incidence?: number
  azimuth?: number
  analyzer_mode?: string
  pass_energy?: number
  magnification?: number
  work_function?: number
  target_bias?: number
  analysis_width_x?: number
  analysis_width_y?: number
  take_off_polar?: number
  take_off_azimuth?: number
  species_label?: string
  transition?: string
  charge?: number
  x_label?: string
  x_units?: string
  x_start?: number
  x_step?: number
  num_corresponding_variables?: number
  signal_mode?: string
  collection_time?: number
  num_scans?: number
  y_values: number[]
  n_points: number
}

interface VamasHeader {
  format_id: string
  institution?: string
  instrument?: string
  operator?: string
  experiment_id?: string
  comments: string[]
}

interface VamasParsed {
  header: VamasHeader
  blocks: VamasBlock[]
  num_blocks: number
}

class VamasCursor {
  private readonly lines: string[]
  private pos = 0

  constructor(text: string) {
    // Split on \r\n | \r | \n; drop trailing CR/LF handled by split regex.
    this.lines = text.split(/\r\n|\r|\n/)
  }

  nextLine(): string {
    if (this.pos >= this.lines.length) {
      throw new Error(`VAMAS: file ended prematurely at line ${this.pos}`)
    }
    return this.lines[this.pos++]
  }

  nextInt(): number {
    const s = this.nextLine().trim()
    const n = Number.parseInt(s, 10)
    if (!Number.isFinite(n)) {
      throw new Error(`VAMAS: expected integer, got ${JSON.stringify(s)}`)
    }
    return n
  }

  nextFloat(): number {
    // Fortran-style exponent notation uses D/d; JS Number() needs E/e.
    const s = this.nextLine().trim().replace(/D/g, 'E').replace(/d/g, 'e')
    const n = Number(s)
    if (!Number.isFinite(n)) {
      throw new Error(`VAMAS: expected float, got ${JSON.stringify(s)}`)
    }
    return n
  }
}

function parseVamasText(text: string): VamasParsed {
  const cur = new VamasCursor(text)

  const header: VamasHeader = {
    format_id: cur.nextLine(),
    comments: [],
  }
  if (!header.format_id.includes('VAMAS')) {
    throw new Error(`VAMAS: invalid format identifier: ${header.format_id}`)
  }
  header.institution = cur.nextLine()
  header.instrument = cur.nextLine()
  header.operator = cur.nextLine()
  header.experiment_id = cur.nextLine()

  const numComment = cur.nextInt()
  for (let i = 0; i < numComment; i++) header.comments.push(cur.nextLine())

  const expMode = cur.nextLine().trim()
  const scanMode = cur.nextLine().trim()

  if (MODES_WITH_SPECTRAL_REGIONS.has(expMode)) cur.nextInt()
  if (MODES_WITH_ANALYSIS_POS.has(expMode)) cur.nextInt()
  if (MODES_WITH_DISCRETE_XY.has(expMode)) {
    cur.nextInt()
    cur.nextInt()
  }

  const numExpVars = cur.nextInt()
  for (let i = 0; i < numExpVars; i++) {
    cur.nextLine() // label
    cur.nextLine() // unit
  }

  // block_params_includes — sign encodes default polarity.
  const numInclusion = cur.nextInt()
  const defaultInclude = numInclusion <= 0
  const blockIncludes = Array<boolean>(40).fill(defaultInclude)
  for (let i = 0; i < Math.abs(numInclusion); i++) {
    const idx = cur.nextInt()
    const slot = idx + 1
    if (slot >= 0 && slot < 40) blockIncludes[slot] = numInclusion > 0
  }

  cur.nextInt() // num_manually_entered
  const numFue = cur.nextInt()
  for (let i = 0; i < numFue; i++) {
    cur.nextLine()
    cur.nextLine()
  }
  const numFub = cur.nextInt()
  const numBlocks = cur.nextInt()

  const blocks: VamasBlock[] = []
  for (let bi = 0; bi < numBlocks; bi++) {
    const include = bi === 0 ? Array<boolean>(40).fill(true) : blockIncludes.slice()
    const fb: VamasBlock | null = bi > 0 ? blocks[0] : null
    const blk: VamasBlock = { y_values: [], n_points: 0 }

    blk.block_identifier = cur.nextLine()
    blk.sample_identifier = cur.nextLine()

    const date: number[] = []
    for (let i = 0; i < 6; i++) date.push(include[i] ? cur.nextInt() : 0)
    if (date[0] || date[1] || date[2]) {
      blk.date = `${pad(date[0], 4)}-${pad(date[1], 2)}-${pad(date[2], 2)}`
      blk.time = `${pad(date[3], 2)}:${pad(date[4], 2)}:${pad(date[5], 2)}`
    }
    if (include[6]) cur.nextFloat()
    if (include[7]) {
      const nbc = cur.nextInt()
      const cmts: string[] = []
      for (let i = 0; i < nbc; i++) cmts.push(cur.nextLine())
      if (cmts.length) blk.comments = cmts
    }

    if (include[8]) blk.technique = cur.nextLine().trim()
    else if (fb) blk.technique = fb.technique ?? ''
    const technique = blk.technique ?? ''

    if (MODES_WITH_ANALYSIS_POS.has(expMode) && include[9]) {
      cur.nextInt()
      cur.nextInt()
    }
    if (include[10]) {
      for (let i = 0; i < numExpVars; i++) cur.nextFloat()
    }
    if (include[11]) blk.analysis_source_label = cur.nextLine()

    const sputCond = SPUTTERING_MODES.has(expMode) || SPUTTERING_TECHNIQUES.has(technique)
    if (sputCond && include[12]) {
      cur.nextInt()
      cur.nextFloat()
      cur.nextFloat()
    }
    if (include[13]) blk.source_energy = cur.nextFloat()
    if (include[14]) blk.source_strength = cur.nextFloat()
    if (include[15]) {
      blk.beam_width_x = cur.nextFloat()
      blk.beam_width_y = cur.nextFloat()
    }
    if (MODES_WITH_FIELD_VIEW.has(expMode) && include[16]) {
      cur.nextFloat()
      cur.nextFloat()
    }
    if (MODES_WITH_LINESCAN.has(expMode) && include[17]) {
      for (let i = 0; i < 6; i++) cur.nextInt()
    }
    if (include[18]) blk.polar_incidence = cur.nextFloat()
    if (include[19]) blk.azimuth = cur.nextFloat()
    if (include[20]) blk.analyzer_mode = cur.nextLine()
    if (include[21]) blk.pass_energy = cur.nextFloat()
    if (technique === 'AES diff' && include[22]) cur.nextFloat()
    if (include[23]) blk.magnification = cur.nextFloat()
    if (include[24]) blk.work_function = cur.nextFloat()
    if (include[25]) blk.target_bias = cur.nextFloat()
    if (include[26]) {
      blk.analysis_width_x = cur.nextFloat()
      blk.analysis_width_y = cur.nextFloat()
    }
    if (include[27]) {
      blk.take_off_polar = cur.nextFloat()
      blk.take_off_azimuth = cur.nextFloat()
    }
    if (include[28]) blk.species_label = cur.nextLine()
    else if (fb) blk.species_label = fb.species_label ?? ''
    if (include[29]) {
      blk.transition = cur.nextLine()
      blk.charge = cur.nextInt()
    }

    if (scanMode === 'REGULAR') {
      if (include[30]) {
        blk.x_label = cur.nextLine()
        blk.x_units = cur.nextLine()
        blk.x_start = cur.nextFloat()
        blk.x_step = cur.nextFloat()
      } else if (fb) {
        blk.x_start = fb.x_start ?? 0
        blk.x_step = fb.x_step ?? 0
      }
    }

    if (include[31]) {
      const numCv = cur.nextInt()
      blk.num_corresponding_variables = numCv
      for (let i = 0; i < numCv; i++) {
        cur.nextLine() // label
        cur.nextLine() // unit
      }
    } else if (fb) {
      blk.num_corresponding_variables = fb.num_corresponding_variables ?? 1
    }
    if (include[32]) blk.signal_mode = cur.nextLine()
    if (include[33]) blk.collection_time = cur.nextFloat()
    if (include[34]) blk.num_scans = cur.nextInt()
    if (include[35]) cur.nextFloat()

    const sputterSrc = SPUTTER_SOURCE_MODES.has(expMode) && SPUTTER_SOURCE_TECHNIQUES.has(technique)
    if (sputterSrc && include[36]) {
      for (let i = 0; i < 7; i++) cur.nextLine()
    }
    if (include[37]) {
      cur.nextFloat()
      cur.nextFloat()
    }
    if (include[38]) cur.nextFloat()
    if (include[39]) {
      const nap = cur.nextInt()
      for (let i = 0; i < nap; i++) {
        cur.nextLine()
        cur.nextLine()
        cur.nextFloat()
      }
    }

    for (let i = 0; i < numFub; i++) {
      cur.nextLine()
      cur.nextLine()
    }

    const numY = cur.nextInt()
    const numCv = blk.num_corresponding_variables ?? 1
    for (let i = 0; i < numCv; i++) {
      cur.nextFloat() // y_min
      cur.nextFloat() // y_max
    }
    const nPoints = numCv > 0 ? Math.floor(numY / numCv) : numY
    const cvData: number[][] = Array.from({ length: numCv }, () => [])
    for (let i = 0; i < nPoints; i++) {
      for (let c = 0; c < numCv; c++) cvData[c].push(cur.nextFloat())
    }
    blk.y_values = cvData[0] ?? []
    blk.n_points = nPoints
    blocks.push(blk)
  }

  return { header, blocks, num_blocks: numBlocks }
}

function pad(n: number, width: number): string {
  const s = String(Math.abs(Math.trunc(n)))
  return s.length >= width ? s : '0'.repeat(width - s.length) + s
}

function pickTechnique(blockTechnique: string, xUnits: string): SpectroscopyTechnique {
  const t = blockTechnique.toLowerCase()
  if (t.includes('xps') || t === 'esca') return 'XPS'
  if (t.includes('aes') || t === 'ups' || t === 'iss' || t === 'sims') return 'Curve'
  if (/binding.?energy|kinetic.?energy|\bev\b/i.test(`${blockTechnique} ${xUnits}`)) return 'XPS'
  return 'XPS' // VAMAS default — primarily used for XPS
}

function formatUnits(axis: string, units: string): string {
  const a = axis.trim()
  const u = units.trim()
  if (!a && !u) return ''
  if (!u) return a
  if (!a) return u
  return `${a} (${u})`
}

export function parseVamas(text: string, sourceFile: string): ParsedSpectrum | null {
  let parsed: VamasParsed
  try {
    parsed = parseVamasText(text)
  } catch (err) {
    // Surface the real cursor-level error to devtools — the workspace
    // editor otherwise just shows a generic "Could not parse" placeholder,
    // which makes VAMAS edge cases (non-standard `charge`, Fortran-D
    // exponents the regex missed, stray blank lines between blocks) look
    // like mysterious silent failures.
    console.warn(
      `[vamas-parser] failed to parse ${sourceFile}:`,
      err instanceof Error ? err.message : err,
    )
    return null
  }
  const blk = parsed.blocks[0]
  if (!blk || blk.n_points < 2 || blk.y_values.length < 2) return null

  const xStart = blk.x_start ?? 0
  const xStep = blk.x_step ?? 1
  const n = blk.n_points
  const x = Array.from({ length: n }, (_, i) => xStart + xStep * i)
  const y = blk.y_values.slice(0, n)

  const technique = pickTechnique(blk.technique ?? '', blk.x_units ?? '')
  const xLabel = formatUnits(blk.x_label ?? '', blk.x_units ?? '') ||
    (technique === 'XPS' ? 'Binding Energy (eV)' : 'X')
  const yLabel = technique === 'XPS' ? 'CPS' : 'Intensity'

  const hdr = parsed.header
  const notSpec = (v: string | undefined) =>
    v && v.trim() !== '' && v.trim() !== 'Not Specified' && v.trim().toLowerCase() !== 'not specified'

  return {
    x,
    y,
    xLabel,
    yLabel,
    technique,
    metadata: {
      instrument: notSpec(hdr.instrument) ? hdr.instrument : undefined,
      date: blk.date,
      sampleName: notSpec(blk.sample_identifier) ? blk.sample_identifier : undefined,
      sourceFile,
      format: 'VAMAS',
    },
  }
}
