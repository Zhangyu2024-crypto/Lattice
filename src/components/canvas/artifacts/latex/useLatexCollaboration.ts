import { useEffect, useMemo, useRef, useState } from 'react'
import type { Extension } from '@codemirror/state'
import * as Y from 'yjs'
import { IndexeddbPersistence } from 'y-indexeddb'
import { WebsocketProvider } from 'y-websocket'
import { yCollab } from 'y-codemirror.next'
import type {
  LatexCollaborationMember,
  LatexCollaborationMetadata,
  LatexCollaborationRuntimeState,
} from '../../../../types/collaboration'
import { buildLatexCollaborationRoomName } from '../../../../lib/latex/collaboration'

interface Args {
  collaboration?: LatexCollaborationMetadata
  filePath: string
  initialText: string
  onRemoteText: (next: string) => void
}

interface Result {
  extension: Extension | null
  editorValue: string | null
  runtime: LatexCollaborationRuntimeState
}

type AwarenessState = {
  user?: {
    id?: string
    name?: string
    role?: LatexCollaborationMember['role']
    color?: string
  }
}

type CollabTicketState =
  | { status: 'none' }
  | { status: 'loading' }
  | { status: 'ready'; ticket: string; username?: string; userId?: string }
  | { status: 'error'; error: string }

