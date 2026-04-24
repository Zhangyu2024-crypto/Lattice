import { labelCss, valCss } from './styles'

export default function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', gap: 8, marginBottom: 3 }}>
      <span style={labelCss}>{label}</span>
      <span style={valCss} title={value}>{value}</span>
    </div>
  )
}
