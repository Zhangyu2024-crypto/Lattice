import type { ReactNode } from 'react'

export interface ProTabDef<K extends string = string> {
  id: K
  label: string
  badge?: ReactNode
}

interface Props<K extends string> {
  tabs: ProTabDef<K>[]
  active: K
  onChange: (id: K) => void
}

export default function ProTabs<K extends string>({
  tabs,
  active,
  onChange,
}: Props<K>) {
  return (
    <div className="pro-tabs-bar">
      {tabs.map((t) => {
        const isActive = t.id === active
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onChange(t.id)}
            className={'pro-tabs-tab' + (isActive ? ' is-active' : '')}
          >
            <span>{t.label}</span>
            {t.badge}
          </button>
        )
      })}
    </div>
  )
}
