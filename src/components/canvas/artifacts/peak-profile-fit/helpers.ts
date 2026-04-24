// Helpers for the pseudo-Voigt peak profile fitter.
//
// `sliceAround` returns the subset of the spectrum within ±halfWindow of
// a centre position. The loop relies on the caller's x array being
// monotonically increasing (true for every XRD spectrum we accept) so we
// can `break` as soon as we pass xMax instead of scanning the whole
// array — keeps the modal snappy on wide diffractograms.

export function sliceAround(
  spectrum: { x: number[]; y: number[] },
  center: number,
  halfWindow: number,
): { x: number[]; y: number[] } {
  const xMin = center - halfWindow
  const xMax = center + halfWindow
  const x: number[] = []
  const y: number[] = []
  for (let i = 0; i < spectrum.x.length; i++) {
    const xi = spectrum.x[i]
    if (xi < xMin) continue
    if (xi > xMax) break
    x.push(xi)
    y.push(spectrum.y[i])
  }
  return { x, y }
}
