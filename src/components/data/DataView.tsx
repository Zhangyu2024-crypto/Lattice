import { useEffect, useMemo, useState } from 'react'
import { Database } from 'lucide-react'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { useDataIndexStore, getGroupedFiles, getStats } from '@/stores/data-index-store'
import DataToolbar from './DataToolbar'
import DataStatsBar from './DataStatsBar'
import DataGroupTree from './DataGroupTree'
import SampleDetail from './SampleDetail'
import FileDetail from './FileDetail'
import DataFooter from './DataFooter'

export default function DataView() {
  const rootPath = useWorkspaceStore((s) => s.rootPath)
  const fileIndex = useWorkspaceStore((s) => s.fileIndex)
  const load = useDataIndexStore((s) => s.load)
  const rebuildFromFileIndex = useDataIndexStore((s) => s.rebuildFromFileIndex)
  const selectedFile = useDataIndexStore((s) => s.selectedFile)
  const selectedSample = useDataIndexStore((s) => s.selectedSample)
  const index = useDataIndexStore((s) => s.index)
  const searchQuery = useDataIndexStore((s) => s.searchQuery)
  const groupBy = useDataIndexStore((s) => s.groupBy)
  const filterTags = useDataIndexStore((s) => s.filterTags)
  const filterTechnique = useDataIndexStore((s) => s.filterTechnique)
  const filterDataType = useDataIndexStore((s) => s.filterDataType)
  const filterRating = useDataIndexStore((s) => s.filterRating)

  const [statsExpanded, setStatsExpanded] = useState(false)

  const hydrate = useWorkspaceStore((s) => s.hydrate)

  useEffect(() => {
    void hydrate()
  }, [hydrate])

  useEffect(() => {
    if (rootPath) {
      void load().then(() => rebuildFromFileIndex())
    }
  }, [rootPath, load, rebuildFromFileIndex])

  const grouped = useMemo(
    () =>
      getGroupedFiles(
        { index, searchQuery, groupBy, filterTags, filterTechnique, filterDataType, filterRating } as Parameters<typeof getGroupedFiles>[0],
        fileIndex,
      ),
    [fileIndex, index, searchQuery, groupBy, filterTags, filterTechnique, filterDataType, filterRating],
  )

  const stats = useMemo(
    () => getStats(index, fileIndex),
    [index, fileIndex],
  )

  if (!rootPath) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          gap: 12,
          padding: 24,
          color: '#888',
        }}
      >
        <Database size={32} strokeWidth={1.2} style={{ opacity: 0.5 }} />
        <strong style={{ color: '#ccc', fontSize: "var(--text-md)" }}>Data Management</strong>
        <p style={{ margin: 0, fontSize: "var(--text-sm)", lineHeight: 1.5, textAlign: 'center', maxWidth: 320 }}>
          Open a workspace folder first. The data manager organizes spectra,
          analyses, images, and papers by sample, technique, or tag.
        </p>
      </div>
    )
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        background: '#1e1e1e',
      }}
    >
      <DataToolbar
        statsExpanded={statsExpanded}
        onStatsToggle={() => setStatsExpanded((v) => !v)}
      />

      {statsExpanded && (
        <DataStatsBar
          stats={stats}
          expanded={statsExpanded}
          onToggle={() => setStatsExpanded((v) => !v)}
        />
      )}

      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <div
          style={{
            flex: '0 0 65%',
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
            borderRight: '1px solid #333',
          }}
        >
          <DataGroupTree grouped={grouped} />
        </div>

        <div
          style={{
            flex: '0 0 35%',
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
            background: '#252525',
          }}
        >
          {selectedSample ? (
            <SampleDetail sampleId={selectedSample} />
          ) : selectedFile ? (
            <FileDetail relPath={selectedFile} />
          ) : (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                height: '100%',
                fontSize: "var(--text-sm)",
                color: '#555',
              }}
            >
              Select a file or sample to view details
            </div>
          )}
        </div>
      </div>

      <DataFooter stats={stats} />
    </div>
  )
}
