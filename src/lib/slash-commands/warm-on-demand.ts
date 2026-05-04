import { useExtensionsConfigStore } from '../../stores/extensions-config-store'
import {
  warmMcpCache,
  warmPluginsCache,
  warmSkillsCache,
} from './index'

type Listener = () => void

let started = false
let ready = false
let version = 0
let warmPromise: Promise<void> | null = null
let cleanupWarmSubscriptions: (() => void) | null = null
const listeners = new Set<Listener>()

function notifyChanged(): void {
  version += 1
  for (const listener of listeners) listener()
}

function runWarm(task: () => Promise<void>): void {
  void task().finally(() => {
    ready = true
    notifyChanged()
  })
}

function subscribeWarmInvalidations(): void {
  if (cleanupWarmSubscriptions) return

  const unsubs: Array<() => void> = []
  const api = window.electronAPI
  if (api?.onSkillsChanged) {
    unsubs.push(api.onSkillsChanged(() => runWarm(warmSkillsCache)))
  }
  if (api?.onPluginsChanged) {
    unsubs.push(api.onPluginsChanged(() => runWarm(warmPluginsCache)))
  }
  if (api?.onMcpPromptsChanged) {
    unsubs.push(api.onMcpPromptsChanged(() => runWarm(warmMcpCache)))
  }
  unsubs.push(
    useExtensionsConfigStore.subscribe((s, prev) => {
      if (s.plugins !== prev.plugins) runWarm(warmPluginsCache)
      if (s.mcpServers !== prev.mcpServers) runWarm(warmMcpCache)
    }),
  )

  cleanupWarmSubscriptions = () => {
    for (const unsub of unsubs) unsub()
    cleanupWarmSubscriptions = null
  }
}

export function ensureSlashCommandCachesWarm(): void {
  void warmSlashCommandCaches()
}

export function warmSlashCommandCaches(): Promise<void> {
  if (warmPromise) return warmPromise
  if (started) return Promise.resolve()
  started = true
  subscribeWarmInvalidations()
  warmPromise = (async () => {
    await Promise.all([
      warmSkillsCache(),
      warmPluginsCache(),
      warmMcpCache(),
    ])
  })().finally(() => {
    ready = true
    notifyChanged()
  })
  return warmPromise
}

export function disposeSlashCommandWarmForTests(): void {
  cleanupWarmSubscriptions?.()
  started = false
  ready = false
  warmPromise = null
}

export function getSlashCommandWarmVersion(): number {
  return version
}

export function areSlashCommandCachesReady(): boolean {
  return ready
}

export function subscribeSlashCommandWarm(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
