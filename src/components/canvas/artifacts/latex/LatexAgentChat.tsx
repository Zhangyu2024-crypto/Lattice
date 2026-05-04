// Creator-scoped AI assistant.
//
// Lives at the bottom of the LaTeX Creator card and exposes a small chat
// surface whose only purpose is to act on the *current* project — fix
// compile errors, reformat, polish prose, translate. Responses that wrap
// full file contents in a fenced block tagged `path=<file>` render an
// inline "Apply to <file>" button so the user's one click is the commit.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import {
  ChevronDown,
  ChevronUp,
  Eraser,
  Sparkles,
} from 'lucide-react'
import { sendLlmChat } from '../../../../lib/llm-chat'
import { toast } from '../../../../stores/toast-store'
import type {
  LatexCompileError,
  LatexDocumentPayload,
  LatexFile,
} from '../../../../types/latex'
import { ChatBubble } from './agent-chat/ChatBubble'
import { Composer } from './agent-chat/Composer'
import {
  SYSTEM_PROMPT,
  type ChatTurn,
  type ParsedCodeBlock,
} from './agent-chat/constants'
import {
  buildContextMessage,
  mergeDuplicateConsecutiveAssistantErrors,
  turnId,
} from './agent-chat/helpers'
import { normalizeLatexProjectPath } from '../../../../lib/latex/project-paths'

interface Props {
  files: LatexFile[]
  activeFile: string
  payload: LatexDocumentPayload
  errors: LatexCompileError[]
  warnings: LatexCompileError[]
  sessionId: string
  /** Replace the full contents of `path` with `content`. Parent owns the
   *  artifact store write + the CodeMirror view switch. */
  onApplyFile: (path: string, content: string) => void
  initialPrompt?: string | null
  onInitialPromptConsumed?: () => void
}

