/**
 * Shared types for the Three.js crystal structure rendering system.
 *
 * These mirror the scene-JSON format used by mp-react-components, trimmed
 * to only the primitives the StructureViewer needs: spheres, cylinders,
 * lines, arrows, and labels.
 */

/** XYZ tuple in Cartesian space. */
export type ThreePosition = [number, number, number]

/** Allowed JSON-to-Three primitive kinds. */
export enum JSON3DObject {
  SPHERES = 'spheres',
  CYLINDERS = 'cylinders',
  LINES = 'lines',
  ARROWS = 'arrows',
  LABEL = 'labels',
}

/** Light type identifiers used in scene settings. */
export enum LightType {
  DirectionalLight = 'DirectionalLight',
  AmbientLight = 'AmbientLight',
  HemisphereLight = 'HemisphereLight',
}

/** A single light entry in the settings. */
export interface LightSpec {
  type: LightType
  args: [string, string | number, number?] | [string, number]
  position?: ThreePosition
}

/**
 * A typed JSON object describing a single Three.js primitive group.
 * The `type` field selects which builder method creates the geometry.
 */
export interface SceneJsonChild {
  type?: JSON3DObject
  name?: string
  visible?: boolean
  origin?: ThreePosition
  contents?: SceneJsonChild[]
  clickable?: boolean
  tooltip?: string

  // -- spheres --------------------------------------------------------
  positions?: ThreePosition[]
  radius?: number
  color?: string | string[]
  phiStart?: number
  phiEnd?: number

  // -- cylinders / arrows --------------------------------------------
  positionPairs?: [ThreePosition, ThreePosition][]
  radiusTop?: number | number[]
  radiusBottom?: number | number[]
  headLength?: number
  headWidth?: number

  // -- lines ----------------------------------------------------------
  line_width?: number
  dashSize?: number
  gapSize?: number
  scale?: number

  // -- labels ---------------------------------------------------------
  label?: string
  hoverLabel?: string
}

/** Root scene-JSON wrapper (the outermost object handed to `addToScene`). */
export interface SceneJsonObject {
  name: string
  visible?: boolean
  origin?: ThreePosition
  contents: SceneJsonChild[]
}

/** Settings that drive the Three.js builder and scene. */
export interface CrystalSceneSettings {
  antialias: boolean
  transparentBackground: boolean
  background: string
  sphereSegments: number
  cylinderSegments: number
  sphereScale: number
  cylinderScale: number
  defaultZoom: number
  lights: LightSpec[]
  material: {
    type: 'MeshStandardMaterial'
    parameters: {
      roughness: number
      metalness: number
    }
  }
}

/** Sensible defaults for a crystal-structure scene. */
export const DEFAULT_CRYSTAL_SETTINGS: CrystalSceneSettings = {
  antialias: true,
  transparentBackground: false,
  background: '#1A1A1A',
  sphereSegments: 32,
  cylinderSegments: 16,
  sphereScale: 1.0,
  cylinderScale: 1.0,
  defaultZoom: 1.0,
  lights: [
    { type: LightType.HemisphereLight, args: ['#ffffff', '#444444', 1.2] },
    { type: LightType.DirectionalLight, args: ['#ffffff', 1.5], position: [-5, 8, 10] },
    { type: LightType.DirectionalLight, args: ['#c0c8d8', 0.6], position: [5, -3, -8] },
    { type: LightType.AmbientLight, args: ['#404040', 0.5] },
  ],
  material: {
    type: 'MeshStandardMaterial',
    parameters: { roughness: 0.35, metalness: 0.1 },
  },
}
