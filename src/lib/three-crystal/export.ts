/**
 * Export utilities for the Three.js crystal structure renderer.
 *
 * All functions accept the renderer/scene from `CrystalScene` and
 * produce a data URL or Blob suitable for download.
 */

import type * as THREE from 'three'

/**
 * Export the current canvas as a PNG data URL.
 */
export function exportPng(renderer: THREE.WebGLRenderer): string {
  return renderer.domElement.toDataURL('image/png')
}

/**
 * Export the current canvas as a JPEG data URL with a white background
 * composited behind the transparent WebGL output.
 */
export function exportJpg(
  renderer: THREE.WebGLRenderer,
  quality = 0.92,
): string {
  const src = renderer.domElement
  const canvas = document.createElement('canvas')
  canvas.width = src.width
  canvas.height = src.height
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(src, 0, 0)
  return canvas.toDataURL('image/jpeg', quality)
}

/**
 * Export the scene as a glTF binary (.glb) Blob.
 *
 * Uses dynamic import so the GLTFExporter chunk is only loaded when the
 * user actually exports — keeps the initial bundle small.
 */
export async function exportGlb(scene: THREE.Scene): Promise<Blob> {
  const { GLTFExporter } = await import(
    'three/addons/exporters/GLTFExporter.js'
  )
  const exporter = new GLTFExporter()
  const result = await exporter.parseAsync(scene, { binary: true })
  if (result instanceof ArrayBuffer) {
    return new Blob([result], { type: 'model/gltf-binary' })
  }
  // Fallback: JSON result — wrap as .glb anyway.
  const json = JSON.stringify(result)
  return new Blob([json], { type: 'model/gltf+json' })
}

/**
 * Export the scene as glTF JSON (.gltf) string.
 */
export async function exportGltf(scene: THREE.Scene): Promise<string> {
  const { GLTFExporter } = await import(
    'three/addons/exporters/GLTFExporter.js'
  )
  const exporter = new GLTFExporter()
  const result = await exporter.parseAsync(scene, { binary: false })
  return JSON.stringify(result, null, 2)
}
