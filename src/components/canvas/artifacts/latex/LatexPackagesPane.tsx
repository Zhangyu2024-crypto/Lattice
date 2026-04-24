import { useMemo, useState } from 'react'
import { Package, Plus, Search, Trash2 } from 'lucide-react'
import type { LatexFile } from '../../../../types/latex'
import { parseAllPackages, type ParsedPackage } from '../../../../lib/latex/package-parser'
import {
  getBundleStatus,
  getPackageCatalog,
  lookupPackage,
  type BundleLoadStatus,
} from '../../../../lib/latex/package-registry'

interface Props {
  files: LatexFile[]
  rootFile: string
  onUpdateFile: (path: string, newContent: string) => void
}

const STATUS_LABEL: Record<BundleLoadStatus, string> = {
  preloaded: 'Preloaded',
  lazy: 'On-demand',
  unavailable: 'Unavailable',
}

export default function LatexPackagesPane({
  files,
  rootFile,
  onUpdateFile,
}: Props) {
  const [search, setSearch] = useState('')
  const [catalogOpen, setCatalogOpen] = useState(false)

  const used = useMemo(() => parseAllPackages(files), [files])
  const usedSet = useMemo(
    () => new Set(used.map((p) => p.name)),
    [used],
  )

  const catalogResults = useMemo(() => {
    if (!search.trim()) return catalogOpen ? getPackageCatalog() : []
    const q = search.toLowerCase()
    return getPackageCatalog().filter(
      (e) => e.name.includes(q) || e.description.toLowerCase().includes(q),
    )
  }, [search, catalogOpen])

  const addPackage = (name: string) => {
    const root = files.find((f) => f.path === rootFile)
    if (!root) return
    const lines = root.content.split('\n')
    let insertIdx = -1
    let beginDocIdx = -1
    for (let i = 0; i < lines.length; i++) {
      if (/\\(?:usepackage|RequirePackage)\s*[\[{]/.test(lines[i])) {
        insertIdx = i
      }
      if (/\\begin\{document\}/.test(lines[i]) && beginDocIdx === -1) {
        beginDocIdx = i
      }
    }
    const newLine = `\\usepackage{${name}}`
    if (insertIdx >= 0) {
      lines.splice(insertIdx + 1, 0, newLine)
    } else if (beginDocIdx >= 0) {
      lines.splice(beginDocIdx, 0, newLine)
    } else {
      lines.push(newLine)
    }
    onUpdateFile(rootFile, lines.join('\n'))
  }

  const removePackage = (pkg: ParsedPackage) => {
    const file = files.find((f) => f.path === pkg.file)
    if (!file) return
    const lines = file.content.split('\n')
    const lineIdx = pkg.line - 1
    if (lineIdx < 0 || lineIdx >= lines.length) return

    const line = lines[lineIdx]
    const braceMatch = /\{([^}]+)\}/.exec(line)
    if (!braceMatch) return

    const names = braceMatch[1].split(',').map((s) => s.trim())
    if (names.length <= 1) {
      lines.splice(lineIdx, 1)
    } else {
      const filtered = names.filter(
        (n) => n.toLowerCase() !== pkg.name,
      )
      if (filtered.length === 0) {
        lines.splice(lineIdx, 1)
      } else {
        lines[lineIdx] = line.replace(
          braceMatch[0],
          `{${filtered.join(', ')}}`,
        )
      }
    }
    onUpdateFile(pkg.file, lines.join('\n'))
  }

  return (
    <div className="latex-packages-pane">
      <section className="latex-packages-section">
        <h3 className="latex-packages-section-title">
          <Package size={14} strokeWidth={2} aria-hidden />
          Used Packages ({used.length})
        </h3>
        {used.length === 0 ? (
          <div className="latex-packages-empty">
            No <code>\usepackage</code> declarations found.
          </div>
        ) : (
          <ul className="latex-packages-list">
            {used.map((pkg, i) => {
              const entry = lookupPackage(pkg.name)
              const status = getBundleStatus(entry?.bundle ?? null)
              return (
                <li key={`${pkg.file}:${pkg.line}:${pkg.name}:${i}`} className="latex-packages-row">
                  <StatusDot status={status} />
                  <div className="latex-packages-row-main">
                    <div className="latex-packages-row-header">
                      <span className="latex-packages-row-name">{pkg.name}</span>
                      {pkg.options != null && (
                        <span className="latex-packages-row-opts">
                          [{pkg.options}]
                        </span>
                      )}
                      <span className="latex-packages-row-file">
                        {pkg.file}:{pkg.line}
                      </span>
                    </div>
                    <div className="latex-packages-row-meta">
                      <span className="latex-packages-row-desc">
                        {entry?.description ?? 'Unknown package'}
                      </span>
                      <span className={`latex-packages-row-status is-${status}`}>
                        {STATUS_LABEL[status]}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="latex-packages-remove-btn"
                    onClick={() => removePackage(pkg)}
                    title={`Remove \\usepackage{${pkg.name}}`}
                    aria-label={`Remove ${pkg.name}`}
                  >
                    <Trash2 size={12} />
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section className="latex-packages-section">
        <h3
          className="latex-packages-section-title latex-packages-section-title--toggle"
          onClick={() => setCatalogOpen((v) => !v)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              setCatalogOpen((v) => !v)
            }
          }}
        >
          <Plus size={14} strokeWidth={2} aria-hidden />
          Add Package
          <span className="latex-packages-chevron">
            {catalogOpen ? '▾' : '▸'}
          </span>
        </h3>
        {(catalogOpen || search.trim()) && (
          <>
            <div className="latex-packages-search-wrap">
              <Search size={13} className="latex-packages-search-icon" />
              <input
                className="latex-packages-search"
                type="text"
                placeholder="Search packages…"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value)
                  if (!catalogOpen) setCatalogOpen(true)
                }}
                autoFocus
              />
            </div>
            <ul className="latex-packages-list latex-packages-catalog">
              {catalogResults.map((entry) => {
                const isUsed = usedSet.has(entry.name)
                const status = getBundleStatus(entry.bundle)
                return (
                  <li key={entry.name} className="latex-packages-row latex-packages-catalog-row">
                    <StatusDot status={status} />
                    <div className="latex-packages-row-main">
                      <div className="latex-packages-row-header">
                        <span className="latex-packages-row-name">{entry.name}</span>
                        {entry.category && (
                          <span className="latex-packages-row-cat">{entry.category}</span>
                        )}
                      </div>
                      <div className="latex-packages-row-meta">
                        <span className="latex-packages-row-desc">{entry.description}</span>
                        <span className={`latex-packages-row-status is-${status}`}>
                          {STATUS_LABEL[status]}
                        </span>
                      </div>
                    </div>
                    {isUsed ? (
                      <span className="latex-packages-used-chip">Used</span>
                    ) : (
                      <button
                        type="button"
                        className="latex-packages-add-btn"
                        onClick={() => addPackage(entry.name)}
                        title={`Add \\usepackage{${entry.name}}`}
                        aria-label={`Add ${entry.name}`}
                      >
                        <Plus size={12} />
                      </button>
                    )}
                  </li>
                )
              })}
              {catalogResults.length === 0 && search.trim() && (
                <li className="latex-packages-empty">
                  No packages matching &ldquo;{search}&rdquo;
                </li>
              )}
            </ul>
          </>
        )}
      </section>
    </div>
  )
}

function StatusDot({ status }: { status: BundleLoadStatus }) {
  return (
    <span
      className={`latex-packages-status-dot is-${status}`}
      title={STATUS_LABEL[status]}
      aria-label={STATUS_LABEL[status]}
    />
  )
}
