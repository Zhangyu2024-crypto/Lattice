import type { Artifact } from '../../../types/artifact'

interface Props {
  artifact: Artifact
}

const KIND_LABEL: Record<Artifact['kind'], string> = {
  spectrum: 'Spectrum',
  'peak-fit': 'Peak Fit',
  'xrd-analysis': 'XRD Analysis',
  'xps-analysis': 'XPS Analysis',
  'raman-id': 'Raman Identification',
  structure: 'Structure',
  compute: 'Compute',
  'compute-experiment': 'Compute Experiment',
  job: 'Job Monitor',
  'research-report': 'Research Report',
  batch: 'Batch Workflow',
  'material-comparison': 'Material Comparison',
  paper: 'Paper',
  'similarity-matrix': 'Similarity Matrix',
  optimization: 'Optimization',
  hypothesis: 'Hypothesis',
  'xrd-pro': 'XRD Lab',
  'xps-pro': 'XPS Lab',
  'raman-pro': 'Raman Lab',
  'curve-pro': 'Curve Lab',
  'curve-analysis': 'Curve Analysis',
  'spectrum-pro': 'Spectrum Lab',
  'compute-pro': 'Compute Lab',
  'latex-document': 'LaTeX Document',
  plot: 'Plot',
}

export default function PlaceholderArtifactCard({ artifact }: Props) {
  return (
    <div className="card-placeholder-root">
      <div className="card-placeholder-kind">
        {KIND_LABEL[artifact.kind]}
      </div>
      <div className="card-placeholder-desc">
        Renderer for this artifact type is not yet implemented. The data is
        stored in the session and will be visualized once this kind is wired up.
      </div>
    </div>
  )
}
