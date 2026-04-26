// Chat panel header — top strip for the AgentComposer showing the session
// title, mode hint, and a menu (export, clear chat). Research launches
// through the `/research <topic>` slash command.

import { useState, type CSSProperties, type ReactNode } from 'react'
import { ChevronDown, MessagesSquare } from 'lucide-react'
import type { ConversationMode } from '../../types/session'
import ChatPanelMenu from './ChatPanelMenu'
import ChatsDropdown from './ChatsDropdown'
import PermissionModePicker from './PermissionModePicker'

interface Props {
  sessionTitle: string
  chatMode: ConversationMode
  onRenameSession: () => void
  onExport: (format: 'markdown' | 'json') => void
  /** Copy the whole conversation as Markdown to the clipboard. */
  onCopyConversation: () => void
  onClearChat: () => void
  /** Create a new chat (.chat.json) in the workspace and switch to it. */
  onNewChat?: () => void
  /** Hide the chat panel entirely. Wired from App.tsx via toggleChat —
   *  reopen via the ActivityBar message icon or Ctrl+L. */
  onClosePanel?: () => void
}

const MODE_LABEL: Record<ConversationMode, string> = {
  dialog: 'dialog',
  agent: 'agent',
  research: 'research',
}

const MODE_COLOR: Record<ConversationMode, string> = {
  dialog: 'var(--color-text-muted)',
  agent: 'var(--color-accent-agent, var(--color-accent))',
  research: 'var(--color-accent)',
}

export default function ChatPanelHeader({
  sessionTitle,
  chatMode,
  onRenameSession,
  onExport,
  onCopyConversation,
  onClearChat,
  onNewChat,
  onClosePanel,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [chatsOpen, setChatsOpen] = useState(false)

  return (
    <div className="chat-panel-header">
      <button
        type="button"
        className="chat-panel-header-title"
        onClick={onRenameSession}
        title="Rename session"
      >
        <span className="chat-panel-header-title-text">
          {sessionTitle || 'Untitled session'}
        </span>
        {chatMode === 'research' && (
          <span
            className="chat-panel-header-mode"
            style={
              {
                '--chat-header-mode-color': MODE_COLOR.research,
              } as CSSProperties
            }
          >
            {MODE_LABEL.research}
          </span>
        )}
      </button>

      <PermissionModePicker />

      <div className="chat-panel-header-menu-slot">
        <button
          type="button"
          className={`chat-panel-header-icon-btn${chatsOpen ? ' is-active' : ''}`}
          onClick={() => setChatsOpen((v) => !v)}
          title="Browse chats"
          aria-haspopup="dialog"
          aria-expanded={chatsOpen}
        >
          <MessagesSquare size={12} strokeWidth={1.8} aria-hidden />
          <ChevronDown size={10} strokeWidth={1.8} aria-hidden />
        </button>
        {chatsOpen && (
          <ChatsDropdown
            onClose={() => setChatsOpen(false)}
            onNewChat={onNewChat}
          />
        )}
      </div>

      <div className="chat-panel-header-menu-slot">
        <IconBtn
          title="More actions"
          onClick={() => setMenuOpen((v) => !v)}
          active={menuOpen}
        >
          <span className="chat-panel-header-abbr">···</span>
        </IconBtn>
        {menuOpen && (
          <ChatPanelMenu
            sessionTitle={sessionTitle}
            onClose={() => setMenuOpen(false)}
            onRenameSession={onRenameSession}
            onExport={onExport}
            onCopyConversation={onCopyConversation}
            onClearChat={onClearChat}
          />
        )}
      </div>

      {onClosePanel && (
        <IconBtn
          title="Hide chat panel (Ctrl+L)"
          onClick={onClosePanel}
        >
          <span className="chat-panel-header-abbr">×</span>
        </IconBtn>
      )}
    </div>
  )
}

function IconBtn({
  title,
  onClick,
  active,
  children,
}: {
  title: string
  onClick: () => void
  active?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`chat-panel-header-icon-btn${active ? ' is-active' : ''}`}
    >
      {children}
    </button>
  )
}
