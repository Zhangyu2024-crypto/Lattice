import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { genShortId } from '../lib/id-gen'

// Compute config — scoped to Native execution only (bundled conda env with
// Python + LAMMPS + CP2K + phonopy + BGMN). Docker-based Local and Remote
// modes were removed in v5; user code now runs via `spawn()` in the host
// conda env. See `electron/compute-runner.ts`.

export type ComputeMode = 'native' | 'disabled'

export interface ComputeTestResult {
  ok: boolean
  message: string
  checkedAt: number
  pythonVersion?: string | null
  lammpsAvailable?: boolean
  cp2kAvailable?: boolean
  packages?: Record<string, string>
}

export interface ComputeResourceSpec {
  /** CPU core cap (1..32). Drives OMP_NUM_THREADS / MKL_NUM_THREADS env
   *  vars for spawned Python/LAMMPS/CP2K processes. */
  cpuCores: number
  /** Thread fan-out hint. When `'auto'` the runner sets OMP_NUM_THREADS
   *  equal to cpuCores; otherwise it uses this explicit value. */
  ompThreads: number | 'auto'
}

export interface ComputeEnvVar {
  id: string
  key: string
  value: string
}

export interface ComputeConfigState {
  /** Where to run user code.
   *    `native`   = bundled conda env on this host (default);
   *    `disabled` = Run is off. */
  mode: ComputeMode
  /** Wall-clock timeout in seconds. Runner SIGKILLs the process after this. */
  timeoutSec: number
  /** Result of the most recent Test Connection click (nullable while pending). */
  lastTest: ComputeTestResult | null
  resources: ComputeResourceSpec
  envVars: ComputeEnvVar[]

  setMode: (mode: ComputeMode) => void
  setTimeoutSec: (n: number) => void
  setLastTest: (result: ComputeTestResult | null) => void
  setResources: (patch: Partial<ComputeResourceSpec>) => void
  applyResourcePreset: (preset: keyof typeof RESOURCE_PRESETS) => void
  addEnvVar: () => string
  updateEnvVar: (id: string, patch: Partial<ComputeEnvVar>) => void
  removeEnvVar: (id: string) => void
  resetDefaults: () => void
}

export const COMPUTE_TIMEOUT_MAX_SEC = 24 * 60 * 60

export const RESOURCE_PRESETS: Record<
  'light' | 'balanced' | 'heavy' | 'max',
  { label: string; spec: ComputeResourceSpec }
> = {
  light: {
    label: 'Light',
    spec: { cpuCores: 2, ompThreads: 'auto' },
  },
  balanced: {
    label: 'Balanced',
    spec: { cpuCores: 6, ompThreads: 'auto' },
  },
  heavy: {
    label: 'Heavy',
    spec: { cpuCores: 12, ompThreads: 'auto' },
  },
  max: {
    label: 'Max',
    spec: { cpuCores: 32, ompThreads: 'auto' },
  },
}

const DEFAULT_RESOURCES: ComputeResourceSpec = {
  ...RESOURCE_PRESETS.balanced.spec,
}

const DEFAULTS = {
  mode: 'native' as ComputeMode,
  timeoutSec: 30 * 60,
  lastTest: null as ComputeTestResult | null,
  resources: { ...DEFAULT_RESOURCES },
  envVars: [] as ComputeEnvVar[],
}

const genId = () => genShortId('cc', 5)

