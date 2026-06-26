/**
 * EventService — Event Type CRUD, deprecation, event ingestion, and event query.
 *
 * Task 3.1: createEventType, updateEventType, deprecateEventType,
 *           listEventTypes, getEventType
 * Task 3.5: ingest
 */

import { prisma, type TransactionClient } from '../lib/prisma.js'
import { Prisma } from '@prisma/client'
import createError from '@fastify/error'
import {
  checkKey,
  setKeyInFlight,
  setKeyCompleted,
  computeSystemKey,
} from '../lib/idempotency.js'
import { validate, clearCache } from '../lib/schemaValidator.js'
import { evaluateRule } from '../lib/ruleEvaluator.js'
import { ExecutionService } from './ExecutionService.js'

// ---------------------------------------------------------------------------
// Custom errors
// ---------------------------------------------------------------------------

const NotFoundError = createError('NOT_FOUND', '%s', 404)
const ConflictError = createError('CONFLICT', '%s', 409)
const ConflictInFlightError = createError('CONFLICT', '%s', 409)
const UnprocessableError = createError('UNPROCESSABLE_ENTITY', '%s', 422)

// ---------------------------------------------------------------------------
// Context type (shared across mutations)
// ---------------------------------------------------------------------------

interface MutationContext {
  requestId?: string
  actorId?: string
}

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export interface CreateEventTypeInput {
  name: string
  description?: string | undefined
  payloadSchema: unknown
  source: string
}

export interface UpdateEventTypeInput {
  name?: string | undefined
  description?: string | undefined
  payloadSchema?: unknown | undefined
}

export interface IngestEventInput {
  /** ID of the EventType to validate the payload against */
  eventTypeId: string
  /** Source of the event: api | webhook | scheduled | manual */
  source: string
  /** Arbitrary event payload — validated against event type schema */
  payload: unknown
  /** Optional client-supplied idempotency key (from Idempotency-Key header) */
  idempotencyKey?: string | undefined
}

// ---------------------------------------------------------------------------
// EventService
// ---------------------------------------------------------------------------

