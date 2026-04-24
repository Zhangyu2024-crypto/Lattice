// Instrument profile catalog, copied verbatim from pro.html lines 1386–1433
// (the `<select id="r-inst">` options). These strings are the exact values
// the backend Rietveld handler expects — do NOT rename.

export interface InstrumentProfileOption {
  value: string
  label: string
  group?: string
}

export const INSTRUMENT_PROFILES: InstrumentProfileOption[] = [
  { value: '', label: 'Auto (Aeris Pixcel1d)' },
  // PANalytical / Malvern
  { group: 'PANalytical / Malvern', value: 'Aeris-fds-Pixcel1d-Medipix3', label: 'Aeris Pixcel1d Medipix3' },
  { group: 'PANalytical / Malvern', value: 'PW3040-FDS-ADS-Xcelerator', label: "PW3040 X'Celerator" },
  { group: 'PANalytical / Malvern', value: 'xpert-pixcel-0500', label: "X'Pert Pixcel" },
  { group: 'PANalytical / Malvern', value: 'xpert-xcel-fds-0250', label: "X'Pert X'Cel FDS 0.25" },
  { group: 'PANalytical / Malvern', value: 'xpert-xcel-fds-1000', label: "X'Pert X'Cel FDS 1.0" },
  { group: 'PANalytical / Malvern', value: 'xpert-xcel-ads-10mm', label: "X'Pert X'Cel ADS 10mm" },
  { group: 'PANalytical / Malvern', value: 'xpert-xcel-ads-10mm-Ge', label: "X'Pert X'Cel ADS 10mm Ge" },
  { group: 'PANalytical / Malvern', value: 'xpert-xcel-htk-fds-0125', label: "X'Pert X'Cel HTK FDS" },
  { group: 'PANalytical / Malvern', value: 'cubix-ads-10mm', label: 'Cubix ADS 10mm' },
  { group: 'PANalytical / Malvern', value: 'cubix-ads-15mm', label: 'Cubix ADS 15mm' },
  // Bruker
  { group: 'Bruker', value: 'D8_6Div_4SS', label: 'D8 6Div 4SS' },
  { group: 'Bruker', value: 'd8-lynxeye-fds-02', label: 'D8 LynxEye FDS 0.2' },
  { group: 'Bruker', value: 'd8-lynxeye-fds-05mm', label: 'D8 LynxEye FDS 0.5mm' },
  { group: 'Bruker', value: 'd8-lynxeye-fds-06mm', label: 'D8 LynxEye FDS 0.6mm' },
  { group: 'Bruker', value: 'd8-lynxeye-ads-1mm', label: 'D8 LynxEye ADS 1mm' },
  { group: 'Bruker', value: 'd8-fds-02-LynxEyeXE', label: 'D8 FDS 0.2 LynxEye XE' },
  { group: 'Bruker', value: 'LBL-d8-LynxEyeXE', label: 'LBL D8 LynxEye XE' },
  { group: 'Bruker', value: 'RMS-D8-FDS-03-LynxEyeXE', label: 'RMS D8 FDS 0.3 LynxEye XE' },
  { group: 'Bruker', value: 'RMS-D8-ADS-15-LynxEyeXE', label: 'RMS D8 ADS 15 LynxEye XE' },
  { group: 'Bruker', value: 'RMS-D8-ADS-15-Glass-LynxEyeXE', label: 'RMS D8 ADS 15 Glass LynxEye XE' },
  { group: 'Bruker', value: 'RMS-D8-Capillary-500um-LynxEyeXE', label: 'RMS D8 Capillary 500um' },
  { group: 'Bruker', value: 'd8-solxe-fds-0600', label: 'D8 Sol-XE FDS 0.6' },
  { group: 'Bruker', value: 'd8-solxe-vds-12mm', label: 'D8 Sol-XE VDS 12mm' },
  { group: 'Bruker', value: 'd2-ssd160-fds-1', label: 'D2 SSD160 FDS 1' },
  // Rigaku
  { group: 'Rigaku', value: 'Rigaku-Miniflex', label: 'Rigaku MiniFlex' },
  { group: 'Rigaku', value: 'Rigaku-Miniflex-600-DTEXultra2-fds', label: 'MiniFlex 600 D/teX Ultra2' },
  { group: 'Rigaku', value: 'Rigaku-Miniflex-gen5-Dtex-var', label: 'MiniFlex Gen5 D/teX var' },
  { group: 'Rigaku', value: 'Rigaku-SmartLab-CBO-BB-FDS05deg', label: 'SmartLab CBO BB FDS 0.5' },
  { group: 'Rigaku', value: 'rigaku-ultima', label: 'Rigaku Ultima' },
  // Siemens
  { group: 'Siemens', value: 'siemens-d5000-fds1mm', label: 'D5000 FDS 1mm' },
  { group: 'Siemens', value: 'siemens-d5000-fds2mm', label: 'D5000 FDS 2mm' },
  // Other
  { group: 'Other', value: 'pw1800-fds', label: 'PW1800 FDS' },
  { group: 'Other', value: 'pw1800-ads-10mm', label: 'PW1800 ADS 10mm' },
  { group: 'Other', value: 'synchrotron', label: 'Synchrotron' },
  { group: 'Other', value: 'ucb-xrdynamic500-anton-paar', label: 'XRDynamic 500 Anton Paar' },
  { group: 'Other', value: 'x8-apex2-fds-10', label: 'X8 APEX2 FDS 10' },
]

