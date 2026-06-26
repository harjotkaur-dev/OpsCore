import { api } from '../../../lib/api'
import type {
  Event,
  EventType,
  EventListResponse,
  EventTypeListResponse,
  EventFilters,
  IngestEventPayload,
  CreateEventTypePayload,
} from '../types/event'

export const eventsApi = {
  /**
   * GET /v1/events — list events with optional filters and cursor pagination
   */
  list: async (filters?: EventFilters, cursor?: string): Promise<EventListResponse> => {
    const params: Record<string, string> = {}
    if (filters?.eventTypeId) params.eventTypeId = filters.eventTypeId
    if (filters?.source) params.source = filters.source
    if (filters?.status) params.status = filters.status
    if (cursor) params.after = cursor

    const response = await api.get<EventListResponse>('/events', { params })
    return response.data
  },

  /**
   * GET /v1/events/:id — get a single event by id
   */
  getById: async (id: string): Promise<{ data: Event }> => {
    const response = await api.get<{ data: Event }>(`/events/${id}`)
    return response.data
  },

  /**
   * POST /v1/events — ingest a new event
   */
  ingest: async (payload: IngestEventPayload): Promise<{ data: Event }> => {
    const response = await api.post<{ data: Event }>('/events', payload)
    return response.data
  },

  /**
   * GET /v1/event-types — list all event types
   */
  listEventTypes: async (): Promise<EventTypeListResponse> => {
    const response = await api.get<EventTypeListResponse>('/event-types')
    return response.data
  },

  /**
   * GET /v1/event-types/:id — get a single event type
   */
  getEventType: async (id: string): Promise<{ data: EventType }> => {
    const response = await api.get<{ data: EventType }>(`/event-types/${id}`)
    return response.data
  },

  /**
   * POST /v1/event-types — create a new event type
   */
  createEventType: async (payload: CreateEventTypePayload): Promise<{ data: EventType }> => {
    const response = await api.post<{ data: EventType }>('/event-types', payload)
    return response.data
  },

  /**
   * POST /v1/event-types/:id/deprecate — deprecate an event type
   */
  deprecateEventType: async (id: string): Promise<{ data: EventType }> => {
    const response = await api.post<{ data: EventType }>(`/event-types/${id}/deprecate`)
    return response.data
  },
}
