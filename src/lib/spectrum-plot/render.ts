// Core off-screen renderer: option → PNG bytes or SVG text.
//
// Lives separately from the option builder so callers that only need
// to compose options (e.g. tests, other render backends) don't pull in
// the echarts runtime or require a DOM.

import type { RenderParams, RenderedArtifact } from './types'

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const bin = atob(base64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out.buffer
}

function dataUrlToPngBuffer(dataUrl: string): ArrayBuffer {
  const marker = 'base64,'
  const idx = dataUrl.indexOf(marker)
  if (idx < 0) {
    throw new Error('ECharts did not return a base64 data URL — PNG export failed.')
  }
  return base64ToArrayBuffer(dataUrl.slice(idx + marker.length))
}

export async function renderOption(
  option: Record<string, unknown>,
  params: RenderParams,
): Promise<RenderedArtifact> {
  if (typeof document === 'undefined') {
    throw new Error('renderOption: DOM unavailable (not in a renderer process).')
  }

  const echarts = await import('echarts')

  const host = document.createElement('div')
  host.style.position = 'fixed'
  host.style.left = '-99999px'
  host.style.top = '0'
  host.style.width = `${params.width}px`
  host.style.height = `${params.height}px`
  host.style.pointerEvents = 'none'
  host.setAttribute('aria-hidden', 'true')
  document.body.appendChild(host)

  const chart = echarts.init(host, undefined, {
    renderer: params.format === 'svg' ? 'svg' : 'canvas',
    width: params.width,
    height: params.height,
    devicePixelRatio: params.pixelRatio ?? 2,
  })

  try {
    chart.setOption(option, true)
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    if (params.format === 'svg') {
      // ECharts' SVG renderer exposes renderToSVGString on the instance
      // under the typed `.renderToSVGString()` method; type-cast here
      // because the static `init` return type doesn't surface it.
      const chartWithSvg = chart as unknown as {
        renderToSVGString?: () => string
      }
      if (typeof chartWithSvg.renderToSVGString !== 'function') {
        throw new Error('ECharts SVG renderer not available in this build.')
      }
      return { format: 'svg', text: chartWithSvg.renderToSVGString() }
    }
    const dataUrl = chart.getDataURL({
      type: 'png',
      pixelRatio: params.pixelRatio ?? 2,
      backgroundColor: params.backgroundColor ?? '#FFFFFF',
    })
    return { format: 'png', bytes: dataUrlToPngBuffer(dataUrl) }
  } finally {
    chart.dispose()
    host.remove()
  }
}
