import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useExecutions } from '../hooks/useExecutions'
import { usePermissions } from '../../../hooks/usePermissions'
import type { ExecutionStatus } from '../types/execution'

const STATUS_OPTIONS: { value: ExecutionStatus | ''; label: string }[] = [
  { value: '', label: 'All statuses' },
  { value: 'queued', label: 'Queued' },
  { value: 'running', label: 'Running' },
  { value: 'completed', label: 'Completed' },
  { value: 'failed', label: 'Failed' },
]

const STATUS_BADGE: Record<ExecutionStatus, string> = {
  queued: 'bg-gray-100 text-gray-700',
  running: 'bg-blue-100 text-blue-700',
  completed: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
}

function StatusBadge({ status }: { status: ExecutionStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_BADGE[status]}`}
    >
      {status}
    </span>
  )
}

export function ExecutionsListPage() {
  const navigate = useNavigate()
  const { can } = usePermissions()
  const [statusFilter, setStatusFilter] = useState<ExecutionStatus | ''>('')
  const [workflowIdFilter, setWorkflowIdFilter] = useState('')
  const [cursor, setCursor] = useState<string | undefined>(undefined)

  const filters = {
    ...(statusFilter ? { status: statusFilter } : {}),
    ...(workflowIdFilter.trim() ? { workflowId: workflowIdFilter.trim() } : {}),
  }

  const { data, isLoading, isError } = useExecutions(
    Object.keys(filters).length > 0 ? filters : undefined,
    cursor
  )

  const executions = data?.data ?? []
  const pagination = data?.pagination

  if (!can('execution:read')) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-8">
        <div className="rounded-md bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
          You do not have permission to view executions.
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-gray-900">Executions</h1>
        <a
          href="/executions/failed"
          onClick={(e) => {
            e.preventDefault()
            navigate('/executions/failed')
          }}
          className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          View Failed
        </a>
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap gap-3">
        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value as ExecutionStatus | '')
            setCursor(undefined)
          }}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          aria-label="Filter by status"
        >
          {STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

        <input
          type="text"
          value={workflowIdFilter}
          onChange={(e) => {
            setWorkflowIdFilter(e.target.value)
            setCursor(undefined)
          }}
          placeholder="Filter by workflow ID"
          className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          aria-label="Filter by workflow ID"
        />
      </div>

      {isLoading && (
        <div className="py-12 text-center text-sm text-gray-500">Loading executions…</div>
      )}

      {isError && (
        <div className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
          Failed to load executions. Please try again.
        </div>
      )}

      {!isLoading && !isError && (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
          {executions.length === 0 ? (
            <div className="py-12 text-center text-sm text-gray-500">No executions found.</div>
          ) : (
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                    ID
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                    Workflow
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                    Started At
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                    Completed At
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                    Attempts
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {executions.map((execution) => (
                  <tr
                    key={execution.id}
                    onClick={() => navigate(`/executions/${execution.id}`)}
                    className="cursor-pointer hover:bg-gray-50"
                    aria-label={`View execution ${execution.id}`}
                  >
                    <td className="whitespace-nowrap px-6 py-4 text-sm font-mono text-gray-900">
                      {execution.id.slice(0, 8)}…
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-900">
                      {execution.workflowName ?? execution.workflowId.slice(0, 8) + '…'}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4">
                      <StatusBadge status={execution.status} />
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-600">
                      {execution.startedAt
                        ? new Date(execution.startedAt).toLocaleString()
                        : '—'}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-600">
                      {execution.completedAt
                        ? new Date(execution.completedAt).toLocaleString()
                        : '—'}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-600">
                      {execution.attemptCount}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Pagination */}
      {!isLoading && !isError && pagination && (
        <div className="mt-4 flex items-center justify-between">
          <button
            onClick={() => setCursor(undefined)}
            disabled={!cursor}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            First page
          </button>
          <button
            onClick={() => {
              if (pagination.nextCursor) setCursor(pagination.nextCursor)
            }}
            disabled={!pagination.hasNextPage || !pagination.nextCursor}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Next page
          </button>
        </div>
      )}
    </div>
  )
}
