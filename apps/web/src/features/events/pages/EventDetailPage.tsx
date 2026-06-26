import { useParams, Link } from 'react-router-dom'
import { useEvent } from '../hooks/useEvent'
import type { EventStatus } from '../types/event'

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

export function EventDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { data, isLoading, isError } = useEvent(id ?? '')

  const event = data?.data

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="mb-6">
        <Link
          to="/events"
          className="text-sm font-medium text-blue-600 hover:text-blue-500"
        >
          ← Back to Events
        </Link>
      </div>

      <h1 className="mb-6 text-2xl font-semibold text-gray-900">Event Detail</h1>

      {isLoading && (
        <div className="py-12 text-center text-sm text-gray-500">Loading event…</div>
      )}

      {isError && (
        <div className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
          Failed to load event. Please try again.
        </div>
      )}

      {!isLoading && !isError && !event && (
        <div className="rounded-md bg-yellow-50 px-4 py-3 text-sm text-yellow-700">
          Event not found.
        </div>
      )}

      {event && (
        <div className="space-y-6 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">
                Event ID
              </dt>
              <dd className="mt-1 text-sm text-gray-900 font-mono">{event.id}</dd>
            </div>

            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">
                Event Type
              </dt>
              <dd className="mt-1 text-sm text-gray-900">
                {event.eventType?.name ?? event.eventTypeId}
              </dd>
            </div>

            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">
                Source
              </dt>
              <dd className="mt-1 text-sm text-gray-900">{event.source}</dd>
            </div>

            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">
                Status
              </dt>
              <dd className="mt-1">
                <StatusBadge status={event.status} />
              </dd>
            </div>

            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">
                Received At
              </dt>
              <dd className="mt-1 text-sm text-gray-900">
                {new Date(event.receivedAt).toLocaleString()}
              </dd>
            </div>

            {event.processedAt && (
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-gray-500">
                  Processed At
                </dt>
                <dd className="mt-1 text-sm text-gray-900">
                  {new Date(event.processedAt).toLocaleString()}
                </dd>
              </div>
            )}
          </dl>

          <div>
            <h2 className="mb-2 text-sm font-medium text-gray-700">Payload</h2>
            <pre className="bg-gray-50 rounded p-4 text-xs overflow-auto">
              {JSON.stringify(event.payload, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  )
}
