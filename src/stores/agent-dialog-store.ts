// Phase B+ · pending-dialog queue for agent UI hooks.
//
// The orchestrator's approval gate and the `ask_user_question` tool both
// need to block on a React-rendered dialog and resume when the user
// answers. Tools can't `await` a React render directly, so we mediate
// through a small Zustand store:
//
//   tool handler  →  pendingDialogStore.request(...)  →  Promise
//   React dialog  →  pendingDialogStore.resolve(...)  →  resolves Promise
//
// The store holds only one pending request per kind at a time. Both
// kinds (approval + ask) can coexist, but the orchestrator serialises
// tool execution so in practice only one of each is ever open.

import { create } from 'zustand'
import { genShortId } from '../lib/id-gen'

export interface PendingApproval {
  id: string
  toolName: string
  toolDescription: string
  trustLevel: 'localWrite' | 'hostExec'
  input: unknown
  createdAt: number
}

export interface PendingQuestion {
  id: string
  title: string
  detail?: string
  options?: Array<{ id: string; label: string; detail?: string }>
  placeholder?: string
  createdAt: number
}

export type ApprovalDecision =
  | { kind: 'allow-once' }
  | { kind: 'allow-session' }
  | { kind: 'deny' }

export interface QuestionAnswer {
  answerId?: string
  answerText?: string
}

interface AgentDialogState {
  pendingApproval: PendingApproval | null
  pendingQuestion: PendingQuestion | null
  /** Session-scoped allow-list — tool names the user has pre-approved via
   *  "Allow for this session" in the approval dialog. */
  sessionAllowList: Set<string>

  requestApproval(
    req: Omit<PendingApproval, 'id' | 'createdAt'>,
  ): Promise<ApprovalDecision>
  resolveApproval(id: string, decision: ApprovalDecision): void

  requestQuestion(
    req: Omit<PendingQuestion, 'id' | 'createdAt'>,
  ): Promise<QuestionAnswer>
  resolveQuestion(id: string, answer: QuestionAnswer | 'cancel'): void

  /** Orchestrator calls this at the start of every agent turn so stale
   *  pending dialogs from a crashed previous run don't deadlock the UI. */
  reset(): void
}

// Pending resolvers are kept in module scope because storing callbacks in
// Zustand state breaks its equality checks (Map identity changes on every
// set). The store only exposes the serialisable request metadata.
const pendingResolvers = new Map<
  string,
  {
    resolve: (value: unknown) => void
    reject: (reason?: unknown) => void
  }
>()

function genId(prefix: string): string {
  return genShortId(prefix, 4)
}

export const useAgentDialogStore = create<AgentDialogState>((set, get) => ({
  pendingApproval: null,
  pendingQuestion: null,
  sessionAllowList: new Set<string>(),

  requestApproval(req) {
    const id = genId('appr')
    const request: PendingApproval = {
      ...req,
      id,
      createdAt: Date.now(),
    }
    // Short-circuit localWrite tools only. hostExec must be approved per
    // invocation because the command / cwd / plugin input can change.
    if (
      req.trustLevel !== 'hostExec' &&
      get().sessionAllowList.has(req.toolName)
    ) {
      return Promise.resolve<ApprovalDecision>({ kind: 'allow-once' })
    }
    set({ pendingApproval: request })
    return new Promise<ApprovalDecision>((resolve, reject) => {
      pendingResolvers.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
      })
    })
  },

  resolveApproval(id, decision) {
    const handle = pendingResolvers.get(id)
    pendingResolvers.delete(id)
    set((s) => ({
      pendingApproval:
        s.pendingApproval?.id === id ? null : s.pendingApproval,
      sessionAllowList:
        decision.kind === 'allow-session' &&
        s.pendingApproval &&
        s.pendingApproval.trustLevel !== 'hostExec'
          ? new Set([...s.sessionAllowList, s.pendingApproval.toolName])
          : s.sessionAllowList,
    }))
    handle?.resolve(decision)
  },

  requestQuestion(req) {
    const id = genId('ask')
    const request: PendingQuestion = {
      ...req,
      id,
      createdAt: Date.now(),
    }
    set({ pendingQuestion: request })
    return new Promise<QuestionAnswer>((resolve, reject) => {
      pendingResolvers.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
      })
    })
  },

  resolveQuestion(id, answer) {
    const handle = pendingResolvers.get(id)
    pendingResolvers.delete(id)
    set((s) => ({
      pendingQuestion:
        s.pendingQuestion?.id === id ? null : s.pendingQuestion,
    }))
    if (answer === 'cancel') {
      handle?.reject(new Error('user_denied'))
    } else {
      handle?.resolve(answer)
    }
  },

  reset() {
    for (const [, handle] of pendingResolvers) {
      handle.reject(new Error('dialog_reset'))
    }
    pendingResolvers.clear()
    set({ pendingApproval: null, pendingQuestion: null })
  },
}))
