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

export function ensureSlashCommandCachesWarm(): void {
  void warmSlashCommandCaches()
}

export function warmSlashCommandCaches(): Promise<void> {
  if (warmPromise) return warmPromise
  if (started) return Promise.resolve()
  started = true
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

  const api = window.electronAPI
  if (api?.onSkillsChanged) {
    void api.onSkillsChanged(() => runWarm(warmSkillsCache))
  }
  if (api?.onPluginsChanged) {
    void api.onPluginsChanged(() => runWarm(warmPluginsCache))
  }
  if (api?.onMcpPromptsChanged) {
    void api.onMcpPromptsChanged(() => runWarm(warmMcpCache))
  }
  useExtensionsConfigStore.subscribe((s, prev) => {
    if (s.plugins !== prev.plugins) runWarm(warmPluginsCache)
    if (s.mcpServers !== prev.mcpServers) runWarm(warmMcpCache)
  })
  return warmPromise
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
