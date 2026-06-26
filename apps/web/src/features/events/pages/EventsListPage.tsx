import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useEvents } from '../hooks/useEvents'
import type { EventStatus } from '../types/event'

const STATUS_OPTIONS: { value: EventStatus | ''; label: string }[] = [
  { value: '', label: 'All statuses' },
  { value: 'received', label: 'Received' },
  { value: 'processed', label: 'Processed' },
  { value: 'failed', label: 'Failed' },
]

function StatusBadge({ status }: { status: EventStatus }) {
  const classes: Record<EventStatus, string> = {
    received: 'bg-gray-100 text-gray-700',
    processed: 'bg-green-100 text-green-700',
    failed: 'bg-red-100 text-red-700',
  }
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${classes[status]}`}
    >
      {status}
    </span>
  )
}

export function EventsListPage() {
  const navigate = useNavigate()
  const [statusFilter, setStatusFilter] = useState<EventStatus | ''>('')

  const filters = statusFilter ? { status: statusFilter } : undefined
  const { data, isLoading, isError } = useEvents(filters)

  const events = data?.data ?? []

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-gray-900">Events</h1>
        <button
          onClick={() => navigate('/events/ingest')}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
        >
          Ingest Event
        </button>
      </div>

      {/* Filters */}
      <div className="mb-4">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as EventStatus | '')}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          aria-label="Filter by status"
        >
          {STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {isLoading && (
        <div className="py-12 text-center text-sm text-gray-500">Loading events…</div>
      )}

      {isError && (
        <div className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
          Failed to load events. Please try again.
        </div>
      )}

      {!isLoading && !isError && (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
          {events.length === 0 ? (
            <div className="py-12 text-center text-sm text-gray-500">No events found.</div>
          ) : (
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                    Event Type
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                    Source
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                    Received At
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {events.map((event) => {
                  const eventTypeName =
                    event.eventType?.name ?? event.eventTypeId.slice(0, 8) + '…'

                  return (
                    <tr
                      key={event.id}
                      onClick={() => navigate(`/events/${event.id}`)}
                      className="cursor-pointer hover:bg-gray-50"
                      aria-label={`View event ${event.id}`}
                    >
                      <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-900">
                        {eventTypeName}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-600">
                        {event.source}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4">
                        <StatusBadge status={event.status} />
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-600">
                        {new Date(event.receivedAt).toLocaleString()}
                      </td>
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
