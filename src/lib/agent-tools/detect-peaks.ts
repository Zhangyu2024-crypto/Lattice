import { localProSpectrum } from '../local-pro-spectrum'
import type { LocalTool } from '../../types/agent-tool'
import type { XrdProPeak } from '../../types/artifact'
import {
  requireSpectrum,
  resolveWorkbench,
  summarizePeaks,
} from './workbench-shared'

interface Input {
  artifactId?: string
  topK?: number
  prominenceMult?: number
  xMin?: number
  xMax?: number
}

interface Output {
  artifactId: string
  peaks: XrdProPeak[]
  summary: string
}

export const detectPeaksTool: LocalTool<Input, Output> = {
  name: 'detect_peaks',
  description:
    'Detect peaks on a Pro workbench spectrum (XRD / XPS / Raman) using prominence + topK heuristics. Returns editable peak proposals; approved peaks are written into the workbench payload (`peaks` for XRD/Raman, `detectedPeaks` for XPS). Uses focused artifact by default.',
  trustLevel: 'localWrite',
  // Phase α pilot — pause the loop after detection so the user can trim
  // spurious peaks / edit positions before the next LLM turn sees them.
  approvalPolicy: 'require',
  // Phase ε — the unified AgentCard renders an editor for this tool.
  // Kept alongside `approvalPolicy` during the transition so both the
  // legacy gate and the new cardMode path agree.
  cardMode: 'edit',
  inputSchema: {
    type: 'object',
    properties: {
      artifactId: { type: 'string', description: 'Workbench artifact id (optional).' },
      topK: { type: 'number', description: 'Max number of peaks to keep. Default ~20.' },
      prominenceMult: {
        type: 'number',
        description: 'Prominence multiplier — higher = stricter. Defaults to the workbench setting.',
      },
      xMin: { type: 'number', description: 'Lower x bound (optional).' },
      xMax: { type: 'number', description: 'Upper x bound (optional).' },
    },
  },
  async execute(input, ctx) {
    const { artifact, kind } = resolveWorkbench(ctx.sessionId, input?.artifactId)
    const spectrum = requireSpectrum(artifact)
    const res = await localProSpectrum.detectPeaks(spectrum, {
      topk: input?.topK,
      prominence_mult: input?.prominenceMult,
      x_min: input?.xMin ?? null,
      x_max: input?.xMax ?? null,
    })
    if (!res.success) throw new Error(res.error)
    const peaks: XrdProPeak[] = (res.peaks ?? []).map((p) => ({
      position: Number(p.position ?? 0),
      intensity: Number(p.intensity ?? 0),
      fwhm: p.fwhm != null ? Number(p.fwhm) : undefined,
      snr: p.snr != null ? Number(p.snr) : undefined,
    }))
    void kind
    return { artifactId: artifact.id, peaks, summary: summarizePeaks(peaks) }
  },
}
