import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import ModelsTab from '../llm/tabs/ModelsTab'
import SyncTab from './sync/SyncTab'
import { useComputeConfigStore } from '../../stores/compute-config-store'
import { toast } from '../../stores/toast-store'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import AccountSettingsTab from './settings-modal/AccountSettingsTab'
import GeneralSettingsTab from './settings-modal/GeneralSettingsTab'
import ComputeSettingsTab from './settings-modal/ComputeSettingsTab'
import ExtensionsSettingsTab from './settings-modal/ExtensionsSettingsTab'
import PrivacySettingsTab from './settings-modal/PrivacySettingsTab'
import { summariseHealth } from './settings-modal/helpers'
import {
  SETTINGS_TABS,
  type SettingsTabId,
} from './settings-modal/tabs'

export type { SettingsTabId }

interface Props {
  open: boolean
  onClose: () => void
  initialTab?: SettingsTabId
}

export default function SettingsModal({
  open,
  onClose,
  initialTab = 'general',
}: Props) {
  useEscapeKey(onClose, open)

  const compute = useComputeConfigStore()

  const [activeTab, setActiveTab] = useState<SettingsTabId>(initialTab)
  const [testing, setTesting] = useState(false)

  useEffect(() => {
    if (!open) return
    setActiveTab(initialTab)
  }, [open, initialTab])

  if (!open) return null

  const handleTestCompute = async () => {
    if (compute.mode === 'disabled') {
      toast.warn('Enable Native mode first')
      return
    }
    const electron = window.electronAPI
    if (!electron?.computeTestConnection) {
      toast.error('Compute IPC not available - restart the app')
      return
    }
    setTesting(true)
    try {
      const result = await electron.computeTestConnection({
        mode: compute.mode,
      })
      const summary = result.container_up
        ? summariseHealth(result)
        : result.error || 'Environment unavailable'
      compute.setLastTest({
        ok: result.container_up,
        message: summary,
        checkedAt: Date.now(),
        pythonVersion: result.python_version ?? null,
        lammpsAvailable: result.lammps_available,
        cp2kAvailable: result.cp2k_available,
        packages: result.packages,
      })
      if (result.container_up) {
        toast.success(summary)
      } else {
        toast.error(summary)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown error'
      compute.setLastTest({ ok: false, message: msg, checkedAt: Date.now() })
      toast.error(`Test failed: ${msg}`)
    } finally {
      setTesting(false)
    }
  }

  let tabContent: React.ReactNode
  switch (activeTab) {
    case 'account':
      tabContent = <AccountSettingsTab />
      break
    case 'general':
      tabContent = <GeneralSettingsTab />
      break
    case 'compute':
      tabContent = (
        <ComputeSettingsTab
          compute={compute}
          testing={testing}
          onTestCompute={handleTestCompute}
        />
      )
      break
    case 'privacy':
      tabContent = <PrivacySettingsTab />
      break
    case 'models':
      tabContent = <ModelsTab />
      break
    case 'sync':
      tabContent = <SyncTab />
      break
    case 'extensions':
      tabContent = <ExtensionsSettingsTab />
      break
    default:
      tabContent = null
  }

  return (
    <div
      className="settings-modal-backdrop"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="settings-modal-panel"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-modal-title"
      >
        <header className="settings-modal-header">
          <div className="settings-modal-title-block">
            <h1 id="settings-modal-title" className="settings-modal-title">
              Settings
            </h1>
            <p className="settings-modal-subtitle">
              Workspace preferences, models, and compute
            </p>
          </div>
          <span className="settings-modal-header-spacer" />
          <span className="settings-modal-kbd-hint" aria-hidden="true">
            Esc
          </span>
          <button
            type="button"
            onClick={onClose}
            className="settings-modal-close"
            title="Close (Esc)"
            aria-label="Close settings"
          >
            <X size={18} strokeWidth={1.75} aria-hidden />
          </button>
        </header>

        <div className="settings-modal-body">
          <nav className="settings-modal-nav" aria-label="Settings sections">
            {SETTINGS_TABS.map((tab) => {
              const Icon = tab.icon
              const active = tab.id === activeTab
              return (
                <button
                  type="button"
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`settings-modal-nav-item${active ? ' is-active' : ''}`}
                  aria-current={active ? 'page' : undefined}
                >
                  <Icon
                    className="settings-modal-nav-icon"
                    size={18}
                    strokeWidth={1.75}
                    aria-hidden
                  />
                  <span className="settings-modal-nav-text">
                    <span className="settings-modal-nav-label">{tab.label}</span>
                    <span className="settings-modal-nav-desc">
                      {tab.description}
                    </span>
                  </span>
                </button>
              )
            })}
          </nav>

          <div className="settings-modal-main">
            <div className="settings-modal-scroll">
              <div className="settings-modal-scroll-inner" aria-live="polite">
                {tabContent}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
