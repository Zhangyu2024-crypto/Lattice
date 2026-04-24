import { fileKindFromName } from '../../lib/workspace/file-kind'
import SpectrumFileEditor from './editors/SpectrumFileEditor'
import AnalysisFileEditor from './editors/AnalysisFileEditor'
import ChatFileEditor from './editors/ChatFileEditor'
import MarkdownFileEditor from './editors/MarkdownFileEditor'
import ScriptFileEditor from './editors/ScriptFileEditor'
import PdfFileEditor from './editors/PdfFileEditor'
import EnvelopeArtifactEditor from './editors/EnvelopeArtifactEditor'
import CifFileEditor from './editors/CifFileEditor'
import ImageFileEditor from './editors/ImageFileEditor'
import TextFileEditor from './editors/TextFileEditor'
import SpectralDataEditor from './editors/SpectralDataEditor'
import CsvFileEditor from './editors/CsvFileEditor'
import TexFileEditor from './editors/TexFileEditor'
import BibFileEditor from './editors/BibFileEditor'
import UnsupportedFileEditor from './editors/UnsupportedFileEditor'

interface Props {
  relPath: string
}

function basenameOf(relPath: string): string {
  return relPath.split('/').pop() ?? relPath
}

export default function FileEditor({ relPath }: Props) {
  const kind = fileKindFromName(basenameOf(relPath))

  switch (kind) {
    case 'spectrum':
      return <SpectrumFileEditor relPath={relPath} />
    case 'peakfit':
    case 'xrd':
    case 'xps':
    case 'raman':
    case 'curve':
      return <AnalysisFileEditor relPath={relPath} kind={kind} />
    case 'chat':
      return <ChatFileEditor relPath={relPath} />
    case 'markdown':
      return <MarkdownFileEditor relPath={relPath} />
    case 'script':
      return <ScriptFileEditor relPath={relPath} />
    case 'pdf':
      return <PdfFileEditor relPath={relPath} />

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
      return <EnvelopeArtifactEditor relPath={relPath} kind={kind} />

    case 'cif':
      return <CifFileEditor relPath={relPath} />
    case 'image':
      return <ImageFileEditor relPath={relPath} />
    case 'csv':
      return <CsvFileEditor relPath={relPath} />
    case 'tex':
      return <TexFileEditor relPath={relPath} />
    case 'bib':
      return <BibFileEditor relPath={relPath} />

    case 'spectral-data':
    case 'xrd-data':
      return <SpectralDataEditor relPath={relPath} kind={kind} />

    case 'text':
    case 'json':
      return <TextFileEditor relPath={relPath} kind={kind} />

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
}
