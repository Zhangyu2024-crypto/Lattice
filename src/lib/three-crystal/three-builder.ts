/**
 * Three.js geometry builder for crystal structure scenes.
 *
 * Ported from mp-react-components `three_builder.ts`, trimmed to the
 * primitives the StructureViewer needs: spheres (atoms), cylinders
 * (bonds), lines (unit cell), arrows (axes), labels (CSS2DObject).
 *
 * All geometry uses non-deprecated Three.js r169 APIs (BufferGeometry
 * variants). Material is always MeshStandardMaterial — no SVG branch.
 */

import * as THREE from 'three'
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js'
import {
  type CrystalSceneSettings,
  type SceneJsonChild,
  type ThreePosition,
  JSON3DObject,
  LightType,
} from './types'

const DEFAULT_LINE_COLOR = '#2c3c54'
const DEFAULT_MATERIAL_COLOR = '#52afb0'

/**
 * Stateless-ish builder. The settings object controls segment counts,
 * scale factors, and material parameters.
 */
export class ThreeBuilder {
  constructor(private settings: CrystalSceneSettings) {}

  // ── Spheres ────────────────────────────────────────────────────────

  makeSpheres(json: SceneJsonChild, parent: THREE.Object3D): THREE.Object3D {
    const radius = (json.radius ?? 1) * this.settings.sphereScale
    const geom = new THREE.SphereGeometry(
      radius,
      this.settings.sphereSegments,
      this.settings.sphereSegments,
      json.phiStart ?? 0,
      json.phiEnd ?? Math.PI * 2,
    )
    const mat = this.makeMaterial(
      typeof json.color === 'string' ? json.color : undefined,
    )

    const positions = json.positions ?? []
    const perSphereColor = Array.isArray(json.color)
    for (let i = 0; i < positions.length; i++) {
      const currentMat = perSphereColor
        ? this.makeMaterial((json.color as string[])[i])
        : mat
      const mesh = new THREE.Mesh(geom, currentMat)
      mesh.position.set(...positions[i])
      parent.add(mesh)
    }
    return parent
  }

  // ── Cylinders ──────────────────────────────────────────────────────

  makeCylinders(json: SceneJsonChild, parent: THREE.Object3D): THREE.Object3D {
    const radius = json.radius ?? 1
    const pairs = json.positionPairs ?? []
    const perCylColor = Array.isArray(json.color)
    const geom = this.cylinderGeometry(radius)
    const mat = this.makeMaterial(
      typeof json.color === 'string' ? json.color : undefined,
    )
    const vecY = new THREE.Vector3(0, 1, 0)
    const quat = new THREE.Quaternion()

    for (let i = 0; i < pairs.length; i++) {
      const currentMat = perCylColor
        ? this.makeMaterial((json.color as string[])[i])
        : mat
      const mesh = new THREE.Mesh(geom, currentMat)
      const a = new THREE.Vector3(...pairs[i][0])
      const b = new THREE.Vector3(...pairs[i][1])
      const rel = b.clone().sub(a)

      mesh.scale.y = rel.length()
      const mid = a.clone().add(rel.clone().multiplyScalar(0.5))
      mesh.position.copy(mid)
      quat.setFromUnitVectors(vecY, rel.clone().normalize())
      mesh.setRotationFromQuaternion(quat)

      parent.add(mesh)
    }
    return parent
  }

  // ── Lines ──────────────────────────────────────────────────────────

  makeLines(json: SceneJsonChild, parent: THREE.Object3D): THREE.Object3D {
    const positions = json.positions ?? []
    // Flatten nested position arrays into a single Float32 buffer.
    const flat: number[] = []
    for (const pos of positions) {
      if (Array.isArray(pos)) flat.push(...pos)
    }
    const verts = new THREE.Float32BufferAttribute(flat, 3)
    const geom = new THREE.BufferGeometry()
    geom.setAttribute('position', verts)

    const isDashed = json.dashSize || json.gapSize
    const mat = isDashed
      ? new THREE.LineDashedMaterial({
          color: (typeof json.color === 'string' ? json.color : null) ?? DEFAULT_LINE_COLOR,
          linewidth: json.line_width ?? 1,
          scale: json.scale ?? 1,
          dashSize: json.dashSize ?? 3,
          gapSize: json.gapSize ?? 1,
        })
      : new THREE.LineBasicMaterial({
          color: (typeof json.color === 'string' ? json.color : null) ?? DEFAULT_LINE_COLOR,
          linewidth: json.line_width ?? 1,
        })

    const mesh = new THREE.LineSegments(geom, mat)
    if (isDashed) mesh.computeLineDistances()
    parent.add(mesh)
    return parent
  }

