import { useId, type ReactNode } from 'react'

// Shared layout primitives for SettingsModal tab bodies. Section renders
// a heading-labelled region; Field renders the two-column label/value grid
// used throughout the Compute + Advanced tabs.

export function Section({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  const headingId = useId()
  return (
    <section
      className="settings-modal-section"
      aria-labelledby={headingId}
    >
      <h2 className="settings-modal-section-heading" id={headingId}>
        {title}
      </h2>
      {children}
    </section>
  )
}

export function Field({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <div className="settings-modal-field-grid">
      <span className="settings-modal-field-label">{label}</span>
      <div className="settings-modal-field-value">{children}</div>
    </div>
  )
}
