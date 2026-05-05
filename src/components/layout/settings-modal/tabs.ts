import {
  Cloud,
  Cpu,
  Puzzle,
  CircleUserRound,
  ShieldCheck,
  Settings2,
  Sparkles,
  type LucideIcon,
} from 'lucide-react'

export type SettingsTabId =
  | 'account'
  | 'general'
  | 'models'
  | 'compute'
  | 'privacy'
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
    id: 'account',
    label: 'Account',
    description: 'Login, provider status & usage',
    icon: CircleUserRound,
  },
  {
    id: 'general',
    label: 'General',
    description: 'Permissions & preferences',
    icon: Settings2,
  },
  {
    id: 'models',
    label: 'Connections',
    description: 'Providers & default route',
    icon: Sparkles,
  },
  {
    id: 'compute',
    label: 'Compute',
    description: 'Bundled Python stack (LAMMPS / CP2K) & optional Docker',
    icon: Cpu,
  },
  {
    id: 'privacy',
    label: 'Privacy',
    description: 'Agreement, local audit logs & retention',
    icon: ShieldCheck,
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
