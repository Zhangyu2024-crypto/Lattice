// Horizontal bar of pending mention chips, rendered above the composer
// textarea. Each chip is removable; removal is delegated to the caller, which
// also owns the textarea text rewrite (see AgentComposer.removeMentionChip).
//
// Renders nothing when the chip list is empty so the composer chrome stays
// compact for the common case of a plain message.

import MentionChip from './MentionChip'
import type { MentionRef } from '../../types/mention'

export interface PendingMention {
  anchor: string
  ref: MentionRef
  label: string
}

interface Props {
  chips: PendingMention[]
  onRemove: (anchor: string) => void
}

export default function MentionChipsBar({ chips, onRemove }: Props) {
  if (chips.length === 0) return null
  return (
    <div className="mention-chips-bar" role="list" aria-label="Attached mentions">
      {chips.map((c) => (
        <MentionChip
          key={c.anchor}
          label={c.label}
          anchor={c.anchor}
          ref={c.ref}
          onRemove={() => onRemove(c.anchor)}
        />
      ))}
    </div>
  )
}
