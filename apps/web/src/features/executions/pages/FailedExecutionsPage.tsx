import { useNavigate } from 'react-router-dom'
import { useFailedExecutions } from '../hooks/useFailedExecutions'
import { useRetryExecution } from '../hooks/useRetryExecution'
import { usePermissions } from '../../../hooks/usePermissions'

export function FailedExecutionsPage() {
  const navigate = useNavigate()
  const { can } = usePermissions()
  const { data, isLoading, isError } = useFailedExecutions()
  const retryMutation = useRetryExecution()

  const executions = data?.data ?? []

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
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Failed Executions</h1>
          <p className="mt-1 text-sm text-gray-500">
            Executions that failed and may need to be retried.
          </p>
        </div>
        <button
          onClick={() => navigate('/executions')}
          className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          ← All Executions
        </button>
      </div>

      {isLoading && (
        <div className="py-12 text-center text-sm text-gray-500">Loading failed executions…</div>
      )}

      {isError && (
        <div className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
          Failed to load executions. Please try again.
        </div>
      )}

      {retryMutation.isError && (
        <div className="mb-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
          Failed to retry execution. Please try again.
        </div>
      )}

      {!isLoading && !isError && (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
          {executions.length === 0 ? (
            <div className="py-12 text-center text-sm text-gray-500">No failed executions.</div>
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
                    Started At
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                    Attempts
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                    Error
                  </th>
                  {can('execution:retry') && (
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                      Actions
                    </th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {executions.map((execution) => (
                  <tr key={execution.id} className="hover:bg-gray-50">
                    <td
                      className="whitespace-nowrap px-6 py-4 text-sm font-mono text-blue-600 hover:underline cursor-pointer"
                      onClick={() => navigate(`/executions/${execution.id}`)}
                    >
                      {execution.id.slice(0, 8)}…
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-900">
                      {execution.workflowName ?? execution.workflowId.slice(0, 8) + '…'}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-600">
                      {execution.startedAt
                        ? new Date(execution.startedAt).toLocaleString()
                        : '—'}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-600">
                      {execution.attemptCount}
                    </td>
                    <td className="max-w-xs truncate px-6 py-4 text-sm text-red-600">
                      {execution.errorDetail ?? '—'}
                    </td>
                    {can('execution:retry') && (
                      <td className="whitespace-nowrap px-6 py-4">
                        <button
                          onClick={() => retryMutation.mutate(execution.id)}
                          disabled={retryMutation.isPending}
                          className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                          aria-label={`Retry execution ${execution.id}`}
                        >
                          {retryMutation.isPending ? 'Retrying…' : 'Retry'}
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}
