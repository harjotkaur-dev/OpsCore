import { useParams, Link } from 'react-router-dom'
import { useExecution } from '../hooks/useExecution'
import { usePermissions } from '../../../hooks/usePermissions'
import type { ExecutionStatus } from '../types/execution'

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

export function ExecutionDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { can } = usePermissions()
  const executionId = id ?? ''

  const { data, isLoading, isError } = useExecution(executionId)

  if (!can('execution:read')) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <div className="rounded-md bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
          You do not have permission to view executions.
        </div>
      </div>
    )
  }

  if (isLoading) {
    return <div className="py-12 text-center text-sm text-gray-500">Loading execution…</div>
  }

  if (isError || !data) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <div className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
          Failed to load execution. Please try again.
        </div>
        <div className="mt-4">
          <Link to="/executions" className="text-sm text-blue-600 hover:underline">
            ← Back to Executions
          </Link>
        </div>
      </div>
    )
  }

  const execution = data.data

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      {/* Back link */}
      <div className="mb-6">
        <Link to="/executions" className="text-sm text-blue-600 hover:underline">
          ← Back to Executions
        </Link>
      </div>

      {/* Header */}
      <div className="mb-6 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex-1">
            <h1 className="text-2xl font-semibold text-gray-900">
              {execution.workflowName ?? 'Execution'}
            </h1>
            <p className="mt-1 font-mono text-xs text-gray-400">{execution.id}</p>
          </div>
          <StatusBadge status={execution.status} />
        </div>

        {/* Metadata */}
        <dl className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
          <div>
            <dt className="text-xs font-medium text-gray-500">Workflow</dt>
            <dd className="mt-1 text-sm text-gray-900">
              {execution.workflowName ?? (
                <span className="font-mono">{execution.workflowId.slice(0, 8)}…</span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-gray-500">Event ID</dt>
            <dd className="mt-1 font-mono text-sm text-gray-900">
              {execution.eventId.slice(0, 8)}…
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-gray-500">Attempts</dt>
            <dd className="mt-1 text-sm text-gray-900">{execution.attemptCount}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-gray-500">Created</dt>
            <dd className="mt-1 text-sm text-gray-900">
              {new Date(execution.createdAt).toLocaleString()}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-gray-500">Started</dt>
            <dd className="mt-1 text-sm text-gray-900">
              {execution.startedAt
                ? new Date(execution.startedAt).toLocaleString()
                : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-gray-500">Completed</dt>
            <dd className="mt-1 text-sm text-gray-900">
              {execution.completedAt
                ? new Date(execution.completedAt).toLocaleString()
                : '—'}
            </dd>
          </div>
        </dl>
      </div>

      {/* Error detail */}
      {execution.status === 'failed' && execution.errorDetail && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-6 shadow-sm">
          <h2 className="mb-3 text-base font-medium text-red-800">Error Detail</h2>
          <pre className="whitespace-pre-wrap break-words text-sm text-red-700">
            {execution.errorDetail}
          </pre>
          {can('execution:retry') && (
            <div className="mt-4">
              <Link
                to="/executions/failed"
                className="text-sm text-blue-600 hover:underline"
              >
                Go to Failed Executions to retry →
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
