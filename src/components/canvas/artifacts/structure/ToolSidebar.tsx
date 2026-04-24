// ToolSidebar — left rail of viewer controls. Phase B layout: vertical
// list of collapsible sections (no tab strip; users can scroll faster
// when everything is visible). Each section is an independent module
// under `./tool-sidebar/` so adding / removing one is a self-contained
// edit. This file only composes them and re-exports the prop surface
// consumed by StructureArtifactCard.

import type {
  ProjectionMode,
  Replication,
  StructureStyleMode,
} from './StructureViewer'
import type { StructureTransformKind } from '../../../../types/artifact'

import BuildSection from './tool-sidebar/BuildSection'
import CellSection from './tool-sidebar/CellSection'
import LabelsSection from './tool-sidebar/LabelsSection'
import MeasureSection from './tool-sidebar/MeasureSection'
import RepresentationSection from './tool-sidebar/RepresentationSection'
import ViewSection from './tool-sidebar/ViewSection'
import { S } from './tool-sidebar/styles'

export interface ToolSidebarProps {
  // Style
  style: StructureStyleMode
  onStyleChange: (style: StructureStyleMode) => void

  // Cell + replication
  showUnitCell: boolean
  onToggleUnitCell: () => void
  replication: Replication
  onReplicationChange: (r: Replication) => void

  // Spin / view
  autoSpin: boolean
  onToggleAutoSpin: () => void
  onResetView: () => void

  // Measure
  measureMode: boolean
  onToggleMeasureMode: () => void
  onClearMeasurements: () => void
  measurementCount: number
  selectionBufferCount: number

  // Labels
  showElementLabels: boolean
  onToggleElementLabels: () => void

  // View
  backgroundColor: string
  onBackgroundChange: (color: string) => void
  projection: ProjectionMode
  onProjectionChange: (p: ProjectionMode) => void
  showAxes: boolean
  onToggleAxes: () => void
  onExport: (format: 'png' | 'jpeg' | 'pdf' | 'cif') => void

  // Quick structure edits
  onTransformAction: (id: StructureTransformKind) => void

  /** Open a CIF text editor. The parent is responsible for showing the
   *  modal and routing the edited text back into the artifact's
   *  payload — this sidebar just surfaces the button. Undefined hides
   *  the entry. */
  onEditCif?: () => void

}

export default function ToolSidebar(props: ToolSidebarProps) {
  return (
    <div style={S.root}>
      <RepresentationSection
        style={props.style}
        onStyleChange={props.onStyleChange}
      />

      <CellSection
        showUnitCell={props.showUnitCell}
        onToggleUnitCell={props.onToggleUnitCell}
        replication={props.replication}
        onReplicationChange={props.onReplicationChange}
      />

      <MeasureSection
        measureMode={props.measureMode}
        onToggleMeasureMode={props.onToggleMeasureMode}
        onClearMeasurements={props.onClearMeasurements}
        measurementCount={props.measurementCount}
        selectionBufferCount={props.selectionBufferCount}
      />

      <LabelsSection
        showElementLabels={props.showElementLabels}
        onToggleElementLabels={props.onToggleElementLabels}
      />

      <ViewSection
        backgroundColor={props.backgroundColor}
        onBackgroundChange={props.onBackgroundChange}
        projection={props.projection}
        onProjectionChange={props.onProjectionChange}
        showAxes={props.showAxes}
        onToggleAxes={props.onToggleAxes}
        autoSpin={props.autoSpin}
        onToggleAutoSpin={props.onToggleAutoSpin}
        onResetView={props.onResetView}
        onExport={props.onExport}
      />

      <BuildSection
        onTransformAction={props.onTransformAction}
        onEditCif={props.onEditCif}
      />

    </div>
  )
}
