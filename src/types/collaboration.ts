export type LatexCollaborationRole = 'owner' | 'editor' | 'reviewer' | 'viewer'

export type LatexCollaborationConnectionStatus =
  | 'disabled'
  | 'local-only'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'error'

export type LatexCollaborationInitialSync =
  | 'seed-from-artifact'
  | 'prefer-room'

export interface LatexCollaborationMember {
  id: string
  name: string
  role: LatexCollaborationRole
  color: string
  email?: string
  isLocal?: boolean
  lastSeenAt?: number
}

export interface LatexCollaborationMetadata {
  enabled: boolean
  provider: 'yjs-websocket'
  projectId: string
  roomId: string
  role: LatexCollaborationRole
  initialSync: LatexCollaborationInitialSync
  localUserId: string
  localUserName: string
  localUserColor: string
  serverUrl?: string
  workspaceRelDir?: string
  createdAt: number
  updatedAt: number
  lastConnectedAt?: number
}

export interface LatexCollaborationRuntimeState {
  status: LatexCollaborationConnectionStatus
  members: LatexCollaborationMember[]
  error?: string
  roomName?: string
}
