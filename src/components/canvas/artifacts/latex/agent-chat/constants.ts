// Shared types and static data for the Creator-scoped LaTeX assistant.
//
// Kept as a tiny module so the prompt text, quick-action catalogue, and
// turn/parsed-block types can be reused by helpers, the main chat
// component, and the bubble renderer without pulling React in.

import type { ComponentType } from 'react'
import {
  AlertOctagon,
  BookOpenCheck,
  Languages,
  Sparkles,
  Wand2,
} from 'lucide-react'

export interface ChatTurn {
  id: string
  role: 'user' | 'assistant'
  content: string
  pending?: boolean
  error?: boolean
  at: number
}

export interface ParsedCodeBlock {
  /** Zero-based index into the streamed markdown; used as a stable key. */
  index: number
  path?: string
  language?: string
  content: string
}

export interface QuickAction {
  id: string
  label: string
  prompt: string
  icon: ComponentType<{ size: number; strokeWidth?: number }>
}

export const SYSTEM_PROMPT = [
  'You are the Lattice LaTeX Creator assistant. You operate on a multi-file LaTeX project and help the user FIX COMPILE ERRORS, reformat, polish prose, and refactor.',
  '',
  'Rules:',
  '1. When you propose changes to a file, emit the FULL new file content inside a fenced block tagged with the file path, e.g. ```tex path=main.tex\\n... full contents ...\\n```.',
  '2. Never emit partial diffs or `...` placeholders.',
  '3. Only touch files that really need changes. Keep prose short — the code blocks are the deliverable.',
  '4. Preserve citations, \\ref / \\label, math environments, and comment markers unless the user explicitly asks to change them.',
  '5. If the user is just asking a question, reply concisely in text and do NOT emit a code block.',
].join('\n')

export const QUICK_ACTIONS: QuickAction[] = [
  {
    id: 'fix',
    label: 'Fix compile',
    prompt:
      'Fix every compile error and warning listed in COMPILE DIAGNOSTICS. Only change what is needed. Return the full corrected contents of any file you modify.',
    icon: AlertOctagon,
  },
  {
    id: 'explain',
    label: 'Explain errors',
    prompt:
      'Explain the current compile diagnostics in plain language. Point to the likely file and line for each issue. Do not modify files unless you are certain a one-file fix is needed.',
    icon: Sparkles,
  },
  {
    id: 'polish',
    label: 'Polish',
    prompt:
      'Polish the English in the ACTIVE FILE while preserving all LaTeX commands, citations, labels, and math. Return the full new contents of the active file.',
    icon: Sparkles,
  },
  {
    id: 'abstract',
    label: 'Abstract',
    prompt:
      'Draft a concise scientific abstract from the current project. Preserve the technical claims already present in the source; do not invent results. Return prose only unless a specific file change is needed.',
    icon: BookOpenCheck,
  },
  {
    id: 'translate',
    label: 'Translate',
    prompt:
      'Translate the prose in the ACTIVE FILE into polished academic English while preserving all LaTeX commands, citations, labels, math, and environments. Return the full new contents of the active file.',
    icon: Languages,
  },
  {
    id: 'format',
    label: 'Reformat',
    prompt:
      'Reformat the ACTIVE FILE for readability: consistent indentation (2 spaces), one sentence per line inside paragraphs, and tidy up spacing. Do NOT change meaning or LaTeX semantics. Return the full new contents of the active file.',
    icon: Wand2,
  },
]
