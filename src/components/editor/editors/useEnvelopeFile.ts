import { useEffect, useRef, useState } from 'react'
import { getWorkspaceFs } from '../../../lib/workspace/fs'
import {
  readEnvelope,
  type LatticeEnvelope,
} from '../../../lib/workspace/envelope'

export interface EnvelopeFileState<P> {
  status: 'loading' | 'ready' | 'error'
  envelope: LatticeEnvelope<P> | null
  error: string | null
}

export function useEnvelopeFile<P>(relPath: string): EnvelopeFileState<P> {
  const [state, setState] = useState<EnvelopeFileState<P>>({
    status: 'loading',
    envelope: null,
    error: null,
  })
  const lastPathRef = useRef<string | null>(null)

  useEffect(() => {
    let cancelled = false
    lastPathRef.current = relPath
    setState({ status: 'loading', envelope: null, error: null })
    const load = async () => {
      try {
        const fs = getWorkspaceFs()
        const env = await readEnvelope<P>(fs, relPath)
        if (cancelled || lastPathRef.current !== relPath) return
        setState({ status: 'ready', envelope: env, error: null })
      } catch (err) {
        if (cancelled || lastPathRef.current !== relPath) return
        setState({
          status: 'error',
          envelope: null,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    void load()

    let disposeWatch: (() => void) | null = null
    void (async () => {
      try {
        const fs = getWorkspaceFs()
        disposeWatch = await fs.watch(relPath, (event) => {
          if (cancelled || lastPathRef.current !== relPath) return
          if (event.type === 'ready') return
          if (event.type === 'unlink' && event.relPath !== relPath) return
          if (event.type === 'add' && event.relPath !== relPath) return
          if (event.type === 'change' && event.relPath !== relPath) return
          void load()
        })
      } catch {
        // Watch support is best-effort; initial read still works.
      }
    })()

    return () => {
      cancelled = true
      disposeWatch?.()
    }
  }, [relPath])

  return state
}