export function useLatexCollaboration({
  collaboration,
  filePath,
  initialText,
  onRemoteText,
}: Args): Result {
  const initialTextRef = useRef(initialText)
  initialTextRef.current = initialText
  const [extension, setExtension] = useState<Extension | null>(null)
  const [editorValue, setEditorValue] = useState<string | null>(null)
  const [runtime, setRuntime] = useState<LatexCollaborationRuntimeState>({
    status: 'disabled',
    members: [],
  })

  const roomName = useMemo(() => {
    if (!collaboration?.enabled) return undefined
    return buildLatexCollaborationRoomName(collaboration, filePath)
  }, [collaboration, filePath])

  const [ticketState, setTicketState] = useState<CollabTicketState>({ status: 'none' })

  useEffect(() => {
    if (!collaboration?.enabled || !collaboration.serverUrl || !roomName) {
      setTicketState({ status: 'none' })
      return
    }
    let cancelled = false
    const api = window.electronAPI
    if (!api?.latticeAuthCollabTicket) {
      setTicketState({
        status: 'error',
        error: 'Lattice desktop login is required for online collaboration.',
      })
      return
    }
    if (!collaboration.roomAccessKey) {
      setTicketState({
        status: 'error',
        error: 'Collaboration room access key is missing.',
      })
      return
    }
    setTicketState({ status: 'loading' })
    api.latticeAuthCollabTicket({
      serverUrl: collaboration.serverUrl,
      projectId: collaboration.projectId,
      roomId: collaboration.roomId,
      roomName,
      roomAccessKey: collaboration.roomAccessKey,
      role: collaboration.role,
    })
      .then((result) => {
        if (cancelled) return
        if (result.ok) {
          setTicketState({
            status: 'ready',
            ticket: result.ticket,
            username: result.username,
            userId: result.userId,
          })
        } else {
          setTicketState({ status: 'error', error: result.error })
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setTicketState({
            status: 'error',
            error: err instanceof Error ? err.message : String(err),
          })
        }
      })
    return () => {
      cancelled = true
    }
  }, [
    collaboration?.enabled,
    collaboration?.serverUrl,
    collaboration?.projectId,
    collaboration?.roomId,
    collaboration?.roomAccessKey,
    collaboration?.role,
    roomName,
  ])

  useEffect(() => {
    if (!collaboration?.enabled || !roomName) {
      setExtension((cur) => (cur === null ? cur : null))
      setEditorValue(null)
      setRuntime({ status: 'disabled', members: [] })
      return
    }

    if (collaboration.serverUrl && ticketState.status !== 'ready') {
      setExtension((cur) => (cur === null ? cur : null))
      setEditorValue(null)
      setRuntime({
        status: ticketState.status === 'error' ? 'error' : 'connecting',
        error: ticketState.status === 'error' ? ticketState.error : undefined,
        members: [],
        roomName,
      })
      return
    }

    let disposed = false
    const ydoc = new Y.Doc()
    const ytext = ydoc.getText('latex')
    const undoManager = new Y.UndoManager(ytext)
    const persistence = new IndexeddbPersistence(`lattice:${roomName}`, ydoc)
    const provider =
      collaboration.serverUrl != null
        ? new WebsocketProvider(collaboration.serverUrl, roomName, ydoc, {
            connect: true,
            disableBc: false,
            params: {
              ticket: ticketState.status === 'ready' ? ticketState.ticket : '',
            },
          })
        : null
    const awareness = provider?.awareness ?? null
    const localMemberId =
      ticketState.status === 'ready' && ticketState.userId
        ? ticketState.userId
        : collaboration.localUserId
    const localMemberName =
      ticketState.status === 'ready' && ticketState.username
        ? ticketState.username
        : collaboration.localUserName

    const setLocalUser = () => {
      awareness?.setLocalStateField('user', {
        id: localMemberId,
        name: localMemberName,
        role: collaboration.role,
        color: collaboration.localUserColor,
      })
    }

    const collectMembers = (): LatexCollaborationMember[] => {
      const members = new Map<string, LatexCollaborationMember>()
      members.set(localMemberId, {
        id: localMemberId,
        name: localMemberName,
        role: collaboration.role,
        color: collaboration.localUserColor,
        isLocal: true,
        lastSeenAt: Date.now(),
      })
      awareness?.getStates().forEach((state: AwarenessState, clientId) => {
        const user = state.user
        if (!user?.id || user.id === localMemberId) return
        members.set(user.id, {
          id: user.id,
          name: user.name || `Peer ${clientId}`,
          role: user.role ?? 'editor',
          color: user.color || '#64748b',
          lastSeenAt: Date.now(),
        })
      })
      return Array.from(members.values())
    }

    const updateMembers = () => {
      setRuntime((cur) => ({ ...cur, members: collectMembers(), roomName }))
    }

    const markStatus = (
      status: LatexCollaborationRuntimeState['status'],
      error?: string,
    ) => {
      setRuntime({
        status,
        error,
        members: collectMembers(),
        roomName,
      })
    }

    const seed = () => {
      if (ytext.length > 0 || collaboration.initialSync === 'prefer-room') return
      ytext.insert(0, initialTextRef.current)
    }

    const handleYText = () => {
      if (disposed) return
      const next = ytext.toString()
      setEditorValue(next)
      onRemoteText(next)
    }

    persistence.whenSynced
      .then(() => {
        if (disposed) return
        ydoc.transact(seed)
        setEditorValue(ytext.toString())
        setExtension(yCollab(ytext, awareness, { undoManager }))
        handleYText()
      })
      .catch((err: unknown) => {
        if (disposed) return
        markStatus(
          provider ? 'connecting' : 'local-only',
          err instanceof Error ? err.message : String(err),
        )
      })

    ytext.observe(handleYText)
    setLocalUser()
    awareness?.on('change', updateMembers)
    provider?.on('status', ({ status }: { status: 'connected' | 'disconnected' | 'connecting' }) => {
      if (status === 'connected') markStatus('connected')
      else if (status === 'connecting') markStatus('connecting')
      else markStatus('disconnected')
    })
    provider?.on('connection-error', (event: Event) => {
      markStatus('error', event.type || 'Connection error')
    })

    markStatus(provider ? 'connecting' : 'local-only')

    return () => {
      disposed = true
      setExtension((cur) => (cur === null ? cur : null))
      setEditorValue(null)
      awareness?.off('change', updateMembers)
      provider?.destroy()
      ytext.unobserve(handleYText)
      undoManager.destroy()
      void persistence.destroy()
      ydoc.destroy()
    }
  }, [collaboration, roomName, filePath, onRemoteText, ticketState])

  return { extension, editorValue, runtime }
}
