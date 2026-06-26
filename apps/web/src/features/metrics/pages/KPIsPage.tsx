import { useState } from 'react'
import { useKPIs } from '../hooks/useKPIs'
import { useMetrics } from '../hooks/useMetrics'
import { useCreateKPI } from '../hooks/useCreateKPI'
import { useDeleteKPI } from '../hooks/useDeleteKPI'
import { usePermissions } from '../../../hooks/usePermissions'
import { useSession } from '../../../providers/SessionProvider'
import type { KPI, CreateKPIPayload } from '../types/metric'

type Operator = '>' | '<' | '>=' | '<=' | '='

const OPERATORS: Operator[] = ['>', '<', '>=', '<=', '=']

// ── Badges ────────────────────────────────────────────────────────────────────

function BreachedBadge({ isBreached }: { isBreached: boolean }) {
  if (isBreached) {
    return (
      <span className="inline-flex items-center rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-700">
        Breached
      </span>
    )
  }
  return (
    <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700">
      OK
    </span>
  )
}

// ── KPI row ───────────────────────────────────────────────────────────────────

function KPIRow({ kpi, onDelete, canDelete }: { kpi: KPI; onDelete: (id: string) => void; canDelete: boolean }) {
  return (
    <tr className="hover:bg-gray-50">
      <td className="px-6 py-4 text-sm font-medium text-gray-900">{kpi.name}</td>
      <td className="px-6 py-4 text-sm text-gray-600">{kpi.metricName}</td>
      <td className="px-6 py-4 text-sm text-gray-600 font-mono">{kpi.operator}</td>
      <td className="px-6 py-4 text-sm text-gray-600">{kpi.targetValue.toLocaleString()}</td>
      <td className="px-6 py-4 text-sm text-gray-600">{kpi.currentValue.toLocaleString()}</td>
      <td className="px-6 py-4">
        <BreachedBadge isBreached={kpi.isBreached} />
      </td>
      <td className="px-6 py-4 text-right">
        {canDelete && (
          <button
            onClick={() => onDelete(kpi.id)}
            className="text-sm text-red-600 hover:text-red-800 focus:outline-none"
            aria-label={`Delete KPI ${kpi.name}`}
          >
            Delete
          </button>
        )}
      </td>
    </tr>
  )
}

// ── Create form ───────────────────────────────────────────────────────────────

const EMPTY_FORM = {
  name: '',
  metricName: '',
  operator: '>' as Operator,
  targetValue: '',
}

function CreateKPIForm({ metricNames }: { metricNames: string[] }) {
  const { can } = usePermissions()
  const { user } = useSession()
  const createKPI = useCreateKPI()

  const [form, setForm] = useState(EMPTY_FORM)
  const [error, setError] = useState<string | null>(null)

  if (!can('kpi:create')) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!form.name.trim()) {
      setError('Name is required.')
      return
    }
    if (!form.metricName) {
      setError('Please select a metric.')
      return
    }
    const target = Number(form.targetValue)
    if (form.targetValue === '' || isNaN(target)) {
      setError('Target value must be a number.')
      return
    }

    const payload: CreateKPIPayload = {
      name: form.name.trim(),
      metricName: form.metricName,
      operator: form.operator,
      targetValue: target,
      ownerUserId: user?.id ?? '',
    }

    try {
      await createKPI.mutateAsync(payload)
      setForm(EMPTY_FORM)
    } catch (err: unknown) {
      const axiosMessage =
        (err as { response?: { data?: { message?: string } } }).response?.data?.message
      setError(axiosMessage ?? 'Failed to create KPI. Please try again.')
    }
  }

  return (
    <div className="mb-8 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
      <h2 className="mb-4 text-base font-semibold text-gray-900">Create KPI</h2>

      {error && (
        <div className="mb-4 rounded-md bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>
      )}

      <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
        {/* Name */}
        <div className="flex flex-col gap-1">
          <label htmlFor="kpi-name" className="text-xs font-medium text-gray-700">
            Name
          </label>
          <input
            id="kpi-name"
            type="text"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="e.g. High Error Rate"
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        {/* Metric selector */}
        <div className="flex flex-col gap-1">
          <label htmlFor="kpi-metric" className="text-xs font-medium text-gray-700">
            Metric
          </label>
          <select
            id="kpi-metric"
            value={form.metricName}
            onChange={(e) => setForm((f) => ({ ...f, metricName: e.target.value }))}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="">Select metric…</option>
            {metricNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>

        {/* Operator */}
        <div className="flex flex-col gap-1">
          <label htmlFor="kpi-operator" className="text-xs font-medium text-gray-700">
            Operator
          </label>
          <select
            id="kpi-operator"
            value={form.operator}
            onChange={(e) => setForm((f) => ({ ...f, operator: e.target.value as Operator }))}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            {OPERATORS.map((op) => (
              <option key={op} value={op}>
                {op}
              </option>
            ))}
          </select>
        </div>

        {/* Target value */}
        <div className="flex flex-col gap-1">
          <label htmlFor="kpi-target" className="text-xs font-medium text-gray-700">
            Target value
          </label>
          <input
            id="kpi-target"
            type="number"
            value={form.targetValue}
            onChange={(e) => setForm((f) => ({ ...f, targetValue: e.target.value }))}
            placeholder="0"
            className="w-32 rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <button
          type="submit"
          disabled={createKPI.isPending}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50"
        >
          {createKPI.isPending ? 'Creating…' : 'Create KPI'}
        </button>
      </form>
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

export function KPIsPage() {
  const { can } = usePermissions()
  const { data: kpisData, isLoading: kpisLoading, isError: kpisError } = useKPIs()
  const { data: metricsData } = useMetrics()
  const deleteKPI = useDeleteKPI()

  const kpis = kpisData?.data ?? []
  const metricNames = (metricsData?.data ?? []).map((m) => m.name)

  const handleDelete = (id: string) => {
    deleteKPI.mutate(id)
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">KPIs</h1>
        <p className="mt-1 text-sm text-gray-500">
          Define thresholds for key metrics and track breaches.
        </p>
      </div>

      {/* Create form (permission-gated inside the component) */}
      <CreateKPIForm metricNames={metricNames} />

      {/* Loading */}
      {kpisLoading && (
        <div className="py-12 text-center text-sm text-gray-500">Loading KPIs…</div>
      )}

      {/* Error */}
      {kpisError && (
        <div className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
          Failed to load KPIs. Please try again.
        </div>
      )}

      {/* Table */}
      {!kpisLoading && !kpisError && (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
          {kpis.length === 0 ? (
            <div className="py-12 text-center text-sm text-gray-500">No KPIs defined yet.</div>
          ) : (
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                    Name
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                    Metric
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                    Op
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                    Target
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                    Current
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                    Status
                  </th>
                  <th className="px-6 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {kpis.map((kpi) => (
                  <KPIRow
                    key={kpi.id}
                    kpi={kpi}
                    onDelete={handleDelete}
                    canDelete={can('kpi:delete')}
                  />
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}
