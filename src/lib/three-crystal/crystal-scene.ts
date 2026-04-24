/**
 * CrystalScene — manages a WebGLRenderer + CSS2DRenderer + camera +
 * controls for displaying crystal structures.
 *
 * Ported from mp-react-components `Scene.ts`, trimmed to the essentials:
 * WebGLRenderer (no SVG), OrbitControls (no Trackball), static scene
 * with on-demand rendering (no animation loop), raycasting for clicks,
 * and clean teardown.
 */

import * as THREE from 'three'
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import {
  type CrystalSceneSettings,
  type SceneJsonChild,
  type SceneJsonObject,
  DEFAULT_CRYSTAL_SETTINGS,
} from './types'
import { ThreeBuilder, createSceneWithBackground } from './three-builder'

export interface CrystalSceneOptions {
  settings?: Partial<CrystalSceneSettings>
  onClick?: (objects: THREE.Object3D[]) => void
}

/**
 * Self-contained Three.js scene manager for crystal structures.
 *
 * Lifecycle: `new CrystalScene(host, opts)` -> `addToScene(json)` ->
 * `renderScene()` -> `onDestroy()`.
 */
export class CrystalScene {
  // ── Public read-only refs ──────────────────────────────────────────
  readonly scene: THREE.Scene
  readonly renderer: THREE.WebGLRenderer
  readonly camera: THREE.OrthographicCamera

  // ── Internals ──────────────────────────────────────────────────────
  private settings: CrystalSceneSettings
  private labelRenderer: CSS2DRenderer
  private controls: OrbitControls
  private builder: ThreeBuilder
  private raycaster = new THREE.Raycaster()
  private clickableObjects: THREE.Object3D[] = []
  private objectMap: Record<number, SceneJsonChild> = {}
  private cachedSize: { width: number; height: number }
  private resizeObserver: ResizeObserver
  private host: HTMLElement
  private clickCb: ((objects: THREE.Object3D[]) => void) | undefined

  constructor(host: HTMLElement, opts: CrystalSceneOptions = {}) {
    this.host = host
    this.settings = { ...DEFAULT_CRYSTAL_SETTINGS, ...opts.settings }
    this.clickCb = opts.onClick
    this.builder = new ThreeBuilder(this.settings)

    // Measure the host for initial sizing.
    this.cachedSize = {
      width: host.clientWidth || 300,
      height: host.clientHeight || 300,
    }

    // WebGL renderer.
    this.renderer = new THREE.WebGLRenderer({
      antialias: this.settings.antialias,
      alpha: this.settings.transparentBackground,
      preserveDrawingBuffer: true,
    })
    this.renderer.setPixelRatio(window.devicePixelRatio)
    this.renderer.setSize(this.cachedSize.width, this.cachedSize.height)
    this.renderer.setClearColor(
      new THREE.Color(this.settings.background),
      this.settings.transparentBackground ? 0.0 : 1.0,
    )
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.0
    host.appendChild(this.renderer.domElement)

    // CSS2D label overlay.
    this.labelRenderer = new CSS2DRenderer()
    this.labelRenderer.setSize(this.cachedSize.width, this.cachedSize.height)
    this.labelRenderer.domElement.style.position = 'absolute'
    this.labelRenderer.domElement.style.top = '0'
    this.labelRenderer.domElement.style.left = '0'
    this.labelRenderer.domElement.style.pointerEvents = 'none'
    host.appendChild(this.labelRenderer.domElement)

    // Scene + lights.
    this.scene = createSceneWithBackground(this.settings)
    this.scene.add(this.builder.makeLights())

    // Camera (values overwritten in setupCamera).
    this.camera = new THREE.OrthographicCamera(-10, 10, 10, -10, -100, 100)
    this.scene.add(this.camera)

    // Controls.
    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.rotateSpeed = 2.0
    this.controls.zoomSpeed = 1.2
    this.controls.panSpeed = 0.8
    this.controls.enableDamping = false
    this.controls.addEventListener('change', () => this.renderScene())

    // Click handling on the WebGL canvas.
    this.renderer.domElement.addEventListener('click', this.handleClick)

    // Resize observer for auto-resizing when the host changes size.
    this.resizeObserver = new ResizeObserver(() => this.handleResize())
    this.resizeObserver.observe(host)
  }

