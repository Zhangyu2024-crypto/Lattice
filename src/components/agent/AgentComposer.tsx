import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useAppStore } from '../../stores/app-store'
import { useAgentDialogStore } from '../../stores/agent-dialog-store'
import { latticeBackendAgentPreferred } from '../../lib/lattice-backend-agent'
import { submitAgentPrompt } from '../../lib/agent-submit'
import { clearPendingApprovals } from '../../lib/agent-orchestrator-approvals'
import {
  dispatchComposerPrefill,
  useComposerFocusListener,
  useComposerMentionListener,
  useComposerPrefillListener,
  type ComposerPrefillRequest,
  type MentionAddRequest,
} from '../../lib/composer-bus'
import {
  dispatchSlashCommand,
  findCommand,
  listCommands,
  parseSlashCommand,
  type Command as SlashCommand,
  type DispatchHooks,
} from '../../lib/slash-commands'
import { rankCommands } from '../../lib/slash-commands/fuzzy'
import {
  ensureSlashCommandCachesWarm,
  getSlashCommandWarmVersion,
  subscribeSlashCommandWarm,
  warmSlashCommandCaches,
} from '../../lib/slash-commands/warm-on-demand'
import SlashTypeahead from './SlashTypeahead'

import {
  getActiveTranscript,
  getSessionChatMode,
  selectActiveSession,
  mentionablesForSession,
  selectRecentMentions,
  useSessionStore,
} from '../../stores/session-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import {
  pdfQuoteMentionables,
  usePdfQuoteStore,
} from '../../stores/pdf-quote-store'
import ChatPanelHeader from './ChatPanelHeader'
import { toast } from '../../stores/toast-store'
import { copyText } from '../../lib/clipboard-helper'
import { asyncPrompt } from '../../lib/prompt-dialog'
import {
  exportSessionChat,
  serializeSessionAsMarkdown,
} from '../../lib/conversation-export'
import { useResolvedModel } from '../../stores/llm-config-store'
import { publicModelLabel } from '../../lib/model-display'
import { generateMentionAnchor } from '../../types/mention'
import type { Mentionable } from '../../types/mention-resolver'
import type { TaskStep } from '../../types/session'
import {
  ArrowUp,
  ClipboardCopy,
  Download,
  Plus,
  Square,
  X,
} from 'lucide-react'
import { TableActions } from '../common/TableActions'
import { specFromTableElement } from '../../lib/table-export-dom'
import ModelChip from '../common/panel/ModelChip'
import AgentModelPickerPopover from './AgentModelPickerPopover'
import ModelRouteBadge from './ModelRouteBadge'
import MentionPicker from '../mention/MentionPicker'
import MentionChipsBar, {
  type PendingMention,
} from '../mention/MentionChipsBar'
import MessageBubble from './bubble/MessageBubble'
import { useOutsideClickDismiss } from '../../hooks/useOutsideClickDismiss'
interface Props {
  onOpenLLMConfig?: () => void
  /** Prepare thread for a research agent flow (from menu / host). The
   *  planner decides Brief vs Survey from topic breadth. */
  onStartResearch?: (topic?: string) => void
  /** Called when the user clicks the X in the chat header. Parent flips
   *  `layout.chatVisible` so the panel hides. Reopen via the
   *  ActivityBar message icon or Ctrl+L. No-op if omitted. */
  onClosePanel?: () => void
  /**
   * Visual chrome variant.
   * - `'full'` (default): right-rail appearance — panel header with
   *   segmented mode toggle + connection dot + model chip, task
   *   timeline, sidebar-tinted background.
   * - `'embedded'`: minimal — just transcript + composer input. Used
   *   when this component sits inside another shell that already owns
   *   the mode toggle and chrome header. Background is transparent so
   *   the host surface's colour shows through instead of painting a
   *   darker sidebar strip.
   */
  chrome?: 'full' | 'embedded'
  /** Show the conversation strip even when embedded in another shell. */
  showConversationHeader?: boolean
  /** Show agent toolbar (model chip + task timeline) even when embedded. */
  showModeToolbar?: boolean
}

// Stable empty-array sentinel for MessageBubble's tool-step derivation. Must
// not be inlined as `[]` anywhere a selector/useMemo depends on it — the
// reference is load-bearing for React's getSnapshot equality check.
const EMPTY_TOOL_STEPS: readonly TaskStep[] = Object.freeze([])

const MAX_COMPOSER_IMAGES = 6
const MAX_IMAGE_FILE_BYTES = 4 * 1024 * 1024

type PendingComposerImage = {
  id: string
  mediaType: string
  base64: string
  previewUrl: string
}

