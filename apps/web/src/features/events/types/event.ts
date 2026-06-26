// TypeScript interfaces for the Event Hub feature

export type EventSource = 'api' | 'webhook' | 'scheduled' | 'manual'
export type EventStatus = 'received' | 'processed' | 'failed'
export type EventTypeStatus = 'active' | 'deprecated'

export interface Event {
  id: string
  organizationId: string
  eventTypeId: string
  eventType?: Pick<EventType, 'id' | 'name' | 'source'>
  source: EventSource
  payload: Record<string, unknown>
  idempotencyKey: string
  status: EventStatus
  receivedAt: string
  processedAt: string | null
}

export interface EventType {
  id: string
  organizationId: string
  name: string
  description: string | null
  payloadSchema: Record<string, unknown>
  source: EventSource
  status: EventTypeStatus
  version: number
  createdBy: string
  createdAt: string
  updatedAt: string
}

export interface PaginationMeta {
  limit: number
  hasNextPage: boolean
  nextCursor: string | null
}

export interface EventListResponse {
  data: Event[]
  pagination: PaginationMeta
}

export interface EventTypeListResponse {
  data: EventType[]
}

export interface EventFilters {
  eventTypeId?: string
  source?: string
  status?: string
}

export interface IngestEventPayload {
  eventTypeId: string
  source: EventSource
  payload: Record<string, unknown>
}

export interface CreateEventTypePayload {
  name: string
  description?: string
  payloadSchema: Record<string, unknown>
  source: EventSource
}
