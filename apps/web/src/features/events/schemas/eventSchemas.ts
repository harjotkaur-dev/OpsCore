import { z } from 'zod'

const EVENT_SOURCES = ['api', 'webhook', 'scheduled', 'manual'] as const

export const ingestEventSchema = z.object({
  eventTypeId: z.string().uuid('Event type is required'),
  source: z.enum(EVENT_SOURCES, {
    errorMap: () => ({ message: 'Source must be one of: api, webhook, scheduled, manual' }),
  }),
  payload: z
    .string()
    .min(1, 'Payload is required')
    .refine((val) => {
      try {
        const parsed = JSON.parse(val)
        return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      } catch {
        return false
      }
    }, 'Payload must be a valid JSON object'),
})

export const createEventTypeSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255, 'Name must be 255 characters or fewer'),
  description: z.string().max(1000, 'Description must be 1000 characters or fewer').optional(),
  source: z.enum(EVENT_SOURCES, {
    errorMap: () => ({ message: 'Source must be one of: api, webhook, scheduled, manual' }),
  }),
  payloadSchema: z
    .string()
    .min(1, 'Payload schema is required')
    .refine((val) => {
      try {
        const parsed = JSON.parse(val)
        return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      } catch {
        return false
      }
    }, 'Payload schema must be a valid JSON object'),
})

export type IngestEventFormData = z.infer<typeof ingestEventSchema>
export type CreateEventTypeFormData = z.infer<typeof createEventTypeSchema>
