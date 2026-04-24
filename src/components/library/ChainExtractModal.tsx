// ChainExtractModal — review and edit knowledge chains extracted by the LLM
// from a user's text selection. Each chain has editable role/name/value/unit
// nodes + a confidence slider. Save calls api.saveChains().

import { useEffect, useState } from 'react'
import { Plus, Save, Trash2, X } from 'lucide-react'
import type { KnowledgeChain, ChainNode } from '../../types/library-api'
import { localProKnowledge } from '../../lib/local-pro-knowledge'
import { toast } from '../../stores/toast-store'
import { useEscapeKey } from '../../hooks/useEscapeKey'

const ROLES = ['system', 'process', 'state', 'measurement'] as const

interface Props {
  open: boolean
  chains: KnowledgeChain[]
  paperId: number | null
  contextText: string
  contextPage: number
  onClose: () => void
  onSaved: () => void
}

interface EditableNode {
  role: string
  name: string
  value: string
  unit: string
}

interface EditableChain {
  nodes: EditableNode[]
  confidence: number
}

export default function ChainExtractModal({
  open,
  chains,
  paperId,
  contextText,
  contextPage,
  onClose,
  onSaved,
}: Props) {
  useEscapeKey(onClose, open)
  const api = localProKnowledge
  const [editChains, setEditChains] = useState<EditableChain[]>(() =>
    chains.map(chainToEditable),
  )
  const [saving, setSaving] = useState(false)

  // The lazy initialiser above only runs on first mount, so a second extract
  // session would otherwise show stale chains. Reset whenever the modal opens
  // with a new chain set.
  useEffect(() => {
    if (!open) return
    setEditChains(chains.map(chainToEditable))
  }, [open, chains])

  if (!open) return null

  const updateNode = (
    ci: number,
    ni: number,
    patch: Partial<EditableNode>,
  ) => {
    setEditChains((prev) =>
      prev.map((c, i) =>
        i === ci
          ? {
              ...c,
              nodes: c.nodes.map((n, j) =>
                j === ni ? { ...n, ...patch } : n,
              ),
            }
          : c,
      ),
    )
  }

  const addNode = (ci: number) => {
    setEditChains((prev) =>
      prev.map((c, i) =>
        i === ci
          ? {
              ...c,
              nodes: [
                ...c.nodes,
                { role: 'measurement', name: '', value: '', unit: '' },
              ],
            }
          : c,
      ),
    )
  }

  const removeNode = (ci: number, ni: number) => {
    setEditChains((prev) =>
      prev.map((c, i) =>
        i === ci
          ? { ...c, nodes: c.nodes.filter((_, j) => j !== ni) }
          : c,
      ),
    )
  }

  const removeChain = (ci: number) => {
    setEditChains((prev) => prev.filter((_, i) => i !== ci))
  }

  const setConfidence = (ci: number, v: number) => {
    setEditChains((prev) =>
      prev.map((c, i) => (i === ci ? { ...c, confidence: v } : c)),
    )
  }

  const handleSave = async () => {
    const validChains = editChains.filter(
      (c) => c.nodes.length > 0 && c.nodes.some((n) => n.name.trim()),
    )
    if (validChains.length === 0) {
      toast.warn('No valid chains to save')
      return
    }
    setSaving(true)
    try {
      const result = await api.saveChains({
        paper_id: paperId ?? undefined,
        chains: validChains.map((c) => ({
          confidence: c.confidence,
          domain_type: 'materials',
          chain_type: c.nodes.map((n) => n.role[0].toUpperCase()).join(''),
          context_text: contextText.slice(0, 500),
          context_section: `p.${contextPage} (selection)`,
          nodes: c.nodes.map((n, ordinal) => ({
            ordinal,
            role: n.role,
            name: n.name,
            value: n.value || undefined,
            unit: n.unit || undefined,
          })),
        })),
      })
      if (result.success) {
        toast.success(
          `Saved ${result.count} chains (extraction #${result.extraction_id})`,
        )
        onSaved()
        onClose()
      } else {
        toast.error(result.error)
      }
    } catch (err) {
      toast.error(
        `Save failed: ${err instanceof Error ? err.message : String(err)}`,
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="chain-extract-backdrop" onClick={onClose}>
      <div
        className="chain-extract-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="chain-extract-header">
          <strong className="chain-extract-title">
            Review Extracted Chains
          </strong>
          <span className="chain-extract-subtitle">
            {editChains.length} chain{editChains.length !== 1 ? 's' : ''}{' '}
            from p.{contextPage}
          </span>
          <span className="chain-extract-spacer" />
          <button onClick={onClose} className="chain-extract-icon-btn">
            <X size={16} />
          </button>
        </div>

        <div className="chain-extract-body">
          {editChains.length === 0 && (
            <div className="chain-extract-empty">
              No chains extracted. Try selecting a longer passage with
              quantitative data.
            </div>
          )}
          {editChains.map((chain, ci) => (
            <div key={ci} className="chain-extract-card">
              <div className="chain-extract-card-header">
                <span className="chain-extract-label">Chain {ci + 1}</span>
                <span className="chain-extract-type">
                  {chain.nodes
                    .map((n) => n.role[0].toUpperCase())
                    .join('')}
                </span>
                <span className="chain-extract-spacer" />
                <span className="chain-extract-conf-label">
                  conf: {Math.round(chain.confidence * 100)}%
                </span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={chain.confidence}
                  onChange={(e) =>
                    setConfidence(ci, Number(e.target.value))
                  }
                  className="chain-extract-conf-slider"
                />
                <button
                  onClick={() => removeChain(ci)}
                  className="chain-extract-chain-del-btn"
                  title="Remove chain"
                >
                  <Trash2 size={12} />
                </button>
              </div>
              <div className="chain-extract-nodes-grid">
                <div className="chain-extract-node-header-row">
                  <span>Role</span>
                  <span>Name</span>
                  <span>Value</span>
                  <span>Unit</span>
                  <span />
                </div>
                {chain.nodes.map((node, ni) => (
                  <div key={ni} className="chain-extract-node-row">
                    <select
                      value={node.role}
                      onChange={(e) =>
                        updateNode(ci, ni, { role: e.target.value })
                      }
                      className="chain-extract-role-select"
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                    <input
                      value={node.name}
                      onChange={(e) =>
                        updateNode(ci, ni, { name: e.target.value })
                      }
                      placeholder="name"
                      className="chain-extract-node-input"
                    />
                    <input
                      value={node.value}
                      onChange={(e) =>
                        updateNode(ci, ni, { value: e.target.value })
                      }
                      placeholder="value"
                      className="chain-extract-node-input"
                    />
                    <input
                      value={node.unit}
                      onChange={(e) =>
                        updateNode(ci, ni, { unit: e.target.value })
                      }
                      placeholder="unit"
                      className="chain-extract-node-input chain-extract-node-input--unit"
                    />
                    <button
                      onClick={() => removeNode(ci, ni)}
                      className="chain-extract-node-del-btn"
                    >
                      <X size={11} />
                    </button>
                  </div>
                ))}
              </div>
              <button
                onClick={() => addNode(ci)}
                className="chain-extract-add-node-btn"
              >
                <Plus size={10} /> Node
              </button>
            </div>
          ))}
        </div>

        <div className="chain-extract-footer">
          <button onClick={onClose} className="chain-extract-cancel-btn">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="chain-extract-save-btn"
          >
            <Save size={12} />
            {saving ? 'Saving...' : 'Save Chains'}
          </button>
        </div>
      </div>
    </div>
  )
}

function chainToEditable(chain: KnowledgeChain): EditableChain {
  return {
    confidence: chain.confidence ?? 0.8,
    nodes: chain.nodes.map((n: ChainNode) => ({
      role: n.role || 'system',
      name: n.name || '',
      value: n.value ?? '',
      unit: n.unit ?? '',
    })),
  }
}

