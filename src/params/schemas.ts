import type { ArtifactKind } from '../types/artifact'
import type { KindSchema, KindSchemaMap } from './schemas/types'
import { peakFitSchema, spectrumSchema } from './schemas/spectrum'
import { xrdAnalysisSchema } from './schemas/xrd'
import { xpsAnalysisSchema } from './schemas/xps'
import { ramanIdSchema } from './schemas/raman'
import { computeSchema } from './schemas/compute'
import { optimizationSchema, researchReportSchema } from './schemas/research'
import {
  batchSchema,
  hypothesisSchema,
  jobSchema,
  materialComparisonSchema,
  paperSchema,
  similarityMatrixSchema,
  structureSchema,
} from './schemas/empty'

export type {
  BoolParam,
  KindSchema,
  NumberParam,
  ParamGroup,
  ParamSchema,
  ParamSchemaBase,
  ParamType,
  RangeParam,
  SelectParam,
  TextParam,
} from './schemas/types'

export const PARAM_SCHEMAS: KindSchemaMap = {
  spectrum: spectrumSchema,
  'peak-fit': peakFitSchema,
  'xrd-analysis': xrdAnalysisSchema,
  'xps-analysis': xpsAnalysisSchema,
  'raman-id': ramanIdSchema,
  job: jobSchema,
  compute: computeSchema,
  'research-report': researchReportSchema,
  structure: structureSchema,
  batch: batchSchema,
  'material-comparison': materialComparisonSchema,
  paper: paperSchema,
  'similarity-matrix': similarityMatrixSchema,
  optimization: optimizationSchema,
  hypothesis: hypothesisSchema,
}

export function getSchemaForKind(kind: ArtifactKind): KindSchema | null {
  return PARAM_SCHEMAS[kind] ?? null
}