export const EventService = {
  // -------------------------------------------------------------------------
  // Task 3.1 — Event Type CRUD
  // -------------------------------------------------------------------------

  /**
   * Create an event type for an organisation.
   *
   * Constraints:
   *  - (organizationId, name, version) must be unique (version always starts at 1 on create)
   *  - payloadSchema must be a valid JSON object (parsed before this call)
   *  - createdBy is set from context.actorId
   *
   * Writes an audit log entry inside the same transaction.
   */
  async createEventType(
    orgId: string,
    input: CreateEventTypeInput,
    context: MutationContext = {},
  ) {
    if (!context.actorId) {
      throw new Error('actorId is required to create an event type')
    }

    // Check uniqueness: (orgId, name, version=1)
    const existing = await prisma.eventType.findFirst({
      where: { organizationId: orgId, name: input.name, version: 1 },
    })
    if (existing) {
      throw new ConflictError(
        `Event type '${input.name}' (v1) already exists in this organization`,
      )
    }

    return prisma.$transaction(async (tx: TransactionClient) => {
      const eventType = await tx.eventType.create({
        data: {
          organizationId: orgId,
          name: input.name,
          description: input.description ?? null,
          payloadSchema: input.payloadSchema as Prisma.InputJsonValue,
          source: input.source,
          status: 'active',
          version: 1,
          createdBy: context.actorId!,
        },
      })

      await tx.auditLog.create({
        data: {
          organizationId: orgId,
          entityType: 'event',
          entityId: eventType.id,
          action: 'created',
          actorType: 'user',
          actorId: context.actorId!,
          beforeState: Prisma.JsonNull,
          afterState: {
            id: eventType.id,
            name: eventType.name,
            source: eventType.source,
            status: eventType.status,
            version: eventType.version,
          },
          requestId: context.requestId ?? null,
        },
      })

      return eventType
    })
  },

  /**
   * Update name, description, or payloadSchema of an event type.
   * If payloadSchema changes, the compiled validator cache entry is invalidated.
   * Writes an audit log entry inside the same transaction.
   */
  async updateEventType(
    orgId: string,
    eventTypeId: string,
    input: UpdateEventTypeInput,
    context: MutationContext = {},
  ) {
    const eventType = await prisma.eventType.findFirst({
      where: { id: eventTypeId, organizationId: orgId },
    })
    if (!eventType) {
      throw new NotFoundError(`Event type '${eventTypeId}' not found`)
    }

    // If renaming, check uniqueness of new name for this version
    if (input.name && input.name !== eventType.name) {
      const conflict = await prisma.eventType.findFirst({
        where: {
          organizationId: orgId,
          name: input.name,
          version: eventType.version,
        },
      })
      if (conflict) {
        throw new ConflictError(
          `Event type '${input.name}' (v${eventType.version}) already exists in this organization`,
        )
      }
    }

    const result = await prisma.$transaction(async (tx: TransactionClient) => {
      const updated = await tx.eventType.update({
        where: { id: eventTypeId },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.payloadSchema !== undefined
            ? { payloadSchema: input.payloadSchema as Prisma.InputJsonValue }
            : {}),
        },
      })

      await tx.auditLog.create({
        data: {
          organizationId: orgId,
          entityType: 'event',
          entityId: eventTypeId,
          action: 'updated',
          actorType: context.actorId ? 'user' : 'system',
          actorId: context.actorId ?? null,
          beforeState: {
            id: eventType.id,
            name: eventType.name,
            description: eventType.description,
            status: eventType.status,
          },
          afterState: {
            id: updated.id,
            name: updated.name,
            description: updated.description,
            status: updated.status,
          },
          requestId: context.requestId ?? null,
        },
      })

      return updated
    })

    // Invalidate compiled validator cache if schema changed
    if (input.payloadSchema !== undefined) {
      clearCache(eventTypeId)
    }

    return result
  },

  /**
   * Deprecate an event type — sets status to 'deprecated'.
   * Idempotent: returns current record if already deprecated.
   * After deprecation, new event ingestion with this type returns 422.
   * Writes an audit log entry inside the same transaction.
   */
  async deprecateEventType(
    orgId: string,
    eventTypeId: string,
    context: MutationContext = {},
  ) {
    const eventType = await prisma.eventType.findFirst({
      where: { id: eventTypeId, organizationId: orgId },
    })
    if (!eventType) {
      throw new NotFoundError(`Event type '${eventTypeId}' not found`)
    }

    // Idempotent
    if (eventType.status === 'deprecated') {
      return eventType
    }

    return prisma.$transaction(async (tx: TransactionClient) => {
      const updated = await tx.eventType.update({
        where: { id: eventTypeId },
        data: { status: 'deprecated' },
      })

      await tx.auditLog.create({
        data: {
          organizationId: orgId,
          entityType: 'event',
          entityId: eventTypeId,
          action: 'status_changed',
          actorType: context.actorId ? 'user' : 'system',
          actorId: context.actorId ?? null,
          beforeState: {
            id: eventType.id,
            name: eventType.name,
            status: eventType.status,
          },
          afterState: {
            id: updated.id,
            name: updated.name,
            status: updated.status,
          },
          requestId: context.requestId ?? null,
        },
      })

      return updated
    })
  },

  /**
   * List event types for an organisation.
   * Optional status filter: 'active' | 'deprecated'
   */
  async listEventTypes(orgId: string, statusFilter?: string) {
    return prisma.eventType.findMany({
      where: {
        organizationId: orgId,
        ...(statusFilter ? { status: statusFilter } : {}),
      },
      orderBy: [{ name: 'asc' }, { version: 'desc' }],
    })
  },

  // -------------------------------------------------------------------------
  // Task 3.9 — Event Query API
  // -------------------------------------------------------------------------

  /**
   * List events for an organisation with optional filters and cursor pagination.
   *
   * Filters: eventTypeId, source, status, fromDate, toDate
   * Pagination: cursor (event id), limit (default 20, max 100)
   * Order: receivedAt DESC, id DESC (stable for equal timestamps)
   */
  async listEvents(
    orgId: string,
    filters: {
      eventTypeId?: string | undefined
      source?: string | undefined
      status?: string | undefined
      fromDate?: Date | undefined
      toDate?: Date | undefined
    } = {},
    pagination: {
      after?: string | undefined
      limit?: number | undefined
    } = {},
  ) {
    const limit = Math.min(pagination.limit ?? 20, 100)

    const where: Record<string, unknown> = {
      organizationId: orgId,
      ...(filters.eventTypeId ? { eventTypeId: filters.eventTypeId } : {}),
      ...(filters.source ? { source: filters.source } : {}),
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.fromDate || filters.toDate
        ? {
            receivedAt: {
              ...(filters.fromDate ? { gte: filters.fromDate } : {}),
              ...(filters.toDate ? { lte: filters.toDate } : {}),
            },
          }
        : {}),
    }

    // Fetch limit+1 to determine if there is a next page
    const events = await prisma.event.findMany({
      where: where as Parameters<(typeof prisma.event)['findMany']>[0] extends { where?: infer W } ? W : never,
      orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(pagination.after
        ? {
            cursor: { id: pagination.after },
            skip: 1, // skip the cursor record itself
          }
        : {}),
    })

    const hasNextPage = events.length > limit
    const data = hasNextPage ? events.slice(0, limit) : events
    const nextCursor = hasNextPage ? (data[data.length - 1]?.id ?? null) : null

    return {
      data,
      pagination: {
        limit,
        hasNextPage,
        nextCursor,
      },
    }
  },

  /**
   * Get a single event by id within an organisation.
   * Returns null if not found (or belongs to another org).
   */
  async getEvent(orgId: string, eventId: string) {
    return prisma.event.findFirst({
      where: { id: eventId, organizationId: orgId },
    })
  },

  /**
   * Get a single event type by id within an organisation.
   * Returns null if not found.
   */
  async getEventType(orgId: string, eventTypeId: string) {
    return prisma.eventType.findFirst({
      where: { id: eventTypeId, organizationId: orgId },
    })
  },

  // -------------------------------------------------------------------------
  // Task 3.5 — Event Ingestion
  // -------------------------------------------------------------------------

  /**
   * Ingest an event.
   *
   * Full pipeline:
   *  1. Resolve idempotency key (client-supplied or system-computed)
   *  2. Check for completed duplicate (return cached response)
   *  3. Check for in-flight duplicate (return 409)
   *  4. Claim key as in-flight
   *  5. Load and validate event type (must exist, must be active)
   *  6. Validate payload against event type's JSON Schema (422 on failure)
   *  7. Persist immutable Event record + AuditLog in a single transaction
   *  8. Mark idempotency key as completed with the response body
   *
   * Returns the persisted Event record.
   *
   * Throws:
   *  - 409 if idempotency key is in-flight (concurrent duplicate)
   *  - 404 if event type not found in org
   *  - 422 if event type is deprecated
   *  - 422 if payload fails schema validation (includes validation errors)
   */
  async ingest(
    orgId: string,
    input: IngestEventInput,
    context: { requestId?: string; actorId?: string } = {},
  ) {
    // -----------------------------------------------------------------------
    // Step 1 — Resolve the idempotency key
    // -----------------------------------------------------------------------
    const idempKey = input.idempotencyKey
      ?? computeSystemKey(orgId, input.eventTypeId, input.source, input.payload)

    // -----------------------------------------------------------------------
    // Step 2 & 3 — Check for existing record (completed or in-flight)
    // -----------------------------------------------------------------------
    const existing = await checkKey(orgId, idempKey)

    if (existing?.status === 'completed') {
      // Return the original response without reprocessing
      return existing.responseBody as Awaited<ReturnType<typeof prisma.event.create>>
    }

    if (existing?.status === 'in_flight') {
      throw new ConflictInFlightError(
        'A request with this idempotency key is already being processed',
      )
    }

    // -----------------------------------------------------------------------
    // Step 4 — Claim the key as in-flight (atomic Redis SET NX EX)
    // -----------------------------------------------------------------------
    const claimed = await setKeyInFlight(orgId, idempKey)
    if (!claimed) {
      // Race condition: another process claimed between our check and our set
      throw new ConflictInFlightError(
        'A request with this idempotency key is already being processed',
      )
    }

    // -----------------------------------------------------------------------
    // Steps 5–8 — Process the event; errors propagate to caller
    // The in-flight key is intentionally NOT cleared on error — it expires
    // via TTL. Clients should use a new idempotency key for retries.
    // -----------------------------------------------------------------------

    // Step 5 — Load and validate the event type
    const eventType = await prisma.eventType.findFirst({
      where: { id: input.eventTypeId, organizationId: orgId },
    })

    if (!eventType) {
      throw new NotFoundError(`Event type '${input.eventTypeId}' not found`)
    }

    if (eventType.status === 'deprecated') {
      throw new UnprocessableError(
        `Event type '${eventType.name}' is deprecated and no longer accepts new events`,
      )
    }

    // Step 6 — Validate payload against JSON Schema
    const validation = validate(eventType.id, eventType.payloadSchema, input.payload)
    if (!validation.valid) {
      const base = new UnprocessableError('Event payload failed schema validation')
      const err = base as unknown as Error & { validationErrors: typeof validation.errors }
      err.validationErrors = validation.errors
      throw err
    }

    // Step 7 — Persist Event + AuditLog atomically
    const event = await prisma.$transaction(async (tx: TransactionClient) => {
      const created = await tx.event.create({
        data: {
          organizationId: orgId,
          eventTypeId: input.eventTypeId,
          source: input.source,
          payload: input.payload as Prisma.InputJsonValue,
          idempotencyKey: idempKey,
          status: 'received',
        },
      })

      await tx.auditLog.create({
        data: {
          organizationId: orgId,
          entityType: 'event',
          entityId: created.id,
          action: 'created',
          actorType: context.actorId ? 'user' : 'system',
          actorId: context.actorId ?? null,
          beforeState: Prisma.JsonNull,
          afterState: {
            id: created.id,
            eventTypeId: created.eventTypeId,
            source: created.source,
            status: created.status,
            idempotencyKey: created.idempotencyKey,
            receivedAt: created.receivedAt,
          },
          requestId: context.requestId ?? null,
        },
      })

      return created
    })

    // Step 8 — Mark idempotency key as completed (best-effort, non-transactional)
    await setKeyCompleted(orgId, idempKey, 201, event)

    // Step 9 — Match active workflow versions and enqueue execution jobs (Task 4.8)
    // This runs OUTSIDE the event transaction intentionally:
    // the event is already persisted — if matching fails the event is still recorded.
    await EventService.matchWorkflows(orgId, input.eventTypeId, input.payload as Record<string, unknown>, event.id, context.requestId)

    return event
  },

  // -------------------------------------------------------------------------
  // Task 4.8 — Workflow matching + execution enqueueing
  // -------------------------------------------------------------------------

  /**
   * Find all active (published) workflow versions whose triggerEventTypeId matches
   * the ingested event type, evaluate their rules against the payload, and enqueue
   * an execution job for each matching version.
   *
   * This is called after the event is persisted and committed to the DB.
   * Each matching version gets its own execution record + BullMQ job.
   */
  async matchWorkflows(
    orgId: string,
    eventTypeId: string,
    payload: Record<string, unknown>,
    eventId: string,
    requestId?: string,
  ): Promise<void> {
    // Query all published workflow versions for this org whose trigger matches
    const candidates = await prisma.workflowVersion.findMany({
      where: {
        organizationId: orgId,
        status: 'published',
      },
      include: { workflow: { select: { id: true, status: true, deletedAt: true } } },
    })

    // Filter to matching eventTypeId in definition and non-deleted active workflow
    type Candidate = typeof candidates[number]
    const matching = candidates.filter((v: Candidate) => {
      if (v.workflow.status !== 'active' || v.workflow.deletedAt !== null) return false
      const def = v.definition as { triggerEventTypeId?: string; rules?: Array<{ expression: string }> }
      if (def.triggerEventTypeId !== eventTypeId) return false
      return true
    })

    // Evaluate rules for each candidate and enqueue if all pass
    for (const version of matching) {
      const def = version.definition as {
        triggerEventTypeId: string
        rules: Array<{ id: string; expression: string }>
        actions: Array<{ id: string; type: string; orderIndex: number; config: Record<string, unknown> }>
      }

      // All rules must pass (AND semantics)
      let allPass = true
      for (const rule of def.rules) {
        try {
          if (!evaluateRule(rule.expression, payload)) {
            allPass = false
            break
          }
        } catch {
          // Invalid expression — skip this workflow (don't crash ingestion)
          allPass = false
          break
        }
      }

      if (!allPass) continue

      // Enqueue execution — use a mini-transaction just for the execution record
      try {
        await prisma.$transaction(async (tx: TransactionClient) => {
          await ExecutionService.enqueueJob(
            tx,
            orgId,
            version.id,
            version.workflowId,
            eventId,
            requestId,
          )
        })
      } catch {
        // Log the failure but don't fail the event ingestion
        // The event is already persisted — partial execution failures are recoverable
      }
    }
  },
}
