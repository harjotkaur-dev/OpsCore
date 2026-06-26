import { useMetrics } from '../hooks/useMetrics'
import type { Metric } from '../types/metric'

// Convert snake_case to Title Case: "total_events_ingested" → "Total Events Ingested"
function formatMetricName(name: string): string {
  return name
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

function MetricCard({ metric }: { metric: Metric }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
      <p className="text-sm font-medium text-gray-500">{formatMetricName(metric.name)}</p>
      <p className="mt-2 text-4xl font-bold text-gray-900">
        {metric.currentValue.toLocaleString()}
      </p>
      <p className="mt-2 text-xs text-gray-400">
        Updated {new Date(metric.computedAt).toLocaleString()}
      </p>
    </div>
  )
}

export function MetricsDashboardPage() {
  const { data, isLoading, isError } = useMetrics()

  const metrics = data?.data ?? []

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Metrics</h1>
        <p className="mt-1 text-sm text-gray-500">Current computed values across the organisation.</p>
      </div>

      {isLoading && (
        <div className="py-12 text-center text-sm text-gray-500">Loading metrics…</div>
      )}

      {isError && (
        <div className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
          Failed to load metrics. Please try again.
        </div>
      )}

      {!isLoading && !isError && metrics.length === 0 && (
        <div className="py-12 text-center text-sm text-gray-500">No metrics available.</div>
      )}

      {!isLoading && !isError && metrics.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {metrics.map((metric) => (
            <MetricCard key={metric.id} metric={metric} />
          ))}
        </div>
      )}
    </div>
  )
}
