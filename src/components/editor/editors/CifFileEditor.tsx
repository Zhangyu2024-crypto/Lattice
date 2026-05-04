import { useMemo } from 'react'
import '../../../styles/artifact-cards.css'
import { Atom } from 'lucide-react'
import type {
  StructureArtifact,
  StructureArtifactPayload,
} from '../../../types/artifact'
import {
  parseCif,
  computeFormula,
  computeLatticeParams,
} from '../../../lib/cif'
import StructureArtifactCard from '../../canvas/artifacts/StructureArtifactCard'
import { useEditableText } from './useEditableText'
import EditorLoading from './EditorLoading'
import EditorError from './EditorError'
import EditorToolbar from './EditorToolbar'
import CodeMirrorEditor from './CodeMirrorEditor'
import EditorSplitPane from './EditorSplitPane'

interface Props {
  relPath: string
}

export default function CifFileEditor({ relPath }: Props) {
  const { text, status, error, dirty, setText, save } = useEditableText(relPath)

  const parsed = useMemo(() => {
    if (!text) return null
    try {
      const cif = parseCif(text)
      const formula = computeFormula(cif.sites)
      const lattice = computeLatticeParams(cif)
      return { cif, formula, lattice, spaceGroup: cif.spaceGroup ?? 'P1' }
    } catch {
      return null
    }
  }, [text])

  if (status === 'loading' || text == null) {
    return <EditorLoading relPath={relPath} />
  }
  if (status === 'error') {
    return (
      <EditorError
        relPath={relPath}
        message={error ?? 'Failed to load CIF file'}
      />
    )
  }

  const handleSave = () => {
    void save()
  }

  const payload: StructureArtifactPayload | null = parsed
    ? {
        cif: text,
        formula: parsed.formula,
        spaceGroup: parsed.spaceGroup,
        latticeParams: {
          a: parsed.lattice.a,
          b: parsed.lattice.b,
          c: parsed.lattice.c,
          alpha: parsed.lattice.alpha,
          beta: parsed.lattice.beta,
          gamma: parsed.lattice.gamma,
        },
        transforms: [],
      }
    : null

  const artifact: StructureArtifact | null = payload
    ? {
        id: `cif_${relPath}`,
        kind: 'structure',
        title: (relPath.split('/').pop() ?? relPath).replace(/\.cif$/i, ''),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        sourceFile: relPath,
        parents: [],
        payload,
      }
    : null

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        background: 'var(--color-bg-panel)',
        color: 'var(--color-text-primary)',
      }}
    >
      <EditorToolbar
        relPath={relPath}
        dirty={dirty}
        onSave={handleSave}
        icon={Atom}
      />
      <EditorSplitPane
        storageKey="lattice.editor.cif.split"
        defaultLeftWidth={480}
        minLeftWidth={260}
        minRightWidth={300}
        label="Resize CIF editor and preview"
        left={
          <CodeMirrorEditor
            value={text}
            onChange={setText}
            onSave={handleSave}
          />
        }
        right={
          <div style={{ minHeight: 0, height: '100%', overflow: 'auto' }}>
            {artifact ? (
              <StructureArtifactCard artifact={artifact} />
            ) : (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  height: '100%',
                  color: 'var(--color-text-muted)',
                  fontSize: "var(--text-sm)",
                  padding: 24,
                  textAlign: 'center',
                }}
              >
                {text.trim()
                  ? 'Failed to parse CIF — check syntax'
                  : 'Empty CIF file'}
              </div>
            )}
          </div>
        }
      />
    </div>
  )
}
