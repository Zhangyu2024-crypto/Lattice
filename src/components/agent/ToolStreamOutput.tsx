// Live stdout/stderr from workspace_bash tool calls. Subscribes to
// `tool_progress` events on wsClient (dispatched by the orchestrator
// during tool execution) and renders the output as a scrolling monospace
// block below the chat transcript. Automatically clears when a new
// workspace_bash invocation starts; keeps the last output visible until
// the next tool run so the user can read it after the command finishes.
//
// Keeps at most the last 200 lines to avoid unbounded DOM growth on
// verbose build scripts.

import { useEffect, useRef, useState } from 'react'
import { wsClient } from '../../stores/ws-client'

const MAX_LINES = 200

export default function ToolStreamOutput() {
  const [lines, setLines] = useState<string[]>([])
  const [toolName, setToolName] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const offProgress = wsClient.on('tool_progress', (data: unknown) => {
      const d = data as {
        tool_name?: string
        progress?: { kind?: string; stream?: string; data?: string }
      }
      if (d?.progress?.kind === 'bash-output' && d.progress.data) {
        const incoming = d.progress.data
          .split('\n')
          .filter((l) => l.length > 0)
        if (incoming.length === 0) return
        setLines((prev) => {
          const next = [...prev, ...incoming]
          return next.length > MAX_LINES ? next.slice(-MAX_LINES) : next
        })
      }
    })

    const offInvocation = wsClient.on('tool_invocation', (data: unknown) => {
      const d = data as { tool_name?: string }
      if (d?.tool_name === 'workspace_bash') {
        setLines([])
        setToolName('workspace_bash')
      }
    })

    const offResult = wsClient.on('tool_result', (data: unknown) => {
      const d = data as { tool_name?: string }
      if (d?.tool_name === 'workspace_bash') {
        setToolName(null)
      }
    })

    return () => {
      offProgress()
      offInvocation()
      offResult()
    }
  }, [])

  useEffect(() => {
    if (!scrollRef.current) return
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [lines])

  if (lines.length === 0) return null

  return (
    <div className="tool-stream-root">
      <div className="tool-stream-header">
        {toolName ? (
          <span className="tool-stream-badge is-running">bash running</span>
        ) : (
          <span className="tool-stream-badge">bash output</span>
        )}
        <span className="tool-stream-line-count">{lines.length} lines</span>
      </div>
      <div ref={scrollRef} className="tool-stream-scroll">
        <pre className="tool-stream-pre">{lines.join('\n')}</pre>
      </div>
    </div>
  )
}
