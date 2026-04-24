import type { CSSProperties } from 'react'

export const labelCss: CSSProperties = {
  fontSize: "var(--text-xs)",
  color: '#888',
  minWidth: 80,
  flexShrink: 0,
}

export const valCss: CSSProperties = {
  fontSize: "var(--text-sm)",
  color: '#ccc',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

export const selectCss: CSSProperties = {
  background: '#2a2a2a',
  border: '1px solid #333',
  borderRadius: 4,
  color: '#ccc',
  fontSize: "var(--text-xs)",
  padding: '3px 6px',
  outline: 'none',
  cursor: 'pointer',
  flex: 1,
}

export const sectionHeader: CSSProperties = {
  fontSize: "var(--text-xs)",
  fontWeight: 500,
  color: '#888',
  marginBottom: 4,
}

export const TECHNIQUE_OPTIONS = ['', 'XRD', 'XPS', 'Raman', 'FTIR', 'SEM', 'TEM', 'EDS', 'AFM', 'Other'] as const

export const TECHNIQUE_PRESETS: Record<string, string[]> = {
  XRD: ['instrument', 'radiation', 'voltage', 'current', 'scanRange', 'stepSize', 'dwellTime', 'temperature'],
  XPS: ['instrument', 'passEnergy', 'spotSize', 'voltage', 'temperature', 'atmosphere'],
  Raman: ['instrument', 'laserWavelength', 'laserPower', 'temperature'],
  FTIR: ['instrument', 'scanRange', 'temperature', 'atmosphere'],
  SEM: ['instrument', 'voltage', 'current'],
  TEM: ['instrument', 'voltage'],
}
