// Shared labelled section wrapper used by every cell-output renderer.
// Pulled out of outputs.tsx during the split — the public surface is
// intentionally tiny so we can re-export it from the barrel without
// tying renderers to a specific layout component location.

import type { ReactNode } from 'react'

export function OutputSection({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <section className="compute-nb-output-sec">
      <div className="compute-nb-output-label">{label}</div>
      {children}
    </section>
  )
}
