// Tiny input row appended under the peak table. Lets the user pipe a
// literal (2θ, intensity) pair into the parent's `onAdd` without going
// through the detection flow — useful when a weak peak is visually
// obvious but misses the SNR / prominence threshold.

import { useState } from 'react'
import { ProButton, ProNumber } from '../../../common/pro'
import { S } from '../XrdProWorkbench.styles'

interface ManualAddPeakProps {
  onAdd: (pos: number, intensity: number) => void
}

export default function ManualAddPeak({ onAdd }: ManualAddPeakProps) {
  const [pos, setPos] = useState<number | ''>('')
  const [intensity, setIntensity] = useState<number | ''>('')
  return (
    <div style={S.manualAddRow}>
      <ProNumber
        value={pos}
        onChange={setPos}
        placeholder="Position"
        width={90}
        step={0.1}
      />
      <ProNumber
        value={intensity}
        onChange={setIntensity}
        placeholder="Int"
        width={70}
        step={1}
      />
      <ProButton
        compact
        onClick={() => {
          if (typeof pos === 'number' && typeof intensity === 'number') {
            onAdd(pos, intensity)
            setPos('')
            setIntensity('')
          }
        }}
      >
        Add
      </ProButton>
    </div>
  )
}