  // ── Arrows ─────────────────────────────────────────────────────────

  makeArrows(json: SceneJsonChild, parent: THREE.Object3D): THREE.Object3D {
    const radius = json.radius ?? 1
    const headLength = json.headLength ?? 2
    const headWidth = json.headWidth ?? 2
    const geomCyl = this.cylinderGeometry(radius)
    const geomHead = new THREE.ConeGeometry(
      headWidth * this.settings.cylinderScale,
      headLength * this.settings.cylinderScale,
      this.settings.cylinderSegments,
    )
    const mat = this.makeMaterial(
      typeof json.color === 'string' ? json.color : undefined,
    )
    const vecY = new THREE.Vector3(0, 1, 0)
    const quat = new THREE.Quaternion()

    for (const pair of json.positionPairs ?? []) {
      const a = new THREE.Vector3(...pair[0])
      const b = new THREE.Vector3(...pair[1])
      const headPos = new THREE.Vector3(...pair[1])
      const rel = b.sub(a)

      // Shaft
      const shaft = new THREE.Mesh(geomCyl, mat)
      shaft.scale.y = rel.length()
      const mid = a.clone().add(rel.clone().multiplyScalar(0.5))
      shaft.position.copy(mid)
      quat.setFromUnitVectors(vecY, rel.clone().normalize())
      shaft.setRotationFromQuaternion(quat)
      parent.add(shaft)

      // Head
      const head = new THREE.Mesh(geomHead, mat)
      head.position.copy(headPos)
      head.setRotationFromQuaternion(quat.clone())
      parent.add(head)
    }
    return parent
  }

  // ── Labels ─────────────────────────────────────────────────────────

  makeLabels(json: SceneJsonChild, parent: THREE.Object3D): THREE.Object3D {
    const div = document.createElement('div')
    div.className = 'crystal-label'
    div.textContent = json.label ?? ''
    div.style.fontFamily = 'var(--font-sans)'
    div.style.fontSize = '11px'
    div.style.color = '#ffffff'
    div.style.padding = '1px 3px'
    div.style.pointerEvents = 'none'
    const obj = new CSS2DObject(div)
    parent.add(obj)
    return parent
  }

  // ── Lights ─────────────────────────────────────────────────────────

  makeLights(): THREE.Object3D {
    const group = new THREE.Object3D()
    group.name = 'lights'
    for (const spec of this.settings.lights) {
      let light: THREE.Light
      switch (spec.type) {
        case LightType.HemisphereLight: {
          const [skyColor, groundColor, intensity] = spec.args as [string, string, number]
          light = new THREE.HemisphereLight(skyColor, groundColor, intensity)
          break
        }
        case LightType.AmbientLight: {
          const [color, intensity] = spec.args as [string, number]
          light = new THREE.AmbientLight(color, intensity)
          break
        }
        case LightType.DirectionalLight: {
          const [color, intensity] = spec.args as [string, number]
          light = new THREE.DirectionalLight(color, intensity)
          break
        }
        default:
          continue
      }
      if (spec.position) light.position.set(...spec.position)
      group.add(light)
    }
    return group
  }

  // ── Dispatch ───────────────────────────────────────────────────────

  makeObject(json: SceneJsonChild, parent: THREE.Object3D): THREE.Object3D {
    switch (json.type) {
      case JSON3DObject.SPHERES:
        return this.makeSpheres(json, parent)
      case JSON3DObject.CYLINDERS:
        return this.makeCylinders(json, parent)
      case JSON3DObject.LINES:
        return this.makeLines(json, parent)
      case JSON3DObject.ARROWS:
        return this.makeArrows(json, parent)
      case JSON3DObject.LABEL:
        return this.makeLabels(json, parent)
      default:
        return parent
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────

  makeMaterial(color = DEFAULT_MATERIAL_COLOR, opacity = 1.0): THREE.MeshStandardMaterial {
    const mat = new THREE.MeshStandardMaterial({
      ...this.settings.material.parameters,
      color,
      opacity,
    })
    if (opacity < 1.0) {
      mat.transparent = true
      mat.depthWrite = false
    }
    return mat
  }

  private cylinderGeometry(radius: number): THREE.CylinderGeometry {
    return new THREE.CylinderGeometry(
      radius * this.settings.cylinderScale,
      radius * this.settings.cylinderScale,
      1.0,
      this.settings.cylinderSegments,
    )
  }
}

/**
 * Create a Three.js Scene with the configured background.
 */
export function createSceneWithBackground(settings: CrystalSceneSettings): THREE.Scene {
  const scene = new THREE.Scene()
  if (!settings.transparentBackground) {
    scene.background = new THREE.Color(settings.background)
  }
  return scene
}
