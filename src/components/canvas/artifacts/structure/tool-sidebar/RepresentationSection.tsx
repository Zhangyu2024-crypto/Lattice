// Atom-style picker. Stick / Ball + Stick / Space-fill radio group.

import { Atom } from 'lucide-react'
import type { StructureStyleMode } from '../StructureViewer'
import { Section } from './primitives'
import { STYLE_OPTIONS } from './constants'
import { S } from './styles'

interface Props {
  style: StructureStyleMode
  onStyleChange: (style: StructureStyleMode) => void
}

export default function RepresentationSection({ style, onStyleChange }: Props) {
  return (
    <Section title="Representation" icon={<Atom size={11} />} defaultOpen>
      <div style={S.optionGroup} role="radiogroup" aria-label="Atom style">
        {STYLE_OPTIONS.map((opt) => {
          const active = opt.value === style
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onStyleChange(opt.value)}
              className={`structure-tool-option${active ? ' is-active' : ''}`}
            >
              {opt.label}
            </button>
          )
        })}
      </div>
    </Section>
  )
}