  // ── Scene management ───────────────────────────────────────────────

  /**
   * Replace the scene contents with the provided scene JSON. Existing
   * objects (except lights and camera) are removed first.
   */
  addToScene(sceneJson: SceneJsonObject): void {
    // Remove previous root object if same name.
    const existing = this.scene.getObjectByName(sceneJson.name)
    if (existing) {
      this.scene.remove(existing)
      this.disposeObject(existing)
    }
    this.clickableObjects = []
    this.objectMap = {}

    const root = new THREE.Object3D()
    root.name = sceneJson.name
    if (sceneJson.visible != null) root.visible = sceneJson.visible

    this.traverseSceneJson(sceneJson.contents, root)
    this.scene.add(root)
    this.setupCamera(root)
    this.renderScene()
  }

  /**
   * Clear all user-content objects from the scene (keeps lights/camera).
   */
  clearScene(): void {
    const toRemove: THREE.Object3D[] = []
    for (const child of this.scene.children) {
      if (child === this.camera || child.name === 'lights') continue
      toRemove.push(child)
    }
    for (const obj of toRemove) {
      this.scene.remove(obj)
      this.disposeObject(obj)
    }
    this.clickableObjects = []
    this.objectMap = {}
  }

  // ── Rendering ──────────────────────────────────────────────────────

  renderScene(): void {
    this.renderer.render(this.scene, this.camera)
    this.labelRenderer.render(this.scene, this.camera)
  }

  // ── Camera ─────────────────────────────────────────────────────────

  private setupCamera(rootObject: THREE.Object3D): void {
    const box = new THREE.Box3().setFromObject(rootObject)
    const center = new THREE.Vector3()
    box.getCenter(center)
    const size = new THREE.Vector3()
    box.getSize(size)
    const extent = box.max.clone().sub(box.min)
    const length = extent.length() * 2

    const Z_PAD = 50
    this.camera.left = (center.x - length) / this.settings.defaultZoom
    this.camera.right = (center.x + length) / this.settings.defaultZoom
    this.camera.top = (center.y + length) / this.settings.defaultZoom
    this.camera.bottom = (center.y - length) / this.settings.defaultZoom
    this.camera.near = center.z - length - Z_PAD
    this.camera.far = center.z + length + Z_PAD

    this.camera.position.set(center.x, center.y, center.z + length / 2)
    this.camera.lookAt(center)
    this.camera.zoom = 4
    this.camera.updateProjectionMatrix()
    this.controls.target.copy(center)
    this.controls.update()
  }

  /** Reset camera to fit the current scene. */
  resetCamera(): void {
    // Collect all non-light, non-camera children.
    for (const child of this.scene.children) {
      if (child === this.camera || child.name === 'lights') continue
      this.setupCamera(child)
      return
    }
  }

  // ── Raycasting / click ─────────────────────────────────────────────