export const useComputeConfigStore = create<ComputeConfigState>()(
  persist(
    (set) => ({
      ...DEFAULTS,

      setMode: (mode) => set({ mode, lastTest: null }),
      setTimeoutSec: (timeoutSec) =>
        set({ timeoutSec: clamp(Math.round(timeoutSec), 1, COMPUTE_TIMEOUT_MAX_SEC) }),
      setLastTest: (lastTest) => set({ lastTest }),

      setResources: (patch) =>
        set((s) => ({
          resources: normaliseResources({ ...s.resources, ...patch }),
        })),
      applyResourcePreset: (preset) =>
        set({ resources: { ...RESOURCE_PRESETS[preset].spec } }),

      addEnvVar: () => {
        const id = genId()
        set((s) => ({
          envVars: [...s.envVars, { id, key: '', value: '' }],
        }))
        return id
      },
      updateEnvVar: (id, patch) =>
        set((s) => ({
          envVars: s.envVars.map((v) => (v.id === id ? { ...v, ...patch } : v)),
        })),
      removeEnvVar: (id) =>
        set((s) => ({ envVars: s.envVars.filter((v) => v.id !== id) })),

      resetDefaults: () => set({ ...DEFAULTS }),
    }),
    {
      name: 'lattice.compute-config',
      version: 6,
      storage: createJSONStorage(() => localStorage),
      // Migration history:
      //   v6 — raise the default wall-clock timeout from 60s to 30min for
      //        real scientific jobs; old persisted 60s defaults are bumped.
      //   v5 — drop Local (Docker) and Remote (SSH) modes; coerce them to
      //        'native'. Also drop containerName/remoteSsh/networking/
      //        volumes/provisioningRevision fields and memoryGB/shmSizeGB
      //        from resources. They simply won't rehydrate since the
      //        state shape no longer declares them.
      //   v4 — `remoteSsh` for SSH → remote docker exec (now obsolete).
      //   v3 — introduced full container-provisioning UI (now obsolete).
      //   v1→v2 — discarded legacy `dockerHost/image/cpuCores/memoryMB`
      //        (already obsolete long before v5).
      migrate: (persistedState, fromVersion) => {
        const s = (persistedState ?? {}) as Record<string, unknown>
        const migrated: ComputeConfigState = {
          ...DEFAULTS,
          // zustand's persist overlays stored values after migrate; we
          // only need the *shape* here — actions get re-bound by the
          // outer create() after hydration.
          setMode: () => {},
          setTimeoutSec: () => {},
          setLastTest: () => {},
          setResources: () => {},
          applyResourcePreset: () => {},
          addEnvVar: () => '',
          updateEnvVar: () => {},
          removeEnvVar: () => {},
          resetDefaults: () => {},
        }
        // Mode: coerce anything not in the new union to 'native'.
        if (s.mode === 'disabled') {
          migrated.mode = 'disabled'
        } else {
          migrated.mode = 'native'
        }
        if (typeof s.timeoutSec === 'number' && Number.isFinite(s.timeoutSec)) {
          const storedTimeout = clamp(Math.round(s.timeoutSec), 1, COMPUTE_TIMEOUT_MAX_SEC)
          migrated.timeoutSec = fromVersion < 6 && storedTimeout <= 60
            ? DEFAULTS.timeoutSec
            : storedTimeout
        }
        if (s.resources && typeof s.resources === 'object') {
          migrated.resources = normaliseResources(
            s.resources as ComputeResourceSpec,
          )
        }
        if (Array.isArray(s.envVars)) {
          migrated.envVars = (s.envVars as ComputeEnvVar[])
            .filter((e) => e && typeof e === 'object')
            .map((e) => ({
              id: typeof e.id === 'string' && e.id ? e.id : genId(),
              key: String(e.key ?? ''),
              value: String(e.value ?? ''),
            }))
        }
        return migrated
      },
    },
  ),
)

function normaliseResources(r: Partial<ComputeResourceSpec>): ComputeResourceSpec {
  return {
    cpuCores: clamp(
      Math.round(r.cpuCores ?? DEFAULT_RESOURCES.cpuCores),
      1,
      32,
    ),
    ompThreads:
      r.ompThreads === 'auto' || r.ompThreads == null
        ? 'auto'
        : clamp(Math.round(r.ompThreads as number), 1, 128),
  }
}

function clamp(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo
  return Math.max(lo, Math.min(hi, v))
}
