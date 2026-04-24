import { useState, useRef, useCallback, useMemo } from 'react'
import { X, Plus } from 'lucide-react'

interface Props {
  tags: string[]
  allTags: string[]
  onAdd: (tag: string) => void
  onRemove: (tag: string) => void
  placeholder?: string
}

export default function TagChipBar({ tags, allTags, onAdd, onRemove, placeholder }: Props) {
  const [input, setInput] = useState('')
  const [focused, setFocused] = useState(false)
  const [showInput, setShowInput] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const suggestions = useMemo(() => {
    if (!input.trim()) return []
    const q = input.toLowerCase()
    return allTags
      .filter((t) => t.toLowerCase().includes(q) && !tags.includes(t))
      .slice(0, 8)
  }, [input, allTags, tags])

  const handleAdd = useCallback(
    (tag: string) => {
      const trimmed = tag.trim().toLowerCase()
      if (!trimmed || tags.includes(trimmed)) return
      onAdd(trimmed)
      setInput('')
    },
    [tags, onAdd],
  )

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (suggestions.length > 0) handleAdd(suggestions[0])
      else if (input.trim()) handleAdd(input)
    }
    if (e.key === 'Escape') {
      setShowInput(false)
      setInput('')
    }
  }

  const openInput = () => {
    setShowInput(true)
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, position: 'relative' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
        {tags.map((tag) => (
          <span
            key={tag}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 2,
              padding: '1px 6px',
              fontSize: "var(--text-xxs)",
              borderRadius: 3,
              background: '#1a3a5c',
              color: '#58a6ff',
              whiteSpace: 'nowrap',
            }}
          >
            {tag}
            <button
              type="button"
              onClick={() => onRemove(tag)}
              style={{
                background: 'none',
                border: 'none',
                color: 'inherit',
                cursor: 'pointer',
                padding: 0,
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <X size={9} />
            </button>
          </span>
        ))}
        {showInput ? (
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => setFocused(true)}
            onBlur={() => {
              setTimeout(() => {
                setFocused(false)
                if (!input.trim()) setShowInput(false)
              }, 150)
            }}
            placeholder={placeholder ?? 'tag...'}
            style={{
              width: 80,
              background: '#2a2a2a',
              border: '1px solid #444',
              borderRadius: 3,
              outline: 'none',
              color: '#ccc',
              fontSize: "var(--text-xxs)",
              padding: '1px 4px',
            }}
          />
        ) : (
          <button
            type="button"
            onClick={openInput}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 2,
              padding: '1px 5px',
              fontSize: "var(--text-xxs)",
              borderRadius: 3,
              background: 'transparent',
              border: '1px dashed #555',
              color: '#888',
              cursor: 'pointer',
            }}
          >
            <Plus size={9} /> tag
          </button>
        )}
      </div>
      {focused && suggestions.length > 0 && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            zIndex: 50,
            background: '#252526',
            border: '1px solid #333',
            borderRadius: 3,
            maxHeight: 120,
            overflowY: 'auto',
            minWidth: 100,
          }}
        >
          {suggestions.map((s) => (
            <div
              key={s}
              onMouseDown={(e) => {
                e.preventDefault()
                handleAdd(s)
              }}
              style={{
                padding: '3px 8px',
                fontSize: "var(--text-xs)",
                cursor: 'pointer',
                color: '#ccc',
              }}
              onMouseEnter={(e) => {
                ;(e.currentTarget as HTMLDivElement).style.background = '#2a2d2e'
              }}
              onMouseLeave={(e) => {
                ;(e.currentTarget as HTMLDivElement).style.background = 'transparent'
              }}
            >
              {s}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
