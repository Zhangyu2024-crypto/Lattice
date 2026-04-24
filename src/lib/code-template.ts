// Per-kind Python code templates used by the "Open in Code" action.
//
// Each template is a complete, runnable Python script that:
//   1. Declares the parent artifact's payload via a base64-encoded JSON blob
//      (escape-safe for any content, including UTF-8 labels and backslashes)
//   2. Imports numpy + matplotlib + base64 + json — the minimum common set
//   3. Renders a kind-specific quick-look plot the user can immediately run
//   4. Leaves commented example transforms below for the user to uncomment
//
// The header is shared across all kinds; only the "body" differs.

import type { Artifact } from '../types/artifact'

export interface CodeTemplate {
  /** Complete Python source ready to drop into a ComputeArtifact's `code` field. */
  code: string
  /** Title for the new Compute artifact. */
  baseTitle: string
}

const CODE_TEMPLATE_KINDS: ReadonlySet<Artifact['kind']> = new Set([
  'spectrum',
  'peak-fit',
  'xrd-analysis',
  'xps-analysis',
  'raman-id',
  'structure',
  'optimization',
])

/** Returns true if the "Open in Code" menu entry should be enabled. */
export function isCodeTemplateSupported(kind: Artifact['kind']): boolean {
  return CODE_TEMPLATE_KINDS.has(kind)
}

