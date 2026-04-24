// Ephemeral store for PDF passages the user sent to AI via "Ask AI".
// These surface in the @ mention picker under a "QUOTES" group so the
// user can reference a previously-highlighted passage in follow-up questions.
// Non-persistent — clears on app restart; the highlights live in the
// PDF annotation layer for the visual side.

import { create } from 'zustand'
import type { MentionRef } from '../types/mention'
import type { Mentionable } from '../types/mention-resolver'

export interface PdfQuoteEntry {
  ref: MentionRef & { type: 'pdf-quote' }
  label: string
  excerpt: string
  addedAt: number
}

interface PdfQuoteState {
  quotes: PdfQuoteEntry[]
  addQuote: (entry: PdfQuoteEntry) => void
  clearQuotes: () => void
}

export const usePdfQuoteStore = create<PdfQuoteState>((set) => ({
  quotes: [],
  addQuote: (entry) =>
    set((s) => ({
      quotes: [
        entry,
        ...s.quotes.filter((q) => q.ref.quoteHash !== entry.ref.quoteHash),
      ].slice(0, 50),
    })),
  clearQuotes: () => set({ quotes: [] }),
}))

export function pdfQuoteMentionables(): Mentionable[] {
  return usePdfQuoteStore.getState().quotes.map((q) => ({
    ref: q.ref,
    label: q.label,
    sublabel: q.excerpt.length > 50 ? `${q.excerpt.slice(0, 47)}…` : q.excerpt,
    kindLabel: 'quote',
    group: 'quotes' as Mentionable['group'],
  }))
}
