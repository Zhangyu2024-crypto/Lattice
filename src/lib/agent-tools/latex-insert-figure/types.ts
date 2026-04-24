// Shared types for the `latex_insert_figure_from_artifact` tool.
// Broken out so the public tool file stays focused on the execute
// pipeline and so the helper / io modules have a single import target
// for shared shapes.

export type Placement = 'cursor' | 'end' | 'section'

export interface Input {
  latexArtifactId?: string
  sourceArtifactId?: string
  caption?: string
  placement?: Placement
}

export interface SuccessOutput {
  success: true
  artifactId: string
  insertFile: string
  insertAt: number
  snippet: string
  sourceKind: string
  summary: string
}

export interface ErrorOutput {
  success: false
  error: string
}

export type Output = SuccessOutput | ErrorOutput
