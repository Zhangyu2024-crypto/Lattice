// LLM verdict card rendered under the Phase Search section whenever the
// backend returns an identification object. Shows the model name,
// confidence, reasoning text, and the element set the retriever used —
// giving the user enough context to trust (or discount) the call.

import type { XrdProIdentification } from '../../../../types/artifact'

interface XrdIdentificationSummaryProps {
  identification: XrdProIdentification
}

export default function XrdIdentificationSummary({
  identification,
}: XrdIdentificationSummaryProps) {
  const { predictedPhases, confidence, reasoning, model, elements } =
    identification
  const hasPhases = predictedPhases.length > 0
  return (
    <div
      style={{
        marginTop: 8,
        padding: '8px 10px',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-sm)',
        background: 'rgba(255, 255, 255, 0.02)',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontSize: 'var(--text-xxs)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          color: 'var(--color-text-muted)',
        }}
      >
        <span>LLM Verdict</span>
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            color: 'var(--color-text-secondary)',
          }}
        >
          {(confidence * 100).toFixed(0)}% · {model}
        </span>
      </div>
      <div
        style={{
          fontSize: 'var(--text-xs)',
          color: 'var(--color-text-primary)',
        }}
      >
        {hasPhases ? (
          <span>
            Predicted:{' '}
            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 500 }}>
              {predictedPhases.join(', ')}
            </span>
          </span>
        ) : (
          <span style={{ color: 'var(--color-text-muted)' }}>
            No phase committed by the model.
          </span>
        )}
      </div>
      {reasoning ? (
        <div
          style={{
            fontSize: 'var(--text-xxs)',
            color: 'var(--color-text-muted)',
            lineHeight: 1.4,
            whiteSpace: 'pre-wrap',
          }}
        >
          {reasoning}
        </div>
      ) : null}
      {elements.length > 0 ? (
        <div
          style={{
            fontSize: 'var(--text-xxs)',
            color: 'var(--color-text-muted)',
            fontFamily: 'var(--font-mono)',
          }}
        >
          query elements: {elements.join(', ')}
        </div>
      ) : null}
    </div>
  )
}
