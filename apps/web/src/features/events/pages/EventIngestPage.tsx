import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useEventTypes } from '../hooks/useEventTypes'
import { useIngestEvent } from '../hooks/useIngestEvent'
import { usePermissions } from '../../../hooks/usePermissions'
import type { EventSource } from '../types/event'

const SOURCE_OPTIONS: EventSource[] = ['api', 'webhook', 'scheduled', 'manual']

export function EventIngestPage() {
  const navigate = useNavigate()
  const { can } = usePermissions()
  const { data: eventTypesData, isLoading: isLoadingTypes } = useEventTypes()
  const { mutate: ingest, isPending, isSuccess, data: successData, error } = useIngestEvent()

  const [eventTypeId, setEventTypeId] = useState('')
  const [source, setSource] = useState<EventSource>('manual')
  const [payloadText, setPayloadText] = useState('')
  const [payloadError, setPayloadError] = useState<string | null>(null)

  const eventTypes = eventTypesData?.data ?? []
  const ingestedEventId = successData?.data?.id

  const canCreate = can('event:create')

  if (!canCreate) {
    return (
      <div className="mx-auto max-w-xl px-4 py-8">
        <div className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
          You do not have permission to ingest events.
        </div>
      </div>
    )
  }

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setPayloadError(null)

    let parsedPayload: Record<string, unknown>
    try {
      const parsed = JSON.parse(payloadText)
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        setPayloadError('Payload must be a valid JSON object (not an array or null).')
        return
      }
      parsedPayload = parsed as Record<string, unknown>
    } catch {
      setPayloadError('Payload is not valid JSON. Please check the format.')
      return
    }

    if (!eventTypeId) {
      return
    }

    ingest({ eventTypeId, source, payload: parsedPayload })
  }

  if (isSuccess && ingestedEventId) {
    return (
      <div className="mx-auto max-w-xl px-4 py-8">
        <div className="rounded-lg border border-green-200 bg-green-50 p-6">
          <h2 className="text-lg font-semibold text-green-800">Event ingested successfully</h2>
          <p className="mt-2 text-sm text-green-700">
            Event ID:{' '}
            <span className="font-mono font-medium">{ingestedEventId}</span>
          </p>
          <div className="mt-4">
            <Link
              to="/events"
              className="text-sm font-medium text-blue-600 hover:text-blue-500"
            >
              ← View all events
            </Link>
          </div>
        </div>
      </div>
    )
  }

  const mutationError = error
    ? ((error as { response?: { data?: { message?: string } } }).response?.data
        ?.message ?? 'Failed to ingest event. Please try again.')
    : null

  return (
    <div className="mx-auto max-w-xl px-4 py-8">
      <div className="mb-6">
        <Link
          to="/events"
          className="text-sm font-medium text-blue-600 hover:text-blue-500"
        >
          ← Back to Events
        </Link>
      </div>

      <h1 className="mb-6 text-2xl font-semibold text-gray-900">Ingest Event</h1>

      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <form onSubmit={handleSubmit} noValidate className="space-y-5">
          {mutationError && (
            <div
              role="alert"
              className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-200"
            >
              {mutationError}
            </div>
          )}

          {/* Event Type */}
          <div>
            <label
              htmlFor="eventTypeId"
              className="block text-sm font-medium text-gray-700"
            >
              Event Type
            </label>
            <select
              id="eventTypeId"
              value={eventTypeId}
              onChange={(e) => setEventTypeId(e.target.value)}
              required
              disabled={isPending || isLoadingTypes}
              className="mt-1.5 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-500"
            >
              <option value="">Select an event type…</option>
              {eventTypes.map((et) => (
                <option key={et.id} value={et.id}>
                  {et.name}
                </option>
              ))}
            </select>
          </div>

          {/* Source */}
          <div>
            <label
              htmlFor="source"
              className="block text-sm font-medium text-gray-700"
            >
              Source
            </label>
            <select
              id="source"
              value={source}
              onChange={(e) => setSource(e.target.value as EventSource)}
              disabled={isPending}
              className="mt-1.5 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-500"
            >
              {SOURCE_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          {/* Payload */}
          <div>
            <label
              htmlFor="payload"
              className="block text-sm font-medium text-gray-700"
            >
              Payload (JSON)
            </label>
            <textarea
              id="payload"
              value={payloadText}
              onChange={(e) => {
                setPayloadText(e.target.value)
                setPayloadError(null)
              }}
              rows={6}
              disabled={isPending}
              placeholder={'{ "quantity": 15 }'}
              className="mt-1.5 block w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-sm text-gray-900 placeholder-gray-400 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-500"
            />
            {payloadError && (
              <p className="mt-1 text-xs text-red-600" role="alert">
                {payloadError}
              </p>
            )}
          </div>

          <div className="flex gap-3">
            <button
              type="submit"
              disabled={isPending || !eventTypeId}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isPending ? 'Ingesting…' : 'Ingest Event'}
            </button>
            <button
              type="button"
              onClick={() => navigate('/events')}
              disabled={isPending}
              className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
