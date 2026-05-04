import { lazy, Suspense } from 'react'
import { fileKindFromName } from '../../lib/workspace/file-kind'
import UnsupportedFileEditor from './editors/UnsupportedFileEditor'
import EditorLoading from './editors/EditorLoading'

const SpectrumFileEditor = lazy(() => import('./editors/SpectrumFileEditor'))
const AnalysisFileEditor = lazy(() => import('./editors/AnalysisFileEditor'))
const ChatFileEditor = lazy(() => import('./editors/ChatFileEditor'))
const MarkdownFileEditor = lazy(() => import('./editors/MarkdownFileEditor'))
const ScriptFileEditor = lazy(() => import('./editors/ScriptFileEditor'))
const PdfFileEditor = lazy(() => import('./editors/PdfFileEditor'))
const EnvelopeArtifactEditor = lazy(
  () => import('./editors/EnvelopeArtifactEditor'),
)
const CifFileEditor = lazy(() => import('./editors/CifFileEditor'))
const ImageFileEditor = lazy(() => import('./editors/ImageFileEditor'))
const TextFileEditor = lazy(() => import('./editors/TextFileEditor'))
const SpectralDataEditor = lazy(() => import('./editors/SpectralDataEditor'))
const CsvFileEditor = lazy(() => import('./editors/CsvFileEditor'))
const TexFileEditor = lazy(() => import('./editors/TexFileEditor'))
const BibFileEditor = lazy(() => import('./editors/BibFileEditor'))

interface Props {
  relPath: string
}

function basenameOf(relPath: string): string {
  return relPath.split('/').pop() ?? relPath
}

export default function FileEditor({ relPath }: Props) {
  const kind = fileKindFromName(basenameOf(relPath))

  let editor: React.ReactNode
  switch (kind) {
    case 'spectrum':
      editor = <SpectrumFileEditor relPath={relPath} />
      break
    case 'peakfit':
    case 'xrd':
    case 'xps':
    case 'raman':
    case 'curve':
      editor = <AnalysisFileEditor relPath={relPath} kind={kind} />
      break
    case 'chat':
      editor = <ChatFileEditor relPath={relPath} />
      break
    case 'markdown':
      editor = <MarkdownFileEditor relPath={relPath} />
      break
    case 'script':
      editor = <ScriptFileEditor relPath={relPath} />
      break
    case 'pdf':
      editor = <PdfFileEditor relPath={relPath} />
      break

    case 'workbench':
    case 'job':
    case 'research-report':
    case 'hypothesis':
    case 'paper':
    case 'material-comp':
    case 'knowledge':
    case 'batch':
    case 'optimization':
    case 'similarity':
    case 'structure-meta':
    case 'latex-document':
      editor = <EnvelopeArtifactEditor relPath={relPath} kind={kind} />
      break

    case 'cif':
      editor = <CifFileEditor relPath={relPath} />
      break
    case 'image':
      editor = <ImageFileEditor relPath={relPath} />
      break
    case 'csv':
      editor = <CsvFileEditor relPath={relPath} />
      break
    case 'tex':
      editor = <TexFileEditor relPath={relPath} />
      break
    case 'bib':
      editor = <BibFileEditor relPath={relPath} />
      break

    case 'spectral-data':
    case 'xrd-data':
      editor = <SpectralDataEditor relPath={relPath} kind={kind} />
      break

    case 'text':
    case 'json':
      editor = <TextFileEditor relPath={relPath} kind={kind} />
      break

    case 'unknown':
      return <UnsupportedFileEditor relPath={relPath} />

    default: {
      // Exhaustiveness guard: if a new member is added to `LatticeFileKind`
      // without a matching case above, `kind` is no longer `never` here and
      // `tsc` fails. Runtime behaviour is unchanged — the unhandled kind
      // still falls through to the unsupported editor.
      const _exhaustive: never = kind
      void _exhaustive
      return <UnsupportedFileEditor relPath={relPath} />
    }
  }

  return (
    <Suspense fallback={<EditorLoading relPath={relPath} />}>
      {editor}
    </Suspense>
  )
}
