import { useEffect, useMemo, useState } from 'react'
import { Cpu, DollarSign, X } from 'lucide-react'
import ModelsTab from './tabs/ModelsTab'
import BudgetTab from './tabs/BudgetTab'

export type LLMConfigTabId = 'models' | 'budget'

interface Props {
  open: boolean
  onClose: () => void
  initialTab?: LLMConfigTabId
  activeSessionId?: string | null
}

interface TabDef {
  id: LLMConfigTabId
  label: string
  icon: React.ComponentType<{ size?: number; className?: string }>
}

const TABS: readonly TabDef[] = [
  { id: 'models', label: 'Connections', icon: Cpu },
  { id: 'budget', label: 'Budget & Limits', icon: DollarSign },
]

export default function LLMConfigModal({
  open,
  onClose,
  initialTab = 'models',
  activeSessionId: _activeSessionId = null,
}: Props) {
  const [activeTab, setActiveTab] = useState<LLMConfigTabId>(initialTab)

  useEffect(() => {
    if (!open) return
    setActiveTab(initialTab)
  }, [open, initialTab])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  const tabContent = useMemo(() => {
    switch (activeTab) {
      case 'models':
        return <ModelsTab />
      case 'budget':
        return <BudgetTab />
      default:
        return null
    }
  }, [activeTab])

  if (!open) return null

  return (
    <div onClick={onClose} className="llm-modal-backdrop">
      <div onClick={(e) => e.stopPropagation()} className="llm-modal-panel">
        <div className="llm-modal-header">
          <Cpu size={15} className="llm-modal-header-icon" />
          <strong className="llm-modal-title">Connection Settings</strong>
          <span className="llm-modal-header-spacer" />
          <button
            type="button"
            onClick={onClose}
            className="llm-modal-close-btn"
            title="Close (Esc)"
          >
            <X size={16} />
          </button>
        </div>

        <div className="llm-modal-body">
          <nav className="llm-modal-tab-rail" aria-label="Connection settings sections">
            {TABS.map((tab) => {
              const active = tab.id === activeTab
              const Icon = tab.icon
              return (
                <button
                  type="button"
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`llm-modal-tab-item${active ? ' is-active' : ''}`}
                  aria-current={active ? 'page' : undefined}
                >
                  <Icon size={13} className="llm-modal-tab-item-icon" />
                  <span>{tab.label}</span>
                </button>
              )
            })}
          </nav>

          <section className="llm-modal-content-pane" aria-live="polite">
            {tabContent}
          </section>
        </div>
      </div>
    </div>
  )
}

// Helpers live in `./llm-config-helpers` so this file only exports the
// default React component — required for React Fast Refresh to patch
// in place instead of full-reloading on every HMR tick.
