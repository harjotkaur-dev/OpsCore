import { useParams, Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useSession } from '../../../providers/SessionProvider'
import { queryKeys } from '../../../lib/queryKeys'
import { workflowsApi } from '../api/workflowsApi'
import { useWorkflow } from '../hooks/useWorkflow'
import { useActivateWorkflow } from '../hooks/useActivateWorkflow'
import { useDeactivateWorkflow } from '../hooks/useDeactivateWorkflow'
import { usePermissions } from '../../../hooks/usePermissions'
import type { WorkflowStatus } from '../types/workflow'

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

export function WorkflowDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { orgId } = useSession()
  const { can } = usePermissions()
  const navigate = useNavigate()

  const workflowId = id ?? ''

  const {
    data: workflowData,
    isLoading: isLoadingWorkflow,
    isError: isWorkflowError,
  } = useWorkflow(workflowId)

  const { data: rulesData, isLoading: isLoadingRules } = useQuery({
    queryKey: [...queryKeys.workflows.detail(orgId ?? '', workflowId), 'rules'],
    queryFn: () => workflowsApi.listRules(workflowId),
    enabled: !!orgId && !!workflowId,
    staleTime: 30_000,
  })

  const { data: actionsData, isLoading: isLoadingActions } = useQuery({
    queryKey: [...queryKeys.workflows.detail(orgId ?? '', workflowId), 'actions'],
    queryFn: () => workflowsApi.listActions(workflowId),
    enabled: !!orgId && !!workflowId,
    staleTime: 30_000,
  })

  const activate = useActivateWorkflow()
  const deactivate = useDeactivateWorkflow()

  const workflow = workflowData?.data
  const rules = rulesData?.data ?? []
  const actions = actionsData?.data ?? []

  if (isLoadingWorkflow) {
    return (
      <div className="py-12 text-center text-sm text-gray-500">Loading workflow…</div>
    )
  }

  if (isWorkflowError || !workflow) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8">
        <div className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
          Failed to load workflow. Please try again.
        </div>
        <div className="mt-4">
          <Link to="/workflows" className="text-sm text-blue-600 hover:underline">
            ← Back to Workflows
          </Link>
        </div>
      </div>
    )
  }

  const handleActivate = () => activate.mutate(workflowId)
  const handleDeactivate = () => deactivate.mutate(workflowId)

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      {/* Header */}
      <div className="mb-6">
        <Link to="/workflows" className="text-sm text-blue-600 hover:underline">
          ← Back to Workflows
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">{workflow.name}</h1>
            {workflow.description && (
              <p className="mt-1 text-sm text-gray-600">{workflow.description}</p>
            )}
          </div>
          <div className="flex items-center gap-3">
            <StatusBadge status={workflow.status} />
            {(workflow.status === 'draft' || workflow.status === 'inactive') &&
              can('workflow:activate') && (
                <button
                  onClick={handleActivate}
                  disabled={activate.isPending}
                  className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
                >
                  {activate.isPending ? 'Activating…' : 'Activate'}
                </button>
              )}
            {workflow.status === 'active' && can('workflow:deactivate') && (
              <button
                onClick={handleDeactivate}
                disabled={deactivate.isPending}
                className="rounded-md bg-yellow-500 px-4 py-2 text-sm font-medium text-white hover:bg-yellow-600 disabled:opacity-50"
              >
                {deactivate.isPending ? 'Deactivating…' : 'Deactivate'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Metadata card */}
      <div className="mb-6 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-base font-medium text-gray-900">Details</h2>
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <dt className="text-xs font-medium text-gray-500">Version</dt>
            <dd className="mt-1 text-sm text-gray-900">v{workflow.version}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-gray-500">Status</dt>
            <dd className="mt-1">
              <StatusBadge status={workflow.status} />
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-gray-500">Trigger Event Type</dt>
            <dd className="mt-1 truncate text-sm text-gray-900">{workflow.triggerEventTypeId}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-gray-500">Created</dt>
            <dd className="mt-1 text-sm text-gray-900">
              {new Date(workflow.createdAt).toLocaleDateString()}
            </dd>
          </div>
        </dl>
      </div>

      {/* Rules section */}
      <div className="mb-6 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-base font-medium text-gray-900">Rules</h2>
        {isLoadingRules ? (
          <p className="text-sm text-gray-500">Loading rules…</p>
        ) : rules.length === 0 ? (
          <p className="text-sm text-gray-500">No rules — this workflow matches all events.</p>
        ) : (
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                  Expression
                </th>
                <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                  Description
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rules.map((rule) => (
                <tr key={rule.id}>
                  <td className="px-4 py-3 font-mono text-sm text-gray-900">{rule.expression}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{rule.description ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Actions section */}
      <div className="mb-6 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-base font-medium text-gray-900">Actions</h2>
        {isLoadingActions ? (
          <p className="text-sm text-gray-500">Loading actions…</p>
        ) : actions.length === 0 ? (
          <p className="text-sm text-gray-500">No actions configured.</p>
        ) : (
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="w-16 px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                  Order
                </th>
                <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                  Type
                </th>
                <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                  Config
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {actions
                .slice()
                .sort((a, b) => a.orderIndex - b.orderIndex)
                .map((action) => (
                  <tr key={action.id}>
                    <td className="px-4 py-3 text-sm text-gray-600">{action.orderIndex}</td>
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">
                      {action.actionType}
                    </td>
                    <td className="px-4 py-3">
                      <pre className="overflow-x-auto rounded bg-gray-50 p-2 text-xs text-gray-800">
                        {JSON.stringify(action.config, null, 2)}
                      </pre>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Footer links */}
      <div className="flex items-center gap-6 text-sm">
        <button
          onClick={() => navigate(`/executions?workflowId=${workflowId}`)}
          className="text-blue-600 hover:underline"
        >
          View Executions →
        </button>
      </div>
    </div>
  )
}
