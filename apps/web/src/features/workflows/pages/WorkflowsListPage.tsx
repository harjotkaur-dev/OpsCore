import { useNavigate } from 'react-router-dom'
import { useWorkflows } from '../hooks/useWorkflows'
import { useActivateWorkflow } from '../hooks/useActivateWorkflow'
import { useDeactivateWorkflow } from '../hooks/useDeactivateWorkflow'
import { usePermissions } from '../../../hooks/usePermissions'
import type { WorkflowStatus, Workflow } from '../types/workflow'

const STATUS_BADGE_CLASSES: Record<WorkflowStatus, string> = {
  draft: 'bg-gray-100 text-gray-700',
  active: 'bg-green-100 text-green-700',
  inactive: 'bg-yellow-100 text-yellow-700',
  archived: 'bg-gray-200 text-gray-500',
}

function StatusBadge({ status }: { status: WorkflowStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_BADGE_CLASSES[status]}`}
    >
      {status}
    </span>
  )
}

function WorkflowStatusActions({ workflow }: { workflow: Workflow }) {
  const { can } = usePermissions()
  const activate = useActivateWorkflow()
  const deactivate = useDeactivateWorkflow()

  const handleActivate = (e: React.MouseEvent) => {
    e.stopPropagation()
    activate.mutate(workflow.id)
  }

  const handleDeactivate = (e: React.MouseEvent) => {
    e.stopPropagation()
    deactivate.mutate(workflow.id)
  }

  if (workflow.status === 'draft' || workflow.status === 'inactive') {
    if (!can('workflow:activate')) return null
    return (
      <button
        onClick={handleActivate}
        disabled={activate.isPending}
        className="rounded px-3 py-1 text-xs font-medium text-green-700 hover:bg-green-50 disabled:opacity-50"
      >
        {activate.isPending ? 'Activating…' : 'Activate'}
      </button>
    )
  }

  if (workflow.status === 'active') {
    if (!can('workflow:deactivate')) return null
    return (
      <button
        onClick={handleDeactivate}
        disabled={deactivate.isPending}
        className="rounded px-3 py-1 text-xs font-medium text-yellow-700 hover:bg-yellow-50 disabled:opacity-50"
      >
        {deactivate.isPending ? 'Deactivating…' : 'Deactivate'}
      </button>
    )
  }

  return null
}

export function WorkflowsListPage() {
  const navigate = useNavigate()
  const { can } = usePermissions()
  const { data, isLoading, isError } = useWorkflows()

  const workflows = data?.data ?? []

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-gray-900">Workflows</h1>
        {can('workflow:create') && (
          <button
            onClick={() => navigate('/workflows/new')}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            New Workflow
          </button>
        )}
      </div>

      {isLoading && (
        <div className="py-12 text-center text-sm text-gray-500">Loading workflows…</div>
      )}

      {isError && (
        <div className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
          Failed to load workflows. Please try again.
        </div>
      )}

      {!isLoading && !isError && (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
          {workflows.length === 0 ? (
            <div className="py-12 text-center text-sm text-gray-500">No workflows found.</div>
          ) : (
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                    Name
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                    Version
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                    Created
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {workflows.map((workflow) => (
                  <tr
                    key={workflow.id}
                    onClick={() => navigate(`/workflows/${workflow.id}`)}
                    className="cursor-pointer hover:bg-gray-50"
                    aria-label={`View workflow ${workflow.name}`}
                  >
                    <td className="whitespace-nowrap px-6 py-4 text-sm font-medium text-gray-900">
                      {workflow.name}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4">
                      <StatusBadge status={workflow.status} />
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-600">
                      v{workflow.version}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-600">
                      {new Date(workflow.createdAt).toLocaleDateString()}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4">
                      <WorkflowStatusActions workflow={workflow} />
                    </td>
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
