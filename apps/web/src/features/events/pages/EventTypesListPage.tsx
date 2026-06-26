import { useEventTypes } from '../hooks/useEventTypes'
import { useDeprecateEventType } from '../hooks/useDeprecateEventType'
import { usePermissions } from '../../../hooks/usePermissions'
import type { EventTypeStatus } from '../types/event'

function StatusBadge({ status }: { status: EventTypeStatus }) {
  const classes: Record<EventTypeStatus, string> = {
    active: 'bg-green-100 text-green-700',
    deprecated: 'bg-gray-100 text-gray-500',
  }
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${classes[status]}`}
    >
      {status}
    </span>
  )
}

export function EventTypesListPage() {
  const { data, isLoading, isError } = useEventTypes()
  const { mutate: deprecate, isPending: isDeprecating, variables: deprecatingId } =
    useDeprecateEventType()
  const { can } = usePermissions()

  const eventTypes = data?.data ?? []
  const canDeprecate = can('event_type:deprecate')

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Event Types</h1>
      </div>

      {isLoading && (
        <div className="py-12 text-center text-sm text-gray-500">Loading event types…</div>
      )}

      {isError && (
        <div className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
          Failed to load event types. Please try again.
        </div>
      )}

      {!isLoading && !isError && (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
          {eventTypes.length === 0 ? (
            <div className="py-12 text-center text-sm text-gray-500">No event types found.</div>
          ) : (
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                    Name
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                    Source
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                    Version
                  </th>
                  {canDeprecate && (
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                      Actions
                    </th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {eventTypes.map((eventType) => {
                  const isThisDeprecating =
                    isDeprecating && deprecatingId === eventType.id
                  return (
                    <tr key={eventType.id}>
                      <td className="whitespace-nowrap px-6 py-4 text-sm font-medium text-gray-900">
                        {eventType.name}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-600">
                        {eventType.source}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4">
                        <StatusBadge status={eventType.status} />
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-600">
                        v{eventType.version}
                      </td>
                      {canDeprecate && (
                        <td className="whitespace-nowrap px-6 py-4">
                          {eventType.status === 'active' && (
                            <button
                              onClick={() => deprecate(eventType.id)}
                              disabled={isDeprecating}
                              aria-label={`Deprecate ${eventType.name}`}
                              className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {isThisDeprecating ? 'Deprecating…' : 'Deprecate'}
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}
