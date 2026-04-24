import type { KindSchema } from './types'

/**
 * Artifact kinds with no tunable parameters. The drawer renders
 * "No parameters to configure" for these. Kept here so the list of
 * read-only kinds is easy to audit in one place.
 */

// Job Monitor is read-only — no tunable parameters
export const jobSchema: KindSchema = { kind: 'job', groups: [] }

export const structureSchema: KindSchema = { kind: 'structure', groups: [] }
export const batchSchema: KindSchema = { kind: 'batch', groups: [] }
export const knowledgeGraphSchema: KindSchema = {
  kind: 'knowledge-graph',
  groups: [],
}
export const materialComparisonSchema: KindSchema = {
  kind: 'material-comparison',
  groups: [],
}
export const paperSchema: KindSchema = { kind: 'paper', groups: [] }
export const similarityMatrixSchema: KindSchema = {
  kind: 'similarity-matrix',
  groups: [],
}
export const hypothesisSchema: KindSchema = { kind: 'hypothesis', groups: [] }
