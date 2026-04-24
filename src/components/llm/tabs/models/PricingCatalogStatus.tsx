import { DollarSign, Loader2, RefreshCw } from 'lucide-react'
import Button from '../../../ui/Button'
import type { PricingCatalog } from '../../../../lib/model-pricing'
import { formatAge } from './types'

export default function PricingCatalogStatus({
  catalog,
  refreshing,
  onRefresh,
}: {
  catalog: PricingCatalog | null
  refreshing: boolean
  onRefresh: () => void
}) {
  const ageLabel = catalog ? formatAge(Date.now() - catalog.fetchedAt) : null
  return (
    <div className="llm-models-pricing-status">
      <DollarSign size={11} aria-hidden />
      {catalog ? (
        <span>
          Pricing catalog: <strong>{catalog.size}</strong> models · updated{' '}
          {ageLabel} ago
        </span>
      ) : (
        <span>Pricing catalog not loaded yet</span>
      )}
      <Button
        variant="secondary"
        size="sm"
        onClick={onRefresh}
        disabled={refreshing}
        leading={
          refreshing ? (
            <Loader2 size={11} className="spin" />
          ) : (
            <RefreshCw size={11} />
          )
        }
        title="Re-fetch pricing from LiteLLM and apply to all providers"
      >
        {refreshing ? 'Refreshing…' : 'Refresh pricing'}
      </Button>
    </div>
  )
}
