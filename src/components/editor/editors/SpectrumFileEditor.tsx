import SpectrumArtifactCard from '../../canvas/artifacts/SpectrumArtifactCard'
import type {
  SpectrumArtifact,
  SpectrumPayload,
} from '../../../types/artifact'
import { useEnvelopeFile } from './useEnvelopeFile'
import UnsupportedFileEditor from './UnsupportedFileEditor'
import EditorLoading from './EditorLoading'
import EditorError from './EditorError'

interface Props {
  relPath: string
}

function basenameWithoutExt(relPath: string): string {
  const name = relPath.split('/').pop() ?? relPath
  const ext = '.spectrum.json'
  return name.toLowerCase().endsWith(ext)
    ? name.slice(0, name.length - ext.length)
    : name
}

export default function SpectrumFileEditor({ relPath }: Props) {
  const { status, envelope, error } = useEnvelopeFile<SpectrumPayload>(relPath)

  if (status === 'loading') return <EditorLoading relPath={relPath} />
  if (status === 'error' || !envelope) {
    return (
      <EditorError
        relPath={relPath}
        message={error ?? 'Failed to load spectrum file'}
      />
    )
  }
  if (envelope.kind !== 'spectrum') {
    return (
      <UnsupportedFileEditor
        relPath={relPath}
        reason={`File declares kind="${envelope.kind}", expected "spectrum"`}
      />
    )
  }

  const payload = envelope.payload
  const artifact: SpectrumArtifact = {
    id: envelope.id || `spectrum_${relPath}`,
    kind: 'spectrum',
    title: basenameWithoutExt(relPath),
    createdAt: envelope.createdAt,
    updatedAt: envelope.updatedAt,
    sourceFile: relPath,
    parents: [],
    payload,
  }

  return (
    <div style={{ padding: 12, overflow: 'auto', height: '100%' }}>
      <SpectrumArtifactCard spectrum={artifact} />
    </div>
  )
}