export const WAVELENGTH_TO_ANGSTROM: Record<string, number> = {
  Cu: 1.5406,
  Mo: 0.7107,
  Co: 1.7889,
  Fe: 1.9373,
  Cr: 2.2909,
  Ag: 0.5594,
}

/**
 * Approximate instrumental FWHM (in degrees) for each profile, used to
 * pre-seed the Scherrer section's `instrumentalFwhm` input when the user
 * picks an instrument. Numbers are order-of-magnitude — a real lab should
 * calibrate against a LaB6 standard and override — but they give pros a
 * sane starting point instead of the generic 0.1° default.
 *
 * Synchrotron → very narrow (~0.02°). Standard lab Bragg-Brentano → 0.08°.
 * Legacy diffractometers with wide slits → ~0.15°. Capillary / transmission
 * → 0.04°.
 */
export const DEFAULT_INSTRUMENTAL_FWHM: Record<string, number> = {
  'Aeris-fds-Pixcel1d-Medipix3': 0.07,
  'PW3040-FDS-ADS-Xcelerator': 0.08,
  'xpert-pixcel-0500': 0.08,
  'xpert-xcel-fds-0250': 0.06,
  'xpert-xcel-fds-1000': 0.10,
  'xpert-xcel-ads-10mm': 0.10,
  'xpert-xcel-ads-10mm-Ge': 0.10,
  'xpert-xcel-htk-fds-0125': 0.06,
  'cubix-ads-10mm': 0.10,
  'cubix-ads-15mm': 0.12,
  D8_6Div_4SS: 0.10,
  'd8-lynxeye-fds-02': 0.07,
  'd8-lynxeye-fds-05mm': 0.09,
  'd8-lynxeye-fds-06mm': 0.10,
  'd8-lynxeye-ads-1mm': 0.09,
  'd8-fds-02-LynxEyeXE': 0.06,
  'LBL-d8-LynxEyeXE': 0.07,
  'RMS-D8-FDS-03-LynxEyeXE': 0.07,
  'RMS-D8-ADS-15-LynxEyeXE': 0.10,
  'RMS-D8-ADS-15-Glass-LynxEyeXE': 0.11,
  'RMS-D8-Capillary-500um-LynxEyeXE': 0.04,
  'd8-solxe-fds-0600': 0.10,
  'd8-solxe-vds-12mm': 0.12,
  'd2-ssd160-fds-1': 0.12,
  'Rigaku-Miniflex': 0.12,
  'Rigaku-Miniflex-600-DTEXultra2-fds': 0.10,
  'Rigaku-Miniflex-gen5-Dtex-var': 0.10,
  'Rigaku-SmartLab-CBO-BB-FDS05deg': 0.08,
  'rigaku-ultima': 0.10,
  'siemens-d5000-fds1mm': 0.12,
  'siemens-d5000-fds2mm': 0.14,
  'pw1800-fds': 0.13,
  'pw1800-ads-10mm': 0.14,
  synchrotron: 0.02,
  'ucb-xrdynamic500-anton-paar': 0.08,
  'x8-apex2-fds-10': 0.12,
}

/**
 * Scherrer equation — L = K·λ / (β·cos θ) where β is FWHM in radians,
 * θ is half the peak 2θ in radians. Returns crystallite size in nm.
 */
export function scherrerSize(
  k: number,
  wavelengthAngstrom: number,
  twoThetaDeg: number,
  fwhmDeg: number,
): number {
  if (!Number.isFinite(fwhmDeg) || fwhmDeg <= 0) return 0
  const theta = (twoThetaDeg * Math.PI) / 180 / 2
  const beta = (fwhmDeg * Math.PI) / 180
  const L = (k * wavelengthAngstrom) / (beta * Math.cos(theta))
  return L / 10 // angstrom to nm
}

/**
 * Subtract instrumental broadening in quadrature: β_sample² = β_obs² − β_inst².
 * Returns 0 if the observed width is narrower than the instrument (i.e. the
 * peak is instrument-limited and Scherrer doesn't apply). Inputs / outputs
 * are both in degrees.
 */
export function deconvolveInstrumentalFwhm(
  fwhmObservedDeg: number,
  fwhmInstrumentDeg: number,
): number {
  if (!Number.isFinite(fwhmObservedDeg) || fwhmObservedDeg <= 0) return 0
  const inst = Number.isFinite(fwhmInstrumentDeg)
    ? Math.max(0, fwhmInstrumentDeg)
    : 0
  const diffSq = fwhmObservedDeg * fwhmObservedDeg - inst * inst
  if (diffSq <= 0) return 0
  return Math.sqrt(diffSq)
}