/** Returns null for unsupported kinds. */
export function buildCodeTemplate(source: Artifact): CodeTemplate | null {
  if (!isCodeTemplateSupported(source.kind)) return null

  const payloadJson = JSON.stringify(source.payload)
  const payloadB64 = utf8ToBase64(payloadJson)
  const header = buildHeader(source, payloadB64)
  const body = BODIES[source.kind as BodyKind]
  return {
    code: `${header}\n${body}`,
    baseTitle: `Code: ${source.title}`,
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────

// `btoa` alone only handles Latin-1; artifact titles / labels may contain
// Greek letters, Å, µ, etc. Go through TextEncoder for a UTF-8-safe path.
function utf8ToBase64(s: string): string {
  const bytes = new TextEncoder().encode(s)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

function wrapBase64(b64: string, width = 76): string {
  const lines: string[] = []
  for (let i = 0; i < b64.length; i += width) {
    lines.push(b64.slice(i, i + width))
  }
  return lines.join('\n')
}

// Triple-quotes or unescaped newlines in a title would close the docstring
// prematurely; replace them. The title is presentational, not parsed.
function sanitizeForDocstring(s: string): string {
  return s.replace(/"""/g, "'''").replace(/[\r\n]+/g, ' ')
}

function buildHeader(source: Artifact, payloadB64: string): string {
  const generated = new Date().toISOString()
  const wrapped = wrapBase64(payloadB64)
  const safeTitle = sanitizeForDocstring(source.title)
  return `"""
Code environment for: ${safeTitle}
Source kind: ${source.kind}
Source id:   ${source.id}
Generated:   ${generated}

The parent artifact's payload is embedded below as base64 JSON. Edit freely —
running this code does NOT modify the source artifact. If you want a fresh
snapshot later, re-click "Open in Code" on the source.
"""
import base64
import json
import numpy as np
import matplotlib.pyplot as plt

_PAYLOAD_B64 = """
${wrapped}
"""
payload = json.loads(base64.b64decode(_PAYLOAD_B64).decode("utf-8"))
print("payload keys:", list(payload.keys()))
`
}

// ─── Per-kind bodies ────────────────────────────────────────────────────

type BodyKind =
  | 'spectrum'
  | 'peak-fit'
  | 'xrd-analysis'
  | 'xps-analysis'
  | 'raman-id'
  | 'structure'
  | 'optimization'

const SPECTRUM_BODY = `# ─── Spectrum quick look ────────────────────────────────────────
x = np.array(payload["x"])
y = np.array(payload["y"])

fig, ax = plt.subplots(figsize=(9, 4))
ax.plot(x, y, linewidth=1)
ax.set_xlabel(payload.get("xLabel", "x"))
ax.set_ylabel(payload.get("yLabel", "y"))
ax.set_title("Spectrum")
plt.show()

print(f"Points: {len(x)}  range: {x.min():.3f} to {x.max():.3f}")

# ─── Example: Savitzky-Golay smoothing + linear baseline ────────
# from scipy.signal import savgol_filter
# window = max(5, (len(y) // 50) | 1)  # odd window
# smoothed = savgol_filter(y, window_length=window, polyorder=3)
# baseline = np.linspace(smoothed[0], smoothed[-1], len(smoothed))
# corrected = smoothed - baseline
# plt.figure(figsize=(9, 4))
# plt.plot(x, corrected, linewidth=1)
# plt.title("Baseline-corrected")
# plt.show()
`

const PEAK_FIT_BODY = `# ─── Peak fit inspection ────────────────────────────────────────
peaks = payload["peaks"]
print(f"Algorithm: {payload.get('algorithm', 'unknown')}")
print(f"Peaks: {len(peaks)}")
for p in peaks:
    fwhm_val = p.get("fwhm") if p.get("fwhm") is not None else float("nan")
    print(
        f"  {p.get('label', '?'):10s} pos={p['position']:.3f}  "
        f"int={p['intensity']:.3f}  fwhm={fwhm_val:.3f}"
    )

# ─── Reconstruct a Gaussian-sum model ───────────────────────────
def gaussian(xx, mu, amp, sigma):
    return amp * np.exp(-0.5 * ((xx - mu) / sigma) ** 2)

if peaks:
    positions = np.array([p["position"] for p in peaks], dtype=float)
    intensities = np.array([p["intensity"] for p in peaks], dtype=float)
    fwhms = np.array(
        [p.get("fwhm") if p.get("fwhm") is not None else 5.0 for p in peaks],
        dtype=float,
    )
    sigmas = fwhms / (2.0 * np.sqrt(2.0 * np.log(2.0)))

    xfit = np.linspace(positions.min() - 30, positions.max() + 30, 2000)
    yfit = np.zeros_like(xfit)
    for mu, amp, sigma in zip(positions, intensities, sigmas):
        yfit += gaussian(xfit, mu, amp, sigma)

    fig, ax = plt.subplots(figsize=(9, 4))
    ax.plot(xfit, yfit, color="tab:blue", linewidth=1.2, label="Σ Gaussian")
    ax.scatter(positions, intensities, color="crimson", zorder=5, label="peak centres")
    for p in peaks:
        ax.annotate(
            p.get("label", ""),
            (p["position"], p["intensity"]),
            textcoords="offset points",
            xytext=(0, 4),
            fontsize=8,
        )
    ax.set_xlabel("Position")
    ax.set_ylabel("Intensity")
    ax.set_title("Reconstructed Gaussian sum")
    ax.legend(fontsize=9)
    plt.show()

# Example: swap Gaussian for pseudo-Voigt
# def pseudo_voigt(xx, mu, amp, fwhm, eta=0.5):
#     sigma = fwhm / (2 * np.sqrt(2 * np.log(2)))
#     gamma = fwhm / 2
#     gauss = np.exp(-0.5 * ((xx - mu) / sigma) ** 2)
#     lor   = 1 / (1 + ((xx - mu) / gamma) ** 2)
#     return amp * (eta * lor + (1 - eta) * gauss)
`

const XRD_BODY = `# ─── XRD analysis ───────────────────────────────────────────────
exp = payload["experimentalPattern"]
phases = payload.get("phases", [])
rietveld = payload.get("rietveld")

x = np.array(exp["x"])
y = np.array(exp["y"])

fig, ax = plt.subplots(figsize=(10, 5))
ax.plot(x, y, color="black", linewidth=1.2, label="experimental")
for ph in phases:
    tp = ph.get("theoreticalPattern")
    if tp:
        ax.plot(
            tp["x"], tp["y"], alpha=0.75,
            label=f"{ph['name']} ({ph.get('formula', '')})",
        )
ax.set_xlabel(exp.get("xLabel", "2θ (degrees)"))
ax.set_ylabel(exp.get("yLabel", "Intensity"))
ax.set_title("XRD pattern + matched phases")
if phases:
    ax.legend(fontsize=9)
plt.show()

print()
print("Phases:")
for ph in phases:
    wf = ph.get("weightFraction")
    wf_str = f"{wf * 100:5.1f}%" if wf is not None else "   —  "
    print(f"  {ph['name']:20s} conf={ph['confidence']:.2f}  wf={wf_str}")

if rietveld:
    print()
    print(
        f"Rietveld: Rwp={rietveld['rwp']:.2f}  GoF={rietveld['gof']:.2f}  "
        f"converged={rietveld['converged']}"
    )

# ─── Example: integrate a peak window ───────────────────────────
# mask = (x > 31.0) & (x < 32.5)
# area = np.trapezoid(y[mask], x[mask]) if mask.any() else 0.0
# print(f"Area under 31–32.5°: {area:.2f}")
`

const XPS_BODY = `# ─── XPS fits ───────────────────────────────────────────────────
fits = payload.get("fits", [])
quant = payload.get("quantification", [])
charge = payload.get("chargeCorrection")

for fit in fits:
    exp_p = fit["experimentalPattern"]
    mod_p = fit["modelPattern"]
    fig, ax = plt.subplots(figsize=(8, 4))
    ax.plot(exp_p["x"], exp_p["y"], color="black", linewidth=1, label="exp")
    ax.plot(mod_p["x"], mod_p["y"], color="crimson", linewidth=1, label="model")
    for p in fit.get("peaks", []):
        ax.axvline(p["binding"], color="tab:blue", alpha=0.35, linewidth=0.8)
    ax.invert_xaxis()
    ax.set_xlabel("Binding energy (eV)")
    ax.set_ylabel("Intensity")
    ax.set_title(f"{fit['element']} {fit['line']} (bg={fit['background']})")
    ax.legend(fontsize=9)
    plt.show()

print()
print("Quantification (at%):")
for q in quant:
    print(
        f"  {q['element']:6s} {q['atomicPercent']:5.2f}  "
        f"RSF={q['relativeSensitivity']:.3f}"
    )

if charge:
    print()
    print(
        f"Charge correction: ref {charge['refElement']} {charge['refLine']}  "
        f"expected={charge['refBE']:.2f}  observed={charge['observedBE']:.2f}  "
        f"shift={charge['shift']:+.2f} eV"
    )

# ─── Example: re-integrate residuals ────────────────────────────
# for fit in fits:
#     r = np.array(fit["residuals"])
#     print(f"{fit['element']} {fit['line']}  rms_residual={np.sqrt((r**2).mean()):.3f}")
`

const RAMAN_BODY = `# ─── Raman identification ───────────────────────────────────────
exp = payload["experimentalSpectrum"]
matches = payload.get("matches", [])
query = payload.get("query", {})

xe = np.array(exp["x"])
ye = np.array(exp["y"])

fig, ax = plt.subplots(figsize=(10, 5))
ax.plot(xe, ye, color="black", linewidth=1.2, label="experimental")
for m in matches[:3]:
    r = m["referenceSpectrum"]
    ax.plot(
        r["x"], r["y"], alpha=0.75,
        label=f"{m['mineralName']}  score={m['cosineScore']:.3f}",
    )
ax.set_xlabel(exp.get("xLabel", "Raman shift (cm⁻¹)"))
ax.set_ylabel(exp.get("yLabel", "Intensity"))
ax.set_title("Raman: experimental vs top matches")
ax.legend(fontsize=9)
plt.show()

print()
print(f"Query source: {query.get('source', '?')}  topN={query.get('topN', '?')}")
for i, m in enumerate(matches[: query.get("topN", len(matches))], start=1):
    print(
        f"  {i:2d}. {m['mineralName']:20s} {m.get('formula',''):14s}  "
        f"cos={m['cosineScore']:.3f}"
    )

# ─── Example: rescore by Pearson correlation ────────────────────
# from numpy import corrcoef
# for m in matches:
#     r = m["referenceSpectrum"]
#     rx, ry = np.array(r["x"]), np.array(r["y"])
#     y_interp = np.interp(rx, xe, ye)
#     rho = corrcoef(y_interp, ry)[0, 1]
#     print(f"{m['mineralName']:20s} pearson={rho:.3f}")
`

const STRUCTURE_BODY = `# ─── Structure ──────────────────────────────────────────────────
CIF = payload["cif"]
LATTICE = payload["latticeParams"]

print(f"Formula:     {payload.get('formula', '?')}")
print(f"Space group: {payload.get('spaceGroup', '?')}")
print(
    f"Lattice:     a={LATTICE['a']:.4f}  b={LATTICE['b']:.4f}  c={LATTICE['c']:.4f}"
)
print(
    f"             α={LATTICE['alpha']:.2f}  β={LATTICE['beta']:.2f}  γ={LATTICE['gamma']:.2f}"
)

transforms = payload.get("transforms", [])
if transforms:
    print()
    print("Transform history:")
    for t in transforms:
        print(f"  - {t['kind']:10s} {t.get('note', '')}")

# ─── Parse with pymatgen if available ───────────────────────────
try:
    from pymatgen.core import Structure
    s = Structure.from_str(CIF, fmt="cif")
    print()
    print(s)
    print(f"Density: {s.density:.3f} g/cm³")
    print(f"Volume:  {s.volume:.3f} Å³")
except ImportError:
    print()
    print("pymatgen not installed in this image. Pull one that has it, or")
    print("install inside the image before running. Example:")
    print("  docker pull latticeapp/python-compute")

# ─── Example: dump the first few atoms' Cartesian positions ─────
# if "Structure" in dir():
#     for site in s.sites[:5]:
#         print(site.species_string, site.coords)
`

const OPTIMIZATION_BODY = `# ─── Optimization ───────────────────────────────────────────────
# Optimization payloads are currently opaque — the template prints a preview
# and makes a best-effort trials plot if the schema matches common shapes.

print(json.dumps(payload, indent=2, default=str)[:1200])

trials = payload.get("trials")
if trials is None and isinstance(payload.get("data"), dict):
    trials = payload["data"].get("trials")

if trials:
    objs = [t.get("objective") for t in trials if t.get("objective") is not None]
    if objs:
        fig, ax = plt.subplots(figsize=(8, 4))
        ax.plot(objs, marker="o", linewidth=1.2)
        ax.set_xlabel("Trial")
        ax.set_ylabel("Objective")
        ax.set_title("Optimization progress")
        plt.show()

        best_idx = int(np.argmin(objs))
        print()
        print(f"Best trial: index {best_idx}  objective={objs[best_idx]:.4f}")

# ─── Example: per-parameter sensitivity scan ────────────────────
# if trials:
#     params = {k for t in trials for k in (t.get("params") or {})}
#     for key in sorted(params):
#         vals = [(t["params"].get(key), t.get("objective"))
#                 for t in trials if t.get("params") and key in t["params"]]
#         if vals:
#             xs, ys = zip(*vals)
#             plt.scatter(xs, ys, s=8)
#             plt.xlabel(key); plt.ylabel("objective")
#             plt.title(key); plt.show()
`

const BODIES: Record<BodyKind, string> = {
  'spectrum': SPECTRUM_BODY,
  'peak-fit': PEAK_FIT_BODY,
  'xrd-analysis': XRD_BODY,
  'xps-analysis': XPS_BODY,
  'raman-id': RAMAN_BODY,
  'structure': STRUCTURE_BODY,
  'optimization': OPTIMIZATION_BODY,
}
