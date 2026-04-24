import AgentComposer from '../agent/AgentComposer'
import InspectorRail from '../inspector/InspectorRail'
import PanelHeader from '../common/panel/PanelHeader'
import SegmentedControl, {
  type SegmentedOption,
} from '../common/panel/SegmentedControl'
import IconButton from '../common/panel/IconButton'

export type WorkspaceRailTab = 'agent' | 'details'

const RAIL_OPTIONS: Record<WorkspaceRailTab, SegmentedOption<WorkspaceRailTab>> = {
  agent: {
    value: 'agent',
    label: 'Agent',
    title: 'Agent chat and timeline',
    // Screen readers hear "Agent" (visible label) with no context about
    // what that tab actually opens. The ariaLabel spells it out so
    // assistive tech users don't have to guess at the domain meaning.
    ariaLabel: 'Agent chat and timeline',
  },
  details: {
    value: 'details',
    label: 'Details',
    title: 'Focused artifact details and inspector',
    ariaLabel: 'Focused artifact details and inspector',
  },
}

interface Props {
  activeTab: WorkspaceRailTab
  tabs?: WorkspaceRailTab[]
  onTabChange: (tab: WorkspaceRailTab) => void
  onClose: () => void
  onOpenLLMConfig?: () => void
  onStartResearch?: () => void
}

export default function WorkspaceRail({
  activeTab,
  tabs = ['agent', 'details'],
  onTabChange,
  onClose,
  onOpenLLMConfig,
  onStartResearch,
}: Props) {
  const options = tabs.map((tab) => RAIL_OPTIONS[tab])

  return (
    <div className="workspace-rail">
      <PanelHeader
        dense
        label={options.length === 1 ? options[0].label : undefined}
        actions={
          <IconButton
            title="Hide side panel"
            label="×"
            onClick={onClose}
          />
        }
      >
        {options.length > 1 ? (
          <SegmentedControl
            options={options}
            value={activeTab}
            onChange={onTabChange}
            ariaLabel="Workspace side panel"
          />
        ) : null}
      </PanelHeader>

      <div className="workspace-rail-body">
        {activeTab === 'agent' ? (
          <AgentComposer
            chrome="embedded"
            showConversationHeader
            showModeToolbar
            onOpenLLMConfig={onOpenLLMConfig}
            onStartResearch={onStartResearch}
            onClosePanel={onClose}
          />
        ) : (
          <InspectorRail onClosePanel={onClose} />
        )}
      </div>
    </div>
  )
}
