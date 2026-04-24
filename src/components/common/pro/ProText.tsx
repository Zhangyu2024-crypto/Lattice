interface Props {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  width?: number | string
  monospace?: boolean
}

export default function ProText({
  value,
  onChange,
  placeholder,
  width,
  monospace = false,
}: Props) {
  const style: React.CSSProperties | undefined =
    width != null
      ? { width: typeof width === 'number' ? `${width}px` : width }
      : undefined
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={'pro-text-input' + (monospace ? ' is-mono' : '')}
      style={style}
    />
  )
}
