// Reference Intensity Ratio (RIR) table for quantitative phase analysis
// (QPA). Values are normalised to corundum Al₂O₃ = 1.00 and come from
// the ICDD PDF-4+ published conventions; they're widely tabulated and
// stable within ±10% across sources. Labs that need tighter accuracy
// should calibrate against an internal standard and override — but this
// table gives a sane starting point for the RIR-corrected wt%.
//
// Formula keys are ASCII (Fe2O3, not Fe₂O₃) so the runtime lookup is a
// plain Record[key] lookup; helper lowercases + strips whitespace before
// matching so casing / spacing differences between phase labels don't
// break the join.

export const XRD_RIR_TABLE: Record<string, number> = {
  // Corundum is the reference; all other values are ratios of I/I_c.
  al2o3: 1.00,
  sio2: 3.37, // α-quartz
  tio2: 3.4, // rutile (anatase is ~3.3)
  'tio2-anatase': 3.3,
  fe2o3: 2.6, // hematite
  fe3o4: 4.7, // magnetite
  feo: 3.0, // wüstite
  zno: 5.4,
  cuo: 4.8,
  nio: 5.1,
  mno2: 3.5, // pyrolusite
  mgo: 2.5, // periclase
  cao: 2.7, // lime
  caco3: 2.0, // calcite
  camg: 2.05, // dolomite (CaMg(CO3)2 simplified)
  ceo2: 13.5,
  zro2: 14.5, // monoclinic baddeleyite
  sno2: 7.2, // cassiterite
  nacl: 4.5, // halite
  kcl: 6.4, // sylvite
  cacl2: 3.4,
  al: 4.0, // aluminium metal (strong-scatterer)
  fe: 10.0, // α-iron
  cu: 8.0, // copper metal
  ag: 10.5,
  au: 15.0,
  c: 0.4, // graphite (weak scatterer)
}

/**
 * Normalise a phase-formula string down to the RIR-table key. Strips
 * whitespace, lowercases, and drops trailing parenthetical phase
 * qualifiers like "(rutile)" that would otherwise prevent a match.
 */
export function formulaToRirKey(formula: string | undefined | null): string {
  if (!formula) return ''
  return formula
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/\([^)]*\)$/, '') // trailing "(rutile)" etc.
}

/**
 * Look up the RIR for a phase formula, or return `null` when the formula
 * is missing from the table. Callers typically render "—" in the UI when
 * this returns null so the user can see which phases lack data.
 */
export function lookupRir(formula: string | undefined | null): number | null {
  const key = formulaToRirKey(formula)
  if (!key) return null
  return XRD_RIR_TABLE[key] ?? null
}

export interface PhaseWeight {
  formula?: string
  phase_name?: string
  weight_pct?: number
}

export interface RirCorrectedPhase {
  formula?: string
  phase_name?: string
  weightPct?: number
  /** The RIR value used, or `null` if the phase has no entry. */
  rir: number | null
  /** RIR-corrected weight fraction as a percentage. `null` when the phase
   *  lacked an RIR entry — the caller should render an em-dash instead
   *  of treating it as zero. */
  correctedPct: number | null
}

/**
 * Apply RIR correction to a list of phase weights. Formula:
 *   w_corr_i = (w_i / RIR_i) / Σ(w_j / RIR_j)
 *
 * Only phases that have both a positive `weight_pct` and a non-null RIR
 * contribute to the normalisation denominator. Phases missing an RIR
 * entry return `correctedPct: null` — they're shown in the UI as
 * em-dashes rather than silently zeroed out.
 */
export function applyRirCorrection(
  phases: PhaseWeight[],
): RirCorrectedPhase[] {
  const lookups = phases.map((p) => ({
    phase: p,
    rir: lookupRir(p.formula),
  }))
  const contributing = lookups.filter(
    (l) =>
      l.rir != null &&
      l.rir > 0 &&
      typeof l.phase.weight_pct === 'number' &&
      l.phase.weight_pct > 0,
  )
  const denom = contributing.reduce(
    (s, l) => s + (l.phase.weight_pct as number) / (l.rir as number),
    0,
  )
  return lookups.map(({ phase, rir }) => {
    if (rir == null || rir <= 0) {
      return {
        formula: phase.formula,
        phase_name: phase.phase_name,
        weightPct: phase.weight_pct,
        rir,
        correctedPct: null,
      }
    }
    if (typeof phase.weight_pct !== 'number' || phase.weight_pct <= 0) {
      return {
        formula: phase.formula,
        phase_name: phase.phase_name,
        weightPct: phase.weight_pct,
        rir,
        correctedPct: 0,
      }
    }
    if (denom <= 0) {
      return {
        formula: phase.formula,
        phase_name: phase.phase_name,
        weightPct: phase.weight_pct,
        rir,
        correctedPct: null,
      }
    }
    return {
      formula: phase.formula,
      phase_name: phase.phase_name,
      weightPct: phase.weight_pct,
      rir,
      correctedPct: (phase.weight_pct / rir / denom) * 100,
    }
  })
}