function newPendingImageId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return `img_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
  }
}

function readFileAsBase64Parts(
  file: File,
): Promise<{ mediaType: string; base64: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const s = reader.result
      if (typeof s !== 'string') {
        reject(new Error('read failed'))
        return
      }
      const m = /^data:([^;]+);base64,(.+)$/.exec(s)
      if (!m) {
        reject(new Error('not base64 data url'))
        return
      }
      resolve({ mediaType: m[1], base64: m[2] })
    }
    reader.onerror = () => reject(reader.error ?? new Error('read error'))
    reader.readAsDataURL(file)
  })
}

// When looking for the `@` trigger we scan back from the cursor for the
// nearest `@` that (a) has only non-whitespace + non-`@` chars after it and
// (b) is either at line/string start or preceded by whitespace.
function findActiveTrigger(
  text: string,
  cursor: number,
): { start: number; query: string } | null {
  // Walk backwards until we hit whitespace, another @, or string start.
  for (let i = cursor - 1; i >= 0; i--) {
    const ch = text[i]
    if (ch === '@') {
      const prev = i === 0 ? '' : text[i - 1]
      // `@` must be preceded by whitespace or be the very first char of the
      // textarea. This avoids matching emails like "foo@bar".
      if (prev !== '' && !/\s/.test(prev)) return null
      const query = text.slice(i + 1, cursor)
      // Abort if the slice contains a newline, a second `@`, or a closing
      // bracket `]` — the latter means the user typed a completed mention
      // token `@[label]` and moved on.
      if (/[\n\r\]]/.test(query)) return null
      return { start: i, query }
    }
    if (ch === '\n' || ch === '\r') return null
    // We allow spaces inside the query (so picker search tolerates multi-
    // word fragments) — but a whitespace run of 2+ cancels the trigger.
    if (/\s/.test(ch) && /\s/.test(text[i - 1] ?? '')) return null
  }
  return null
}


// Slash-typeahead trigger. Much simpler than mention detection: the slash
// only counts at column 0 (the draft *begins* with `/`) and the typeahead
// stays open only while the caret is still inside the first whitespace-free
// run (the command name). Returns the lowercased query, or null when the
// typeahead should be closed.
function findSlashQuery(text: string, cursor: number): string | null {
  if (text[0] !== '/') return null
  // Once any whitespace appears before the caret the user is typing args,
  // not the name — close the typeahead.
  const before = text.slice(0, cursor)
  if (/\s/.test(before)) return null
  return text.slice(1, cursor).toLowerCase()
}

export default function AgentComposer({
  onOpenLLMConfig,
  onStartResearch,
  onClosePanel,
  chrome = 'full',
  showConversationHeader,
  showModeToolbar,
}: Props) {
  const session = useSessionStore(selectActiveSession)
  const isConnected = useAppStore((s) => s.isConnected)
  const renameSession = useSessionStore((s) => s.renameSession)
  const clearTranscript = useSessionStore((s) => s.clearTranscript)
  const setChatMode = useSessionStore((s) => s.setChatMode)
  const createSession = useSessionStore((s) => s.createSession)
  const setActiveSession = useSessionStore((s) => s.setActiveSession)
  const resolvedModel = useResolvedModel('agent')
  const agentModelLabel = publicModelLabel(resolvedModel)

  // Mentionable source data — the store knows nothing about the UI; all
  // ranking / filtering lives in MentionPicker. The derivation is memoised
  // locally instead of being subscribed via a zustand selector: the array
  // is rebuilt from scratch on each call and a plain `useSessionStore`
  // subscription would trip React's "getSnapshot should be cached"
  // infinite-update bailout.
  //
  // Dependency list is intentionally narrow — `[session]` would invalidate
  // on every streaming token (each token mutates `session.transcript` and
  // so the session reference), which forced a full mentionables rebuild
  // + downstream MentionPicker re-render 20–50x per reply. The picker
  // only cares about files, artifacts, the focused artifact id, and the
  // workspace root index (the second reads from `useWorkspaceStore` inside
  // `mentionablesForSession`; without subscribing here the picker would
  // never pick up freshly-scanned files).
  const workspaceFileIndex = useWorkspaceStore((s) => s.fileIndex)
  // PDF passages the user sent to AI (from Library / PDF reader) live in
  // a separate store so they cross sessions; subscribe so newly-highlighted
  // quotes show up in the @ picker without needing a reopen.
  const pdfQuotes = usePdfQuoteStore((s) => s.quotes)
  const mentionables = useMemo(
    () => [
      ...mentionablesForSession(session),
      ...pdfQuoteMentionables(),
    ],
    [
      session?.id,
      session?.files,
      session?.artifacts,
      session?.artifactOrder,
      session?.focusedArtifactId,
      workspaceFileIndex,
      pdfQuotes,
    ],
  )
  const recentMentions = useSessionStore(selectRecentMentions)
  const pushRecentMention = useSessionStore((s) => s.pushRecentMention)

  const [input, setInput] = useState('')
  const [pendingMentions, setPendingMentions] = useState<PendingMention[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerQuery, setPickerQuery] = useState('')
  // Slash-command typeahead: open when the draft starts with `/` and the
  // cursor is still inside the first whitespace-free run (the command name).
  // `slashQuery` is the name-so-far (lowercased); `slashIdx` is the highlighted
  // row in the dropdown.
  const [slashQuery, setSlashQuery] = useState<string | null>(null)
  const [slashIdx, setSlashIdx] = useState(0)
  const [slashWarmVersion, setSlashWarmVersion] = useState(
    getSlashCommandWarmVersion,
  )
  const [isLoading, setIsLoading] = useState(false)
  const [pendingImages, setPendingImages] = useState<PendingComposerImage[]>(
    [],
  )
  const [addMenuOpen, setAddMenuOpen] = useState(false)

  const endRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  // Transcript scroll container — owned by this component so the scroll
  // handler and the auto-scroll effect can read/write scroll state.
  const messagesRef = useRef<HTMLDivElement>(null)
  // Tracks whether the user has manually scrolled up from the bottom.
  // While true we suppress the auto-scroll-on-new-content effect so the
  // chat never yanks them off what they're reading. A ref (not state)
  // because the scroll handler fires rapidly and we only need the latest
  // value during the next render's effect run.
  const userScrolledUpRef = useRef(false)
  // Mirrors `userScrolledUpRef` into React state so the Jump-to-latest
  // pill re-renders when the user's scroll position changes. Updated
  // only on transitions (not on every wheel tick).
  const [showJumpToLatest, setShowJumpToLatest] = useState(false)
  const [modelPickerOpen, setModelPickerOpen] = useState(false)
  const modelChipAnchorRef = useRef<HTMLDivElement | null>(null)
  const addMenuWrapRef = useRef<HTMLDivElement | null>(null)
  const imageFileInputRef = useRef<HTMLInputElement | null>(null)
  // IME composition guard: while the user is composing a CJK glyph the `@`
  // we see may just be a candidate selector, not a real trigger.
  const isComposingRef = useRef(false)
  // Tracks the cursor position at the moment of each onChange so the trigger
  // detector always scans from the right spot.
  const lastCursorRef = useRef(0)
  // Mirror of `pendingMentions` for callbacks that want the latest list
  // without re-subscribing on every change. Updated synchronously after
  // each commit; reads are intentionally a snapshot, never stale by more
  // than one render.
  const pendingMentionsRef = useRef(pendingMentions)
  useEffect(() => {
    pendingMentionsRef.current = pendingMentions
  }, [pendingMentions])

  const pendingImagesRef = useRef(pendingImages)
  useEffect(() => {
    pendingImagesRef.current = pendingImages
  }, [pendingImages])

  useEffect(() => {
    return () => {
      for (const p of pendingImagesRef.current) {
        URL.revokeObjectURL(p.previewUrl)
      }
    }
  }, [])

  // Outside-click dismiss uses the shared hook; the inline keydown
  // listener stays local so we can close on Escape without pulling in
  // useEscapeKey's `preventDefault` (the add menu shouldn't swallow
  // Escape from anything else above it in the tree).
  const closeAddMenu = useCallback(() => setAddMenuOpen(false), [])
  useOutsideClickDismiss(addMenuWrapRef, addMenuOpen, closeAddMenu)
  useEffect(() => {
    if (!addMenuOpen) return
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') setAddMenuOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
    }
  }, [addMenuOpen])

  // Cancel handle for the currently-running Agent turn. Aborted on unmount
  // so a slow agent loop doesn't keep running (or mutating the session
  // store) after the user navigated away.
  const abortRef = useRef<AbortController | null>(null)
  // Per-submit overrides seeded by a prefill event (e.g. research flows
  // need a 12-iteration ceiling). Consumed and cleared on the next send so
  // ordinary subsequent submits revert to the orchestrator default.
  const nextMaxIterationsRef = useRef<number | undefined>(undefined)
  const stopCurrentRun = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    useAgentDialogStore.getState().reset()
    clearPendingApprovals()
    setIsLoading(false)
  }, [])
  useEffect(() => {
    return () => {
      abortRef.current?.abort()
      abortRef.current = null
      useAgentDialogStore.getState().reset()
      clearPendingApprovals()
    }
  }, [])

  const transcript = session ? getActiveTranscript(session) : []

  // Filter + rank the slash registry by the typed query. `listCommands` is
  // a cheap synchronous scan over the memoized registry; recomputing on
  // every keystroke is fine at the ~10-60 command scale we expect.
  // `rankCommands` returns the whole registry in registry order for an
  // empty query (bare `/` lets the user browse), and a scored list
  // otherwise.
  const slashMatches = useMemo<SlashCommand[]>(() => {
    if (slashQuery === null) return []
    const all = listCommands({ userInvocableOnly: true, enabledOnly: true })
    return rankCommands(all, slashQuery)
  }, [slashQuery, slashWarmVersion])

  useEffect(
    () =>
      subscribeSlashCommandWarm(() => {
        setSlashWarmVersion(getSlashCommandWarmVersion())
      }),
    [],
  )

  // Keep the highlighted row in range when the match list shrinks below
  // the current selection — otherwise Enter would commit against a stale
  // index and silently do nothing.
  useEffect(() => {
    if (slashIdx >= slashMatches.length) setSlashIdx(0)
  }, [slashIdx, slashMatches.length])

  const hasConversationHeader =
    showConversationHeader ?? chrome === 'full'
  const hasModeToolbar = showModeToolbar ?? chrome === 'full'

  // Legacy: dialog mode is normalized to agent (single session thread).
  useEffect(() => {
    if (!session) return
    if (session.chatMode !== 'dialog') return
    setChatMode(session.id, 'agent')
  }, [session?.id, session?.chatMode, setChatMode])

  // Stable fingerprint of the transcript that changes on (a) message
  // added/removed and (b) any message's content length growing. This is
  // what we want the auto-scroll effect to depend on — `transcript.length`
  // alone misses streaming content deltas since the array stays the same
  // size while the final bubble's body grows. Cheaper than a deep compare
  // and still O(n) in visible messages.
  const transcriptContentHash = useMemo(
    () => transcript.map((m) => `${m.id}:${m.content.length}`).join('|'),
    [transcript],
  )

  // Minute-tick so relative timestamps in the bubble meta row update
  // without per-bubble intervals.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const iv = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(iv)
  }, [])

  // ── Per-bubble props precomputed at the parent ─────────────────────
  // MessageBubble no longer subscribes to `selectActiveSession` — that
  // caused every bubble to re-render on every streaming token because
  // the session reference changes per-token. Instead we compute the
  // two session-derived values here (toolSteps and relTime strings) and
  // thread them as primitive-stable props. `React.memo` on MessageBubble
  // now correctly bails out for unchanged bubbles during streaming.
  const toolStepsByMessage = useMemo(() => {
    const map = new Map<string, TaskStep[]>()
    if (!session) return map
    for (const taskId of session.taskOrder) {
      const task = session.tasks[taskId]
      if (!task) continue
      const rootId = task.rootMessageId
      if (!rootId) continue
      const steps = task.steps.filter((s) => s.kind === 'tool_call')
      if (steps.length > 0) map.set(rootId, steps)
    }
    return map
  }, [session?.taskOrder, session?.tasks])

  // Pre-format every transcript message's relative time once per minute
  // tick. Strings are primitives; when a bubble's formatted string did
  // not change tick-to-tick its `React.memo` skips the re-render. Only
  // recent messages whose bucket actually crossed (e.g. "just now" →
  // "1m ago") get a new prop value.
  const relTimeByMessage = useMemo(() => {
    const map = new Map<string, string>()
    for (const m of transcript) {
      map.set(m.id, formatRelativeTime(m.timestamp, now) ?? '')
    }
    return map
  }, [transcript, now])

  useEffect(() => {
    // Respect the user's current scroll position. If they've scrolled up
    // to read history we must NOT jerk them back to the bottom when a
    // streaming delta arrives — `overflow-anchor` handles the visual
    // stability; our job is just to withhold the programmatic scroll.
    if (userScrolledUpRef.current) return
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [transcriptContentHash])

  // Fired on every user scroll of the transcript. A 24px slack from the
  // bottom counts as "at the bottom" — the browser rounds fractional
  // scrollTops and a smooth-scroll lands a pixel or two short on some
  // platforms. We only flip state on transitions to avoid re-renders
  // during a continuous drag.
  const handleMessagesScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      const el = e.currentTarget
      const distanceFromBottom =
        el.scrollHeight - el.scrollTop - el.clientHeight
      const isUp = distanceFromBottom > 24
      if (isUp !== userScrolledUpRef.current) {
        userScrolledUpRef.current = isUp
        setShowJumpToLatest(isUp)
      }
    },
    [],
  )

  const handleJumpToLatest = useCallback(() => {
    userScrolledUpRef.current = false
    setShowJumpToLatest(false)
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  // While the lattice backend streams over WS, the last row is already an
  // `assistant` bubble — avoid a second "thinking" strip under it. Local /
  // dialog runs use a `thinking_*` placeholder row instead.
  const lastTranscriptRole = transcript[transcript.length - 1]?.role
  const showThinkingRow = isLoading && lastTranscriptRole !== 'assistant'

  // ── Textarea handlers ────────────────────────────────────────────────────
  // Single source of truth for the auto-grow ceiling. The CSS caps
  // `.chat-input { max-height }` at `--chat-input-max-h` and we parse
  // the same variable here so a design token change lands in both
  // places simultaneously.
  const syncTextareaHeight = (el: HTMLTextAreaElement) => {
    el.style.height = '32px'
    const raw = getComputedStyle(document.documentElement).getPropertyValue(
      '--chat-input-max-h',
    )
    const parsed = parseInt(raw.trim(), 10)
    const maxH = Number.isFinite(parsed) && parsed > 0 ? parsed : 140
    el.style.height = Math.min(el.scrollHeight, maxH) + 'px'
  }

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const el = e.target
    const nextValue = el.value
    const cursor = el.selectionStart ?? nextValue.length
    lastCursorRef.current = cursor
    setInput(nextValue)
    syncTextareaHeight(el)

    if (isComposingRef.current) return

    const trigger = findActiveTrigger(nextValue, cursor)
    if (trigger) {
      if (!pickerOpen) setPickerOpen(true)
      setPickerQuery(trigger.query)
    } else if (pickerOpen) {
      setPickerOpen(false)
      setPickerQuery('')
    }

    // Slash typeahead: computed off the new value so one render covers both
    // branches. Reset the highlight when the query transitions from closed
    // to open so navigation starts at the first match.
    const nextSlash = findSlashQuery(nextValue, cursor)
    if (nextSlash !== slashQuery) {
      if (slashQuery === null && nextSlash !== null) setSlashIdx(0)
      setSlashQuery(nextSlash)
    }
    if (nextSlash !== null) ensureSlashCommandCachesWarm()
  }

  // Track cursor moves that don't change the text (arrow keys, click). We
  // need this so the picker can close once the caret wanders away from the
  // `@` token.
  const handleSelect = () => {
    if (isComposingRef.current) return
    const el = textareaRef.current
    if (!el) return
    const cursor = el.selectionStart ?? 0
    lastCursorRef.current = cursor
    const trigger = findActiveTrigger(el.value, cursor)
    if (!trigger && pickerOpen) {
      setPickerOpen(false)
      setPickerQuery('')
    } else if (trigger && pickerOpen) {
      setPickerQuery(trigger.query)
    }

    const nextSlash = findSlashQuery(el.value, cursor)
    if (nextSlash !== slashQuery) {
      if (slashQuery === null && nextSlash !== null) setSlashIdx(0)
      setSlashQuery(nextSlash)
    }
    if (nextSlash !== null) ensureSlashCommandCachesWarm()
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // IME composition guard. `isComposingRef` (set in onCompositionStart)
    // is a fallback; `e.nativeEvent.isComposing` is the canonical flag
    // and `e.keyCode === 229` is the historical "IME active" sentinel
    // still emitted by some Chromium builds. Without this belt-and-
    // suspenders check, pressing Enter to CONFIRM a Pinyin/Japanese/
    // Korean candidate would fire our submit handler — shipping half-
    // typed pinyin to the agent and leaving the IME's committed glyph
    // stranded in the textarea after send.
    const composing =
      e.nativeEvent.isComposing ||
      e.keyCode === 229 ||
      isComposingRef.current ||
      compositionJustEndedRef.current

    // Slash typeahead takes precedence over the mention picker — they
    // can't both be open at the same time anyway (the draft either
    // starts with `/` or it doesn't), but the early-return keeps the
    // two branches cleanly separated.
    if (slashQuery !== null && slashMatches.length > 0 && !composing) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSlashIdx((i) => Math.min(slashMatches.length - 1, i + 1))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSlashIdx((i) => Math.max(0, i - 1))
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        const chosen = slashMatches[slashIdx]
        if (chosen) commitSlashSelection(chosen)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setSlashQuery(null)
        setSlashIdx(0)
        return
      }
    }

    // MentionPicker has its own document-level capture listener for its keys;
    // but we must stop Enter from sending the message while it is open.
    // Only block when a genuine trigger is still active — if the trigger
    // collapsed (e.g. user typed `]` to close a `@[label]` token) the
    // picker will close on the next onChange; don't swallow Enter in the
    // interim.
    if (pickerOpen && !composing) {
      const el = e.currentTarget
      const cursor = el.selectionStart ?? el.value.length
      const hasTrigger = findActiveTrigger(el.value, cursor)
      if (hasTrigger) {
        if (
          e.key === 'Enter' ||
          e.key === 'Tab' ||
          e.key === 'ArrowUp' ||
          e.key === 'ArrowDown' ||
          e.key === 'Escape'
        ) {
          e.preventDefault()
          return
        }
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && !composing) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleCompositionStart = () => {
    isComposingRef.current = true
    // During composition we suppress the picker — a stale one would be
    // confusing while the IME is open.
    if (pickerOpen) {
      setPickerOpen(false)
      setPickerQuery('')
    }
    if (slashQuery !== null) {
      setSlashQuery(null)
      setSlashIdx(0)
    }
  }
  const compositionJustEndedRef = useRef(false)
  const handleCompositionEnd = (
    e: React.CompositionEvent<HTMLTextAreaElement>,
  ) => {
    isComposingRef.current = false
    // Guard against the Chromium race where compositionEnd fires BEFORE
    // the keydown for the Enter that confirmed the IME candidate. Without
    // this, the Enter-to-confirm gets treated as Enter-to-send, eating
    // the composed character and shipping a half-typed message.
    compositionJustEndedRef.current = true
    requestAnimationFrame(() => { compositionJustEndedRef.current = false })
    // Re-evaluate the trigger once composition resolves — if the composed
    // text happens to start with `@` we want the picker to open naturally.
    const el = e.currentTarget
    const cursor = el.selectionStart ?? el.value.length
    const trigger = findActiveTrigger(el.value, cursor)
    if (trigger) {
      setPickerOpen(true)
      setPickerQuery(trigger.query)
    }
  }

  // ── Mention selection / removal ──────────────────────────────────────────
  const handleSelectMentionable = useCallback(
    (m: Mentionable) => {
      const el = textareaRef.current
      if (!el) return
      const cursor = el.selectionStart ?? el.value.length
      const trigger = findActiveTrigger(el.value, cursor)
      if (!trigger) {
        setPickerOpen(false)
        return
      }
      // Command rows insert literal text instead of creating a chip.
      if (m.commandInsert) {
        const before = el.value.slice(0, trigger.start)
        const after = el.value.slice(cursor)
        const nextValue = before + m.commandInsert + after
        const nextCursor = before.length + m.commandInsert.length
        setInput(nextValue)
        setPickerOpen(false)
        setPickerQuery('')
        requestAnimationFrame(() => {
          const t = textareaRef.current
          if (!t) return
          t.focus()
          t.setSelectionRange(nextCursor, nextCursor)
          syncTextareaHeight(t)
        })
        return
      }
      const existingAnchors = new Set(pendingMentions.map((p) => p.anchor))
      const anchor = generateMentionAnchor(existingAnchors)
      const token = `@[${m.label}] `
      const before = el.value.slice(0, trigger.start)
      const after = el.value.slice(cursor)
      const nextValue = before + token + after
      const nextCursor = before.length + token.length

      setInput(nextValue)
      setPendingMentions((prev) => [
        ...prev,
        { anchor, ref: m.ref, label: m.label },
      ])
      if (session) pushRecentMention?.(session.id, m.ref)
      setPickerOpen(false)
      setPickerQuery('')

      // Restore caret + textarea height on the next frame so React has
      // committed `nextValue` before we mutate the DOM selection.
      requestAnimationFrame(() => {
        const t = textareaRef.current
        if (!t) return
        t.focus()
        t.setSelectionRange(nextCursor, nextCursor)
        syncTextareaHeight(t)
      })
    },
    [pendingMentions, pushRecentMention, session],
  )

  const handleRemoveChip = useCallback((anchor: string) => {
    const removed = pendingMentions.find((p) => p.anchor === anchor)
    setPendingMentions((prev) => prev.filter((p) => p.anchor !== anchor))
    if (removed) {
      const escaped = removed.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const re = new RegExp(`@\\[${escaped}\\]\\s?`)
      setInput((prev) => prev.replace(re, ''))
    }
  }, [pendingMentions])

  const insertMentionTrigger = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.focus()
    const start = el.selectionStart ?? input.length
    const end = el.selectionEnd ?? input.length
    const next = `${input.slice(0, start)}@${input.slice(end)}`
    setInput(next)
    setPickerOpen(true)
    setPickerQuery('')
    requestAnimationFrame(() => {
      const t = textareaRef.current
      if (!t) return
      const pos = start + 1
      t.setSelectionRange(pos, pos)
      syncTextareaHeight(t)
    })
  }, [input])

  const addFilesAsPending = useCallback(async (fileList: File[]) => {
    const collected: PendingComposerImage[] = []
    for (const file of fileList) {
      if (!file.type.startsWith('image/')) continue
      if (file.size > MAX_IMAGE_FILE_BYTES) {
        toast.warn(
          `Image too large (${file.name}). Max ${MAX_IMAGE_FILE_BYTES / 1024 / 1024} MB each.`,
        )
        continue
      }
      const room =
        MAX_COMPOSER_IMAGES -
        pendingImagesRef.current.length -
        collected.length
      if (room <= 0) {
        toast.warn(`At most ${MAX_COMPOSER_IMAGES} images per message.`)
        break
      }
      try {
        const { base64, mediaType } = await readFileAsBase64Parts(file)
        collected.push({
          id: newPendingImageId(),
          mediaType,
          base64,
          previewUrl: URL.createObjectURL(file),
        })
      } catch {
        toast.error(`Could not read image: ${file.name}`)
      }
    }
    if (collected.length === 0) return
    setPendingImages((prev) => [...prev, ...collected])
  }, [])

  const handleImageFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files
      if (files?.length) void addFilesAsPending(Array.from(files))
      e.target.value = ''
    },
    [addFilesAsPending],
  )

  const removePendingImage = useCallback((id: string) => {
    setPendingImages((prev) => {
      const found = prev.find((p) => p.id === id)
      if (found) URL.revokeObjectURL(found.previewUrl)
      return prev.filter((p) => p.id !== id)
    })
  }, [])

  const handlePasteImages = useCallback(
    async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const dt = e.clipboardData
      if (!dt) return
      const fromFiles = dt.files?.length ? Array.from(dt.files) : []
      const imageFiles = fromFiles.filter((f) => f.type.startsWith('image/'))
      if (imageFiles.length === 0 && dt.items?.length) {
        const fromItems: File[] = []
        for (let i = 0; i < dt.items.length; i++) {
          const it = dt.items[i]
          if (it.kind === 'file' && it.type.startsWith('image/')) {
            const f = it.getAsFile()
            if (f) fromItems.push(f)
          }
        }
        if (fromItems.length === 0) return
        e.preventDefault()
        await addFilesAsPending(fromItems)
        return
      }
      if (imageFiles.length === 0) return
      e.preventDefault()
      await addFilesAsPending(imageFiles)
    },
    [addFilesAsPending],
  )

  // ── Reverse injection (Canvas → composer, MP-3) ──────────────────────────
  // Canvas artifact rows (peak table, phase list) fire a `dispatchMentionAdd`
  // request instead of opening the picker directly. We handle it here with
  // exactly the same semantics as the picker-driven path: allocate a fresh
  // anchor unique within the message, push a pending chip, append the token
  // to the textarea, and promote the ref in the recent-mention MRU list.
  //
  // anchor is computed *outside* the state setters so the updaters stay pure
  // (React 18 StrictMode invokes them twice in dev — an impure updater
  // would burn entropy and could in principle desync the chip's anchor from
  // the textarea token). We read the latest pendingMentions via
  // `pendingMentionsRef` to avoid putting `pendingMentions` in the
  // dependency array, which would re-subscribe the window listener on
  // every chip change.
  const handleMentionAddRequest = useCallback(
    (req: MentionAddRequest) => {
      if (!session) return
      const existingAnchors = new Set(
        pendingMentionsRef.current.map((p) => p.anchor),
      )
      const anchor = generateMentionAnchor(existingAnchors)
      const chip: PendingMention = { anchor, ref: req.ref, label: req.label }
      // Update the ref *eagerly* so a second dispatch within the same tick
      // (before React commits) sees the just-allocated anchor and won't draw
      // it again. The post-commit useEffect re-syncs to the canonical state
      // and is idempotent in the common case.
      pendingMentionsRef.current = [...pendingMentionsRef.current, chip]
      setPendingMentions((prev) => [...prev, chip])
      const token = `@[${req.label}] `
      setInput((prev) => (prev.length === 0 ? token : prev + token))
      pushRecentMention?.(session.id, req.ref)
      // Height + focus sync on the next frame so React has committed the
      // textarea value before we measure scrollHeight. We don't move the
      // caret — canvas injections happen with the composer unfocused and
      // we want the user's next keystroke to land at the end of the new
      // token (which is where the browser's native cursor already is after
      // append).
      requestAnimationFrame(() => {
        const t = textareaRef.current
        if (!t) return
        t.focus()
        const end = t.value.length
        t.setSelectionRange(end, end)
        syncTextareaHeight(t)
      })
    },
    [session, pushRecentMention],
  )
  useComposerMentionListener(handleMentionAddRequest)

  // ── Prefill (EmptyState entry cards / CommandPalette "Start …") ─────────
  //
  // External triggers that want the composer to land on a specific mode with
  // a scaffold already in the textarea — e.g. "Start Research Brief" card
  // on an empty canvas. Unlike mention-add, prefill may replace or append
  // the current draft; it never submits. We always focus the textarea and
  // put the caret at the end so the user can type the topic immediately.
  const handleComposerPrefill = useCallback(
    (req: ComposerPrefillRequest) => {
      if (typeof req.maxIterations === 'number') {
        nextMaxIterationsRef.current = req.maxIterations
      }
      const append = req.append !== false
      let nextValue = ''
      setInput((prev) => {
        if (!append || prev.trim().length === 0) {
          nextValue = req.text
        } else {
          nextValue = `${prev}\n\n${req.text}`
        }
        return nextValue
      })
      requestAnimationFrame(() => {
        const t = textareaRef.current
        if (!t) return
        t.focus()
        const end = nextValue.length
        t.setSelectionRange(end, end)
        syncTextareaHeight(t)
      })
    },
    [],
  )
  useComposerPrefillListener(handleComposerPrefill)

  // ── Focus pull (Explorer @ icon, future "Focus chat" shortcut) ──────────
  // Payload-free: external callers (Explorer file-row hover action) dispatch
  // a focus event after injecting a mention so the user's next keystroke
  // lands in the textarea rather than the tree. Wrapped in useCallback so
  // the listener isn't re-registered on every render.
  const handleComposerFocus = useCallback(() => {
    textareaRef.current?.focus()
  }, [])
  useComposerFocusListener(handleComposerFocus)

  // Agent mode is self-contained by default: local TS orchestrator +
  // Electron `llmInvoke`. The legacy lattice-cli backend bridge is
  // available only when explicitly enabled for compatibility testing.
  const hasLlm = Boolean(window.electronAPI?.llmInvoke)
  const agentBackendPath = latticeBackendAgentPreferred()
  const connectionReady = hasLlm || agentBackendPath
  const canSubmit = hasLlm || agentBackendPath
  const imageSendBlocked = pendingImages.length > 0 && !hasLlm

  const handleComposerAddClick = useCallback(() => {
    const ta = textareaRef.current
    if (!ta) return
    const pos = ta.selectionStart ?? ta.value.length
    const before = ta.value.slice(0, pos)
    const after = ta.value.slice(pos)
    const needSpace = before.length > 0 && !before.endsWith(' ') && !before.endsWith('\n')
    const next = `${before}${needSpace ? ' ' : ''}@${after}`
    setInput(next)
    ta.focus()
    const cursor = pos + (needSpace ? 2 : 1)
    requestAnimationFrame(() => ta.setSelectionRange(cursor, cursor))
  }, [])

  // Dispatch a `/cmd args` string. Shared by `handleSend` (user hit Enter
  // on a fully-typed slash command) and the typeahead commit path (user
  // picked a no-args command from the dropdown). Clears composer draft
  // state and attaches an abort controller so a long-running prompt-type
  // command can be cancelled the same way a normal agent turn can.
  const runSlashCommand = useCallback(
    async (rawText: string) => {
      if (!session) return
      await warmSlashCommandCaches()
      const parsed = parseSlashCommand(rawText)
      if (!parsed) return
      const matched = findCommand(parsed.name)
      const submittedSessionId = session.id

      setInput('')
      setPendingMentions([])
      setPickerOpen(false)
      setPickerQuery('')
      setSlashQuery(null)
      setSlashIdx(0)
      if (textareaRef.current) textareaRef.current.style.height = '32px'

      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      setIsLoading(true)

      const hooks: DispatchHooks = {
        appendSystemMessage: (body) => {
          useSessionStore.getState().appendTranscript(submittedSessionId, {
            id: `sys_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            role: 'system',
            content: body,
            timestamp: Date.now(),
          })
        },
        submitAgentPrompt: async (prompt, opts) => {
          const activeSession =
            useSessionStore.getState().sessions[submittedSessionId]
          return submitAgentPrompt(prompt, {
            sessionId: submittedSessionId,
            transcript: activeSession
              ? getActiveTranscript(activeSession)
              : [],
            signal: controller.signal,
            displayText: opts.displayText,
            maxIterations: opts.maxIterations,
            modelBindingOverride: opts.modelBindingOverride,
          })
        },
        prefill: (req) => dispatchComposerPrefill(req),
      }

      void (async () => {
        try {
          await dispatchSlashCommand(
            matched,
            parsed.args,
            {
              sessionId: submittedSessionId,
              transcript: session ? getActiveTranscript(session) : [],
              signal: controller.signal,
              caller: 'user',
            },
            hooks,
            parsed.name,
          )
        } finally {
          setIsLoading(false)
          if (abortRef.current === controller) abortRef.current = null
        }
      })()
    },
    [session],
  )

  // Typeahead commit: the user picked a row with Enter/Tab/click. Commands
  // with `argumentHint` get their name prefilled (with a trailing space)
  // and the caret parked at the end so the user can type args. Commands
  // without args dispatch immediately — skipping the input-state round
  // trip that React batching would otherwise make brittle.
  const commitSlashSelection = useCallback(
    (cmd: SlashCommand) => {
      if (cmd.argumentHint) {
        const next = `/${cmd.name} `
        setInput(next)
        setSlashQuery(null)
        setSlashIdx(0)
        requestAnimationFrame(() => {
          const t = textareaRef.current
          if (!t) return
          t.focus()
          t.setSelectionRange(next.length, next.length)
          syncTextareaHeight(t)
        })
        return
      }
      void runSlashCommand(`/${cmd.name}`)
    },
    [runSlashCommand],
  )

  // ── Send ─────────────────────────────────────────────────────────────────
  const handleSend = async () => {
    let text = input.trim()
    // Reconstruct full @[label#anchor] tokens from the display-only @[label]
    // format so downstream consumers (transcript renderer, agent orchestrator)
    // can resolve mention refs.
    for (const { anchor, label } of pendingMentions) {
      const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      text = text.replace(
        new RegExp(`@\\[${escaped}\\]`),
        `@[${label}#${anchor}]`,
      )
    }
    const imagesSnapshot = pendingImages
    if ((!text && imagesSnapshot.length === 0) || isLoading || !session) return
    if (!canSubmit) return

    // Slash-command dispatch: `/cmd [args]` at column 0. Routes through the
    // unified registry in `src/lib/slash-commands/`. Slash commands ignore
    // any attached images (the user typed `/` first, so the draft is the
    // command, not a caption); images stay pending for the next turn.
    if (imagesSnapshot.length === 0 && parseSlashCommand(text)) {
      void runSlashCommand(text)
      return
    }

    if (imagesSnapshot.length > 0 && !hasLlm) {
      toast.error(
        'Images require the desktop app with a configured local connection.',
      )
      return
    }

    const mentionsForSubmit = pendingMentions.map(({ anchor, ref }) => ({
      anchor,
      ref,
    }))
    const imagesForSubmit =
      imagesSnapshot.length > 0
        ? imagesSnapshot.map(({ mediaType, base64 }) => ({ mediaType, base64 }))
        : undefined
    // Snapshot for the post-await commit. If any of these changed during the
    // await (user switched session, edited the textarea, added/removed a
    // chip), the user has clearly moved on — leave their new draft alone.
    const submittedSessionId = session.id
    const submittedText = input
    const submittedAnchors = mentionsForSubmit.map((m) => m.anchor).join(',')
    const submittedImageIds = imagesSnapshot.map((p) => p.id).join(',')

    // Close the picker and clear the draft immediately so the user sees
    // their message land in the transcript and the input reset — which is
    // what every chat app does. The earlier behavior (keep the draft until
    // we knew the turn succeeded) was intended for "budget block / IPC
    // error" retry but in practice users just read the empty input as a
    // bug. If the submit turns out to have failed, we restore the draft
    // below, but only if the textarea is still empty (= user hasn't moved
    // on to a new thought).
    setPickerOpen(false)
    setPickerQuery('')
    setAddMenuOpen(false)
    setIsLoading(true)

    // Clear draft fields. Mentions + images mirror the text clear so the
    // chip bar / attached-images row also reset as soon as send fires.
    setInput('')
    setPendingMentions([])
    setPendingImages((prev) => {
      for (const p of prev) URL.revokeObjectURL(p.previewUrl)
      return []
    })
    if (textareaRef.current) textareaRef.current.style.height = '32px'

    // Replace any previous in-flight controller — only one Agent turn per
    // composer at a time. Dialog mode ignores the signal; attaching it is
    // cheap and keeps the code path uniform.
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    // Consume any prefill-seeded iteration override for this single send,
    // then clear so subsequent sends fall back to orchestrator defaults.
    const maxIterationsForThisSend = nextMaxIterationsRef.current
    nextMaxIterationsRef.current = undefined

    let ok = false
    try {
      ok = await submitAgentPrompt(text, {
        sessionId: submittedSessionId,
        transcript,
        mentions: mentionsForSubmit.length ? mentionsForSubmit : undefined,
        images: imagesForSubmit,
        signal: controller.signal,
        maxIterations: maxIterationsForThisSend,
      })
    } finally {
      setIsLoading(false)
      if (abortRef.current === controller) abortRef.current = null
    }

    // The two `submittedAnchors` / `submittedImageIds` snapshots are only
    // used by the failure-restore path below. Referenced here so lint
    // doesn't flag them as unused after the refactor.
    void submittedAnchors
    void submittedImageIds

    if (ok) return
    if (useSessionStore.getState().activeSessionId !== submittedSessionId) {
      // User navigated to another session while we were awaiting — their
      // current draft belongs to that session. Don't touch.
      return
    }

    // Submit failed. Restore the original text *only* if the user hasn't
    // started typing a new draft since we cleared. This gives the retry
    // ergonomics the old behavior aimed at without confusing the common
    // success path. Mentions + images aren't restored because reproducing
    // their chip state + image URLs cleanly is fiddly and a re-@ is
    // cheaper than a silent-restore that misrenders.
    setInput((prev) => (prev.length === 0 ? submittedText : prev))
    if (textareaRef.current) {
      syncTextareaHeight(textareaRef.current)
    }
  }

  const handleRenameSession = useCallback(async () => {
    if (!session) return
    const next = await asyncPrompt('Rename session', session.title)
    if (next && next.trim()) {
      renameSession(session.id, next.trim())
    }
  }, [session, renameSession])

  const handleExport = useCallback(
    (format: 'markdown' | 'json') => {
      if (!session) return
      try {
        exportSessionChat(session, format)
      } catch (err) {
        toast.error(
          `Export failed: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    },
    [session],
  )

  const handleCopyConversation = useCallback(() => {
    if (!session) return
    void copyText(serializeSessionAsMarkdown(session), 'Conversation copied to clipboard')
  }, [session])

  const handleClearChat = useCallback(() => {
    if (!session) return
    clearTranscript(session.id)
  }, [session, clearTranscript])

  const handleNewChat = useCallback(() => {
    const id = createSession({ title: 'Untitled Session' })
    setActiveSession(id)
  }, [createSession, setActiveSession])

  return (
    <div
      className={`composer-root composer-root-relative${chrome === 'embedded' ? ' embedded' : ''}`}
    >
      {hasConversationHeader && session && (
        <ChatPanelHeader
          sessionTitle={session.title}
          chatMode={getSessionChatMode(session)}
          onRenameSession={handleRenameSession}
          onExport={handleExport}
          onCopyConversation={handleCopyConversation}
          onClearChat={handleClearChat}
          onNewChat={handleNewChat}
          onClosePanel={onClosePanel}
        />
      )}
      <div className="composer-split-wrap">
        <div className="composer-split-main">
      <div className="chat-thread">
        <div
          ref={messagesRef}
          onScroll={handleMessagesScroll}
          className={`chat-messages chat-messages-fill${showJumpToLatest ? ' has-jump-to-latest' : ''}`}
          // Screen readers announce new messages as they arrive. `additions
          // text` covers both a whole new bubble and in-place content edits
          // (streaming). `aria-atomic=false` so only the changed chunk reads,
          // not the entire transcript.
          role="log"
          aria-live="polite"
          aria-relevant="additions text"
          aria-atomic="false"
          aria-label="Session transcript"
        >
          <div className="chat-messages-top-spacer" aria-hidden="true" />
          {transcript.length === 0
            ? null
            : transcript.map((msg) => (
                <MessageBubble
                  key={msg.id}
                  message={msg}
                  relTime={relTimeByMessage.get(msg.id) ?? ''}
                  toolSteps={
                    msg.role === 'assistant'
                      ? toolStepsByMessage.get(msg.id) ?? EMPTY_TOOL_STEPS
                      : EMPTY_TOOL_STEPS
                  }
                  sessionId={session?.id ?? null}
                />
              ))}
          {showThinkingRow && (
            <div
              className="chat-message chat-message-assistant"
              role="article"
              aria-label="Assistant is thinking"
              aria-busy="true"
            >
              <div className="chat-bubble">
                <span className="thinking-dots">
                  <span>.</span>
                  <span>.</span>
                  <span>.</span>
                </span>
              </div>
            </div>
          )}
          <div ref={endRef} className="chat-messages-end-spacer" />
        </div>

        <div className="chat-input-area">
          <div className="chat-composer-dock">
            <MentionChipsBar
              chips={pendingMentions}
              onRemove={handleRemoveChip}
            />
            {pendingImages.length > 0 ? (
              <div
                className="chat-pending-images"
                aria-label="Images attached to this message"
              >
                {pendingImages.map((p) => (
                  <div key={p.id} className="chat-pending-image-tile">
                    <img src={p.previewUrl} alt="" />
                    <button
                      type="button"
                      className="chat-pending-image-remove"
                      onClick={() => removePendingImage(p.id)}
                      aria-label="Remove image"
                    >
                      <X size={12} strokeWidth={2.5} aria-hidden />
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
            <div className="chat-input-wrapper" style={{ position: 'relative' }}>
              <MentionPicker
                open={pickerOpen}
                query={pickerQuery}
                recent={recentMentions ?? []}
                mentionables={mentionables ?? []}
                onSelect={handleSelectMentionable}
                onClose={() => {
                  setPickerOpen(false)
                  setPickerQuery('')
                }}
              />
              <SlashTypeahead
                open={slashQuery !== null && slashMatches.length > 0}
                matches={slashMatches}
                selectedIdx={slashIdx}
                onHover={setSlashIdx}
                onSelect={commitSlashSelection}
              />
              <div className="chat-input-main-row">
                <button
                  type="button"
                  className="chat-composer-add-btn"
                  onClick={handleComposerAddClick}
                  aria-label="Add context — insert mention"
                  title="Add context (@ mention)"
                >
                  <Plus size={16} strokeWidth={2.25} aria-hidden />
                </button>
                <textarea
                  ref={textareaRef}
                  className="chat-input"
                  value={input}
                  onChange={handleInput}
                  onSelect={handleSelect}
                  onKeyDown={handleKeyDown}
                  onCompositionStart={handleCompositionStart}
                  onCompositionEnd={handleCompositionEnd}
                  placeholder=""
                  rows={1}
                  aria-label="Message composer"
                  aria-describedby={
                    !canSubmit ? 'composer-connection-status' : undefined
                  }
                  aria-disabled={!canSubmit ? true : undefined}
                />
                {isLoading ? (
                  <button
                    type="button"
                    className="chat-send-btn is-stop"
                    onClick={stopCurrentRun}
                    aria-label="Stop agent"
                    title="Stop the agent run"
                  >
                    <Square
                      size={12}
                      strokeWidth={2.5}
                      fill="currentColor"
                      aria-hidden
                    />
                  </button>
                ) : (
                  <button
                    type="button"
                    className="chat-send-btn"
                    onClick={handleSend}
                    disabled={
                      (!input.trim() && pendingImages.length === 0) ||
                      !canSubmit ||
                      imageSendBlocked
                    }
                    aria-label="Send message"
                    title={
                      imageSendBlocked
                        ? 'Images need the desktop app with a local connection'
                        : !canSubmit
                          ? 'Configure a connection in Settings'
                          : 'Send message'
                    }
                  >
                    <ArrowUp size={16} strokeWidth={2.25} aria-hidden />
                  </button>
                )}
              </div>
              {hasModeToolbar ? (
                <div className="chat-input-model-row">
                  <span className="chat-input-model-row-label">Connection</span>
                  <div
                    ref={modelChipAnchorRef}
                    className="chat-model-chip-wrap"
                    aria-label="Agent connection"
                  >
                    <ModelChip
                      label={agentModelLabel}
                      tone={connectionReady ? 'accent' : 'muted'}
                      title="Choose agent connection"
                      hideDot
                      showChevron
                      onClick={() => setModelPickerOpen((o) => !o)}
                    />
                    <ModelRouteBadge />
                    {modelPickerOpen ? (
                      <AgentModelPickerPopover
                        anchorEl={modelChipAnchorRef.current}
                        onClose={() => setModelPickerOpen(false)}
                        onOpenFullSettings={onOpenLLMConfig}
                      />
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
            {!canSubmit && (
              <div
                className="composer-connection-banner"
                role="status"
                id="composer-connection-status"
              >
                Configure a connection in Settings to send messages.
              </div>
            )}
          </div>
        </div>
      </div>
        </div>
      </div>
    </div>
  )
}

// Relative time formatter used by `relTimeByMessage` above. Kept in this
// file (rather than moved with MessageBubble) because only the parent's
// per-minute tick memo needs it — MessageBubble itself only reads the
// pre-formatted string prop.
function formatRelativeTime(timestamp: number, now: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return ''
  const diffMs = Math.max(0, now - timestamp)
  const sec = Math.round(diffMs / 1000)
  if (sec < 45) return 'just now'
  const min = Math.round(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.round(hr / 24)
  if (day < 7) return `${day}d ago`
  try {
    return new Date(timestamp).toLocaleDateString()
  } catch {
    return ''
  }
}
