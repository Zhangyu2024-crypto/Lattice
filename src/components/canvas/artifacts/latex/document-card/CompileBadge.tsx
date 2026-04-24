import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react'
import type { LatexCompileStatus } from '../../../../../types/latex'
import { Badge } from '../../../../ui'

export function CompileBadge({ status }: { status: LatexCompileStatus }) {
  switch (status) {
    case 'compiling':
      return (
        <Badge variant="info" leading={<Loader2 size={10} className="spin" />}>
          compiling
        </Badge>
      )
    case 'succeeded':
      return (
        <Badge variant="success" leading={<CheckCircle2 size={10} />}>
          ok
        </Badge>
      )
    case 'failed':
      return (
        <Badge variant="danger" leading={<AlertTriangle size={10} />}>
          failed
        </Badge>
      )
    default:
      return null
  }
}
