// Icon + status constants for AgentCard. Split out of AgentCard.tsx so the
// main file can focus on composition; kept in a `.ts` (non-tsx) file because
// only the icon identifiers are referenced here — no JSX.

import type { ComponentType } from 'react'
import {
  BookOpen,
  Box,
  FileText,
  LineChart,
  Scale,
  Sigma,
  TerminalSquare,
} from 'lucide-react'
import type { ArtifactKind } from '../../../../types/artifact'

export type StatusTone = 'running' | 'succeeded' | 'failed' | 'muted'

export const ICON_FOR_KIND: Partial<
  Record<
    ArtifactKind,
    ComponentType<{ size?: number; className?: string; 'aria-hidden'?: boolean }>
  >
> = {
  spectrum: LineChart,
  'peak-fit': Sigma,
  'xrd-analysis': LineChart,
  'xps-analysis': LineChart,
  'raman-id': LineChart,
  'xrd-pro': LineChart,
  'xps-pro': LineChart,
  'raman-pro': LineChart,
  'spectrum-pro': LineChart,
  'curve-pro': LineChart,
  structure: Box,
  compute: TerminalSquare,
  'compute-pro': TerminalSquare,
  paper: BookOpen,
  'material-comparison': Scale,
  'latex-document': FileText,
}
