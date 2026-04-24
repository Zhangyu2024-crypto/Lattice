import {
  Cloud,
  Cpu,
  Puzzle,
  Settings2,
  Sparkles,
  type LucideIcon,
} from 'lucide-react'

export type SettingsTabId =
  | 'general'
  | 'models'
  | 'compute'
  | 'sync'
  | 'extensions'

export interface TabDef {
  id: SettingsTabId
  label: string
  description: string
  icon: LucideIcon
}

export const SETTINGS_TABS: readonly TabDef[] = [
  {
    id: 'general',
    label: 'General',
    description: 'Permissions & preferences',
    icon: Settings2,
  },
  {
    id: 'models',
    label: 'Models',
    description: 'Providers & default model',
    icon: Sparkles,
  },
  {
    id: 'compute',
    label: 'Compute',
    description: 'Bundled Python stack (LAMMPS / CP2K) & optional Docker',
    icon: Cpu,
  },
  {
    id: 'sync',
    label: 'Cloud sync',
    description: 'WebDAV / rclone backup & sync',
    icon: Cloud,
  },
  {
    id: 'extensions',
    label: 'Extensions',
    description: 'Plugins & MCP servers',
    icon: Puzzle,
  },
]