  private handleClick = (e: MouseEvent): void => {
    if (this.clickableObjects.length === 0 || !this.clickCb) return
    const rect = this.renderer.domElement.getBoundingClientRect()
    const mouse = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    )
    this.raycaster.setFromCamera(mouse, this.camera)
    const hits = this.raycaster.intersectObjects(this.clickableObjects, true)
    if (hits.length > 0) {
      const parent = this.findRegisteredParent(hits[0].object)
      if (parent) this.clickCb([parent])
    }
  }

  /**
   * Programmatic raycast: given pixel coords relative to the canvas,
   * return the first clickable Object3D hit, or null.
   */
  raycastAtPixel(x: number, y: number): THREE.Object3D | null {
    const mouse = new THREE.Vector2(
      (x / this.cachedSize.width) * 2 - 1,
      -(y / this.cachedSize.height) * 2 + 1,
    )
    this.raycaster.setFromCamera(mouse, this.camera)
    const hits = this.raycaster.intersectObjects(this.clickableObjects, true)
    if (hits.length === 0) return null
    return this.findRegisteredParent(hits[0].object) ?? null
  }

  private findRegisteredParent(obj: THREE.Object3D): THREE.Object3D | null {
    let cur: THREE.Object3D | null = obj
    while (cur) {
      if (this.objectMap[cur.id] != null) return cur
      cur = cur.parent
    }
    return null
  }

  // ── Resize ─────────────────────────────────────────────────────────

  private handleResize = (): void => {
    const w = this.host.clientWidth
    const h = this.host.clientHeight
    if (w === this.cachedSize.width && h === this.cachedSize.height) return
    this.cachedSize = { width: w, height: h }
    this.renderer.setSize(w, h)
    this.labelRenderer.setSize(w, h)
    // Maintain aspect in orthographic camera.
    const aspect = w / h
    const halfH = (this.camera.top - this.camera.bottom) / 2
    const halfW = halfH * aspect
    const cx = (this.camera.left + this.camera.right) / 2
    const cy = (this.camera.top + this.camera.bottom) / 2
    this.camera.left = cx - halfW
    this.camera.right = cx + halfW
    this.camera.top = cy + halfH
    this.camera.bottom = cy - halfH
    this.camera.updateProjectionMatrix()
    this.renderScene()
  }

  // ── Background ─────────────────────────────────────────────────────

  setBackground(color: string): void {
    this.settings.background = color
    const c = new THREE.Color(color)
    this.renderer.setClearColor(c, 1.0)
    if (!this.settings.transparentBackground) {
      this.scene.background = c
    } else {
      this.scene.background = null
      this.renderer.setClearColor(new THREE.Color(color), 1.0)
    }
    this.renderScene()
  }

  // ── Screenshot ─────────────────────────────────────────────────────

  toDataURL(type = 'image/png', quality?: number): string {
    // Render one more frame to ensure the buffer is current.
    this.renderScene()
    return this.renderer.domElement.toDataURL(type, quality)
  }

  // ── Cleanup ────────────────────────────────────────────────────────

  onDestroy(): void {
    this.resizeObserver.disconnect()
    this.renderer.domElement.removeEventListener('click', this.handleClick)
    this.controls.dispose()
    this.disposeObject(this.scene)

    this.renderer.forceContextLoss()
    this.renderer.dispose()

    // Remove DOM elements.
    this.labelRenderer.domElement.parentElement?.removeChild(
      this.labelRenderer.domElement,
    )
    this.renderer.domElement.parentElement?.removeChild(
      this.renderer.domElement,
    )
  }

  // ── Private helpers ────────────────────────────────────────────────

  private traverseSceneJson(
    children: SceneJsonChild[],
    parent: THREE.Object3D,
  ): void {
    for (const child of children) {
      if (child.type) {
        const obj = new THREE.Object3D()
        if (child.clickable) {
          this.clickableObjects.push(obj)
          this.objectMap[obj.id] = child
        }
        this.builder.makeObject(child, obj)
        parent.add(obj)
      } else {
        // Group node — recurse.
        const group = new THREE.Object3D()
        group.name = child.name ?? ''
        group.visible = child.visible !== false
        if (child.origin) {
          const mat4 = new THREE.Matrix4()
          mat4.makeTranslation(...child.origin)
          group.applyMatrix4(mat4)
        }
        parent.add(group)
        if (child.contents) {
          this.traverseSceneJson(child.contents, group)
        }
      }
    }
  }

  /** Recursively dispose geometries and materials in a subtree. */
  private disposeObject(obj: THREE.Object3D): void {
    obj.traverse((node) => {
      if ((node as THREE.Mesh).geometry) {
        ;(node as THREE.Mesh).geometry.dispose()
      }
      const mat = (node as THREE.Mesh).material
      if (mat) {
        if (Array.isArray(mat)) {
          mat.forEach((m) => m.dispose())
        } else {
          ;(mat as THREE.Material).dispose()
        }
      }
    })
  }
}