export default function LatexAgentChat({
  files,
  activeFile,
  payload,
  errors,
  warnings,
  sessionId,
  onApplyFile,
  initialPrompt,
  onInitialPromptConsumed,
}: Props) {
  const [expanded, setExpanded] = useState<boolean>(true)
  const [turns, setTurns] = useState<ChatTurn[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [appliedBlocks, setAppliedBlocks] = useState<Record<string, true>>({})
  const [copiedBlocks, setCopiedBlocks] = useState<Record<string, true>>({})

  const rootRef = useRef<HTMLDivElement | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const filesRef = useRef(files)
  filesRef.current = files
  const activeFileRef = useRef(activeFile)
  activeFileRef.current = activeFile
  const errorsRef = useRef(errors)
  errorsRef.current = errors
  const warningsRef = useRef(warnings)
  warningsRef.current = warnings
  const payloadRef = useRef(payload)
  payloadRef.current = payload

  const filesSet = useMemo(() => new Set(files.map((f) => f.path)), [files])
  const displayTurns = useMemo(
    () => mergeDuplicateConsecutiveAssistantErrors(turns),
    [turns],
  )

  useEffect(() => {
    if (!expanded) return
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [displayTurns, expanded])


  useEffect(() => {
    return () => {
      abortRef.current?.abort()
    }
  }, [])

  const issueBadge =
    errors.length + warnings.length > 0
      ? `${errors.length} err · ${warnings.length} warn`
      : null

  const submit = useCallback(
    async (userPrompt: string) => {
      const trimmed = userPrompt.trim()
      if (!trimmed || busy) return
      const userTurn: ChatTurn = {
        id: turnId(),
        role: 'user',
        content: trimmed,
        at: Date.now(),
      }
      const assistantTurn: ChatTurn = {
        id: turnId(),
        role: 'assistant',
        content: '',
        pending: true,
        at: Date.now(),
      }
      setTurns((prev) => [...prev, userTurn, assistantTurn])
      setInput('')
      setBusy(true)
      setExpanded(true)

      const controller = new AbortController()
      abortRef.current?.abort()
      abortRef.current = controller

      const userMessage = buildContextMessage(
        filesRef.current,
        activeFileRef.current,
        errorsRef.current,
        warningsRef.current,
        payloadRef.current.outline,
        payloadRef.current.rootFile,
        trimmed,
      )

      try {
        const result = await sendLlmChat({
          mode: 'agent',
          userMessage,
          transcript: [],
          sessionId,
        })
        if (!result.success) {
          setTurns((prev) =>
            prev.map((t) =>
              t.id === assistantTurn.id
                ? {
                    ...t,
                    pending: false,
                    error: true,
                    content: result.error ?? 'Assistant call failed.',
                  }
                : t,
            ),
          )
          return
        }
        setTurns((prev) =>
          prev.map((t) =>
            t.id === assistantTurn.id
              ? { ...t, pending: false, content: result.content }
              : t,
          ),
        )
      } catch (err) {
        setTurns((prev) =>
          prev.map((t) =>
            t.id === assistantTurn.id
              ? {
                  ...t,
                  pending: false,
                  error: true,
                  content: err instanceof Error ? err.message : String(err),
                }
              : t,
          ),
        )
      } finally {
        if (abortRef.current === controller) abortRef.current = null
        setBusy(false)
      }
    },
    [busy, sessionId],
  )

  useEffect(() => {
    const prompt = initialPrompt?.trim()
    if (!prompt) return
    if (busy) return
    onInitialPromptConsumed?.()
    void submit(prompt)
  }, [initialPrompt, busy, onInitialPromptConsumed, submit])

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void submit(input)
    }
  }

  const handleClear = () => {
    setTurns([])
    setAppliedBlocks({})
    setCopiedBlocks({})
  }

  const handleApply = (turnIdKey: string, block: ParsedCodeBlock) => {
    const target =
      normalizeLatexProjectPath(block.path ?? activeFile) || activeFile
    if (!filesRef.current.some((f) => f.path === target)) {
      toast.warn(`File "${target}" is not in the project.`)
      return
    }
    onApplyFile(target, block.content)
    setAppliedBlocks((prev) => ({
      ...prev,
      [`${turnIdKey}:${block.index}`]: true,
    }))
    toast.success(`Applied to ${target}`)
  }

  const handleCopy = async (turnIdKey: string, block: ParsedCodeBlock) => {
    try {
      await navigator.clipboard.writeText(block.content)
      setCopiedBlocks((prev) => ({
        ...prev,
        [`${turnIdKey}:${block.index}`]: true,
      }))
      const key = `${turnIdKey}:${block.index}`
      window.setTimeout(() => {
        setCopiedBlocks((prev) => {
          if (!(key in prev)) return prev
          const next = { ...prev }
          delete next[key]
          return next
        })
      }, 1400)
    } catch {
      toast.warn('Clipboard write failed')
    }
  }

  return (
    <div
      ref={rootRef}
      className={
        'latex-agent-chat' +
        (expanded ? ' is-expanded' : ' is-collapsed') +
        (turns.length > 0 ? ' has-transcript' : '')
      }
      aria-label="LaTeX assistant"
    >
      <div className="latex-agent-chat-header">
        <button
          type="button"
          className="latex-agent-chat-toggle"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
        >
          {expanded ? (
            <ChevronDown size={14} strokeWidth={2} aria-hidden />
          ) : (
            <ChevronUp size={14} strokeWidth={2} aria-hidden />
          )}
          <Sparkles size={14} strokeWidth={2} aria-hidden />
          <span className="latex-agent-chat-title">Assistant</span>
        </button>
        {issueBadge ? (
          <span className="latex-agent-chat-issues">{issueBadge}</span>
        ) : null}
        <span className="latex-agent-chat-spacer" />
        {turns.length > 0 ? (
          <button
            type="button"
            className="latex-agent-chat-clear"
            onClick={handleClear}
            title="Clear conversation"
            aria-label="Clear conversation"
          >
            <Eraser size={12} strokeWidth={2} aria-hidden />
            <span>Clear</span>
          </button>
        ) : null}
      </div>

      {expanded ? (
        <div className="latex-agent-chat-panel">
          {turns.length > 0 ? (
            <div
              ref={scrollRef}
              className="latex-agent-chat-transcript"
              role="log"
              aria-live="polite"
              aria-relevant="additions text"
              aria-atomic="false"
              aria-label="Creator assistant transcript"
            >
              {displayTurns.map((t) => (
                <ChatBubble
                  key={t.id}
                  turn={t}
                  filesSet={filesSet}
                  activeFile={activeFile}
                  appliedBlocks={appliedBlocks}
                  copiedBlocks={copiedBlocks}
                  onApply={(block) => handleApply(t.id, block)}
                  onCopy={(block) => void handleCopy(t.id, block)}
                />
              ))}
              <div className="chat-messages-end-spacer" aria-hidden />
            </div>
          ) : (
            <div className="latex-agent-chat-empty">
              <strong>Project actions</strong>
              <span>
                Use the actions below to fix compiler output, polish the active
                source, or draft paper sections. Proposed edits appear as
                reviewable file replacements with Apply buttons.
              </span>
            </div>
          )}

          <Composer
            ref={inputRef}
            input={input}
            busy={busy}
            issueCount={errors.length + warnings.length}
            onInputChange={setInput}
            onKeyDown={handleKeyDown}
            onSubmit={(prompt) => void submit(prompt)}
          />
        </div>
      ) : null}
    </div>
  )
}

// Internal helpers: if tests need them, import from the sources directly
// (`./agent-chat/helpers`, `./agent-chat/constants`). A named non-component
// export here would force Vite out of Fast Refresh into full-page reload.
