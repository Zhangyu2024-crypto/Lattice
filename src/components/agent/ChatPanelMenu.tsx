// Dropdown menu hanging off ChatPanelHeader's ··· button.
//
// Research is launched through `/research <topic>` rather than duplicated
// in this menu. Keeping one entry point avoids split command semantics.

import { useRef } from 'react'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import { useOutsideClickDismiss } from '../../hooks/useOutsideClickDismiss'

interface Props {
  sessionTitle: string
  onClose: () => void
  onRenameSession: () => void
  onExport: (format: 'markdown' | 'json') => void
  /** Copy the entire conversation to the clipboard as Markdown. */
  onCopyConversation: () => void
  onClearChat: () => void
}

export default function ChatPanelMenu({
  sessionTitle,
  onClose,
  onRenameSession,
  onExport,
  onCopyConversation,
  onClearChat,
}: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEscapeKey(onClose)

  useOutsideClickDismiss(rootRef, true, onClose)

  const fire = (fn: () => void) => () => {
    fn()
    onClose()
  }

  return (
    <div ref={rootRef} className="chat-panel-menu">
      <Item onClick={fire(onRenameSession)}>Rename session</Item>

      <Divider />

      <SectionLabel>Export</SectionLabel>
      <Item onClick={fire(onCopyConversation)}>Copy conversation to clipboard</Item>
      <Item onClick={fire(() => onExport('markdown'))}>Download as Markdown (.md)</Item>
      <Item onClick={fire(() => onExport('json'))}>Download as JSON (.json)</Item>

      <Divider />

      <Item
        danger
        onClick={() => {
          if (
            !window.confirm(
              sessionTitle
                ? `Clear all messages in “${sessionTitle}”? This cannot be undone.`
                : 'Clear all messages in this session? This cannot be undone.',
            )
          ) {
            return
          }
          onClearChat()
          onClose()
        }}
      >
        Clear chat
      </Item>
    </div>
  )
}

function Item({
  onClick,
  children,
  active,
  danger,
}: {
  onClick: () => void
  children: React.ReactNode
  active?: boolean
  danger?: boolean
}) {
  const classes = [
    'chat-panel-menu-item',
    active ? 'is-active' : '',
    danger ? 'is-danger' : '',
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <button type="button" onClick={onClick} className={classes}>
      <span className="chat-panel-menu-item-label">{children}</span>
    </button>
  )
}

function Divider() {
  return <div className="chat-panel-menu-divider" />
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="chat-panel-menu-section-label">{children}</div>
}
