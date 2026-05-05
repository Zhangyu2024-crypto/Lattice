import { useEffect, useMemo, useRef, useState } from 'react'
import type { Extension } from '@codemirror/state'
import * as Y from 'yjs'
import * as awarenessProtocol from 'y-protocols/awareness'
import { IndexeddbPersistence } from 'y-indexeddb'
import { yCollab } from 'y-codemirror.next'
import type {
  LatexCollaborationMember,
  LatexCollaborationMetadata,
  LatexCollaborationRuntimeState,
} from '../../../../types/collaboration'
import { buildLatexCollaborationRoomName } from '../../../../lib/latex/collaboration'
import { EncryptedLatexCollaborationClient } from '../../../../lib/latex/encrypted-collaboration-client'
import { deriveRoomAccessKey } from '../../../../lib/latex/encrypted-collaboration'

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
  | {
      status: 'ready'
      ticket: string
      username?: string
      userId?: string
      roomSecret: string
    }
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
    if (!collaboration.roomSecret) {
      setTicketState({
        status: 'error',
        error: 'Collaboration encryption key is missing.',
      })
      return
    }
    const roomSecret = collaboration.roomSecret
    setTicketState({ status: 'loading' })
    deriveRoomAccessKey(roomSecret, roomName)
      .then((roomAccessKey) =>
        api.latticeAuthCollabTicket({
          serverUrl: collaboration.serverUrl,
          projectId: collaboration.projectId,
          roomId: collaboration.roomId,
          roomName,
          roomAccessKey,
          role: collaboration.role,
        }),
      )
      .then((result) => {
        if (cancelled) return
        if (result.ok) {
          setTicketState({
            status: 'ready',
            ticket: result.ticket,
            username: result.username,
            userId: result.userId,
            roomSecret,
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
    collaboration?.roomSecret,
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
    const awareness = new awarenessProtocol.Awareness(ydoc)
    const provider =
      collaboration.serverUrl != null && collaboration.roomSecret
        ? new EncryptedLatexCollaborationClient({
            serverUrl: collaboration.serverUrl,
            roomName,
            ticket: ticketState.status === 'ready' ? ticketState.ticket : '',
            roomSecret: ticketState.status === 'ready' ? ticketState.roomSecret : '',
            doc: ydoc,
            awareness,
            onStatus: (status) => {
              if (status === 'connected') markStatus('connected')
              else if (status === 'connecting') markStatus('connecting')
              else markStatus('disconnected')
            },
            onError: (error) => markStatus('error', error),
          })
        : null
    const localMemberId =
      ticketState.status === 'ready' && ticketState.userId
        ? ticketState.userId
        : collaboration.localUserId
    const localMemberName =
      ticketState.status === 'ready' && ticketState.username
        ? ticketState.username
        : collaboration.localUserName

    const setLocalUser = () => {
      awareness.setLocalStateField('user', {
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
      awareness.getStates().forEach((state: AwarenessState, clientId) => {
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
    awareness.on('change', updateMembers)
    provider?.connect()

    markStatus(provider ? 'connecting' : 'local-only')

    return () => {
      disposed = true
      setExtension((cur) => (cur === null ? cur : null))
      setEditorValue(null)
      awareness.off('change', updateMembers)
      provider?.destroy()
      ytext.unobserve(handleYText)
      undoManager.destroy()
      void persistence.destroy()
      awareness.destroy()
      ydoc.destroy()
    }
  }, [collaboration, roomName, filePath, onRemoteText, ticketState])

  return { extension, editorValue, runtime }
}
