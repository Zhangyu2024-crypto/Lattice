import type { ArtifactKind } from '../../types/artifact'

export type ParamType = 'number' | 'bool' | 'select' | 'text' | 'range'

export interface ParamSchemaBase {
  key: string
  label: string
  description?: string
}

export interface NumberParam extends ParamSchemaBase {
  type: 'number'
  default: number
  min?: number
  max?: number
  step?: number
  unit?: string
}

export interface BoolParam extends ParamSchemaBase {
  type: 'bool'
  default: boolean
}

export interface SelectParam extends ParamSchemaBase {
  type: 'select'
  default: string
  options: readonly string[]
  /**
   * Per-option display labels. Keys are the values in `options`; any key
   * not present falls back to the raw option string in the renderer.
   * Used to hide implementation jargon from the user (e.g. `find_peaks`,
   * `lmfit` are scipy / lmfit function / package names and should read
   * as "Quick peak find" / "Curve fit" in the UI).
   */
  optionLabels?: Readonly<Record<string, string>>
}

export interface TextParam extends ParamSchemaBase {
  type: 'text'
  default: string
  placeholder?: string
}

export interface RangeParam extends ParamSchemaBase {
  type: 'range'
  default: [number, number]
  min: number
  max: number
  step?: number
  unit?: string
}

export type ParamSchema =
  | NumberParam
  | BoolParam
  | SelectParam
  | TextParam
  | RangeParam

export interface ParamGroup {
  title: string
  params: ParamSchema[]
}

export interface KindSchema {
  kind: ArtifactKind
  groups: ParamGroup[]
}

export type KindSchemaMap = Partial<Record<ArtifactKind, KindSchema>>
