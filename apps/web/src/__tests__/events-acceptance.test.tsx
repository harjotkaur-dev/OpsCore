/**
 * Phase 11.4 Event Hub Pages Acceptance Tests
 *
 * Verifies:
 * - Events list page renders with table headers and status filter
 * - Events list shows loading state while fetching
 * - Events list renders event rows with status badges
 * - Events list shows empty state when no events
 * - Events list shows error state on API failure
 * - Event ingest page renders form with event type dropdown, source, payload
 * - Event ingest requires event:create permission (shows 403 for member role)
 * - Event ingest: invalid JSON payload shows inline error
 * - Event ingest: successful submission shows success with event ID
 * - Event types list renders with status badges
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import MockAdapter from 'axios-mock-adapter'
import { SessionProvider } from '../providers/SessionProvider'
import { EventsListPage } from '../features/events/pages/EventsListPage'
import { EventIngestPage } from '../features/events/pages/EventIngestPage'
import { EventTypesListPage } from '../features/events/pages/EventTypesListPage'
import { api } from '../lib/api'
import type { ReactNode } from 'react'

function makeQC() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
}

// Wrapper that mounts with an authenticated session (operations_manager by default)
function AuthedWrapper({
  children,
  initialPath = '/',
  role = 'operations_manager',
}: {
  children: ReactNode
  initialPath?: string
  role?: string
}) {
  const qc = makeQC()
  return (
    <QueryClientProvider client={qc}>
      <SessionProvider>
        <MemoryRouter initialEntries={[initialPath]}>
          {children}
        </MemoryRouter>
      </SessionProvider>
    </QueryClientProvider>
  )
}

const MOCK_USER_OPS_MGR = {
  id: 'user-123',
  email: 'ops@example.com',
  fullName: 'Ops Manager',
  organizationId: 'org-abc',
  role: 'operations_manager',
}

const MOCK_USER_MEMBER = {
  id: 'user-456',
  email: 'member@example.com',
  fullName: 'Team Member',
  organizationId: 'org-abc',
  role: 'member',
}

const MOCK_EVENTS = [
  {
    id: 'evt-001',
    organizationId: 'org-abc',
    eventTypeId: 'et-001',
    eventType: { id: 'et-001', name: 'order.created', source: 'api' },
    source: 'api',
    payload: { orderId: 'ord-1', quantity: 5 },
    idempotencyKey: 'key-001',
    status: 'processed',
    receivedAt: '2024-01-15T10:00:00.000Z',
    processedAt: '2024-01-15T10:00:01.000Z',
  },
  {
    id: 'evt-002',
    organizationId: 'org-abc',
    eventTypeId: 'et-002',
    eventType: { id: 'et-002', name: 'payment.failed', source: 'webhook' },
    source: 'webhook',
    payload: { transactionId: 'txn-1' },
    idempotencyKey: 'key-002',
    status: 'failed',
    receivedAt: '2024-01-15T11:00:00.000Z',
    processedAt: null,
  },
  {
    id: 'evt-003',
    organizationId: 'org-abc',
    eventTypeId: 'et-001',
    eventType: { id: 'et-001', name: 'order.created', source: 'api' },
    source: 'manual',
    payload: { orderId: 'ord-2', quantity: 1 },
    idempotencyKey: 'key-003',
    status: 'received',
    receivedAt: '2024-01-15T12:00:00.000Z',
    processedAt: null,
  },
]

const MOCK_EVENT_TYPES = [
  {
    id: 'et-001',
    organizationId: 'org-abc',
    name: 'order.created',
    description: 'Triggered when a new order is placed',
    payloadSchema: {},
    source: 'api',
    status: 'active',
    version: 1,
    createdBy: 'user-123',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  },
  {
    id: 'et-002',
    organizationId: 'org-abc',
    name: 'payment.failed',
    description: 'Triggered when a payment fails',
    payloadSchema: {},
    source: 'webhook',
    status: 'deprecated',
    version: 2,
    createdBy: 'user-123',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-10T00:00:00.000Z',
  },
]

describe('Phase 11.4 Event Hub Pages Acceptance Tests', () => {
  let mockApi: MockAdapter

  beforeEach(() => {
    mockApi = new MockAdapter(api)
  })

  afterEach(() => {
    mockApi.restore()
  })

  // ─── EVENTS LIST PAGE ─────────────────────────────────────────────────────

  test('EventsList: shows loading state while fetching', async () => {
    mockApi.onGet('/users/me').reply(200, MOCK_USER_OPS_MGR)
    mockApi.onGet('/events').reply(() => new Promise(() => {})) // never resolves

    render(
      <AuthedWrapper>
        <Routes>
          <Route path="/" element={<EventsListPage />} />
        </Routes>
      </AuthedWrapper>
    )

    // Session loads first
    await waitFor(() => expect(mockApi.history.get?.some(r => r.url === '/users/me')).toBe(true))

    await waitFor(() => {
      expect(screen.getByText(/loading events/i)).toBeInTheDocument()
    }, { timeout: 3000 })

    console.log('✅ EventsList: loading state shown while fetching')
  })

  test('EventsList: renders table with event rows and status badges', async () => {
    mockApi.onGet('/users/me').reply(200, MOCK_USER_OPS_MGR)
    mockApi.onGet('/events').reply(200, {
      data: MOCK_EVENTS,
      pagination: { limit: 20, hasNextPage: false, nextCursor: null },
    })

    render(
      <AuthedWrapper>
        <Routes>
          <Route path="/" element={<EventsListPage />} />
        </Routes>
      </AuthedWrapper>
    )

    // Wait for data to load — order.created appears twice (2 events of same type)
    await waitFor(() => {
      expect(screen.getAllByText('order.created').length).toBe(2)
    }, { timeout: 3000 })

    // Table headers (use exact text to avoid matching filter dropdown options)
    expect(screen.getByRole('columnheader', { name: /event type/i })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: /source/i })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: /^status$/i })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: /received at/i })).toBeInTheDocument()

    // Event rows — order.created appears twice (two events with same type)
    expect(screen.getAllByText('order.created').length).toBe(2)
    expect(screen.getByText('payment.failed')).toBeInTheDocument()

    // Status badges
    expect(screen.getByText('processed')).toBeInTheDocument()
    expect(screen.getByText('failed')).toBeInTheDocument()
    expect(screen.getByText('received')).toBeInTheDocument()

    // Ingest button
    expect(screen.getByRole('button', { name: /ingest event/i })).toBeInTheDocument()

    console.log('✅ EventsList: table rendered with 3 events and correct status badges')
  })

  test('EventsList: shows empty state when no events', async () => {
    mockApi.onGet('/users/me').reply(200, MOCK_USER_OPS_MGR)
    mockApi.onGet('/events').reply(200, {
      data: [],
      pagination: { limit: 20, hasNextPage: false, nextCursor: null },
    })

    render(
      <AuthedWrapper>
        <Routes>
          <Route path="/" element={<EventsListPage />} />
        </Routes>
      </AuthedWrapper>
    )

    await waitFor(() => {
      expect(screen.getByText(/no events found/i)).toBeInTheDocument()
    }, { timeout: 3000 })

    console.log('✅ EventsList: empty state shown when no events')
  })

  test('EventsList: shows error state on API failure', async () => {
    mockApi.onGet('/users/me').reply(200, MOCK_USER_OPS_MGR)
    mockApi.onGet('/events').reply(500)

    render(
      <AuthedWrapper>
        <Routes>
          <Route path="/" element={<EventsListPage />} />
        </Routes>
      </AuthedWrapper>
    )

    await waitFor(() => {
      expect(screen.getByText(/failed to load events/i)).toBeInTheDocument()
    }, { timeout: 3000 })

    console.log('✅ EventsList: error state shown on API failure')
  })

  test('EventsList: status filter control is present', async () => {
    mockApi.onGet('/users/me').reply(200, MOCK_USER_OPS_MGR)
    mockApi.onGet('/events').reply(200, {
      data: MOCK_EVENTS,
      pagination: { limit: 20, hasNextPage: false, nextCursor: null },
    })

    render(
      <AuthedWrapper>
        <Routes>
          <Route path="/" element={<EventsListPage />} />
        </Routes>
      </AuthedWrapper>
    )

    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: /filter by status/i })).toBeInTheDocument()
    }, { timeout: 3000 })

    const filter = screen.getByRole('combobox', { name: /filter by status/i })
    expect(filter).toBeInTheDocument()

    console.log('✅ EventsList: status filter control present')
  })

  // ─── EVENT INGEST PAGE ────────────────────────────────────────────────────

  test('EventIngest: renders form with all required controls', async () => {
    mockApi.onGet('/users/me').reply(200, MOCK_USER_OPS_MGR)
    mockApi.onGet('/event-types').reply(200, { data: MOCK_EVENT_TYPES })

    render(
      <AuthedWrapper initialPath="/events/ingest">
        <Routes>
          <Route path="/events/ingest" element={<EventIngestPage />} />
        </Routes>
      </AuthedWrapper>
    )

    await waitFor(() => {
      expect(screen.getByLabelText(/event type/i)).toBeInTheDocument()
    }, { timeout: 3000 })

    expect(screen.getByLabelText(/source/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/payload.*json/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /ingest event/i })).toBeInTheDocument()

    console.log('✅ EventIngest: form with event type, source, payload controls present')
  })

  test('EventIngest: event type dropdown populated from API', async () => {
    mockApi.onGet('/users/me').reply(200, MOCK_USER_OPS_MGR)
    mockApi.onGet('/event-types').reply(200, { data: MOCK_EVENT_TYPES })

    render(
      <AuthedWrapper initialPath="/events/ingest">
        <Routes>
          <Route path="/events/ingest" element={<EventIngestPage />} />
        </Routes>
      </AuthedWrapper>
    )

    await waitFor(() => {
      expect(screen.getByText('order.created')).toBeInTheDocument()
    }, { timeout: 3000 })

    // Both event types available in the dropdown
    expect(screen.getByText('order.created')).toBeInTheDocument()
    expect(screen.getByText('payment.failed')).toBeInTheDocument()

    console.log('✅ EventIngest: event type dropdown populated with API data')
  })

  test('EventIngest: invalid JSON payload shows inline error', async () => {
    const user = userEvent.setup()

    mockApi.onGet('/users/me').reply(200, MOCK_USER_OPS_MGR)
    mockApi.onGet('/event-types').reply(200, { data: MOCK_EVENT_TYPES })

    render(
      <AuthedWrapper initialPath="/events/ingest">
        <Routes>
          <Route path="/events/ingest" element={<EventIngestPage />} />
        </Routes>
      </AuthedWrapper>
    )

    await waitFor(() => {
      expect(screen.getByLabelText(/payload.*json/i)).toBeInTheDocument()
    }, { timeout: 3000 })

    // Wait for event types to populate the dropdown
    await waitFor(() => {
      expect(screen.getByText('order.created')).toBeInTheDocument()
    }, { timeout: 3000 })

    // Select an event type
    await user.selectOptions(screen.getByLabelText(/event type/i), 'et-001')
    // Type invalid JSON
    await user.type(screen.getByLabelText(/payload.*json/i), 'this is not json')
    await user.click(screen.getByRole('button', { name: /ingest event/i }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument()
    })
    expect(screen.getByRole('alert')).toHaveTextContent(/not valid json/i)

    console.log('✅ EventIngest: invalid JSON shows inline parse error')
  })

  test('EventIngest: permission denied for member role', async () => {
    mockApi.onGet('/users/me').reply(200, MOCK_USER_MEMBER)
    mockApi.onGet('/event-types').reply(200, { data: MOCK_EVENT_TYPES })

    render(
      <AuthedWrapper initialPath="/events/ingest">
        <Routes>
          <Route path="/events/ingest" element={<EventIngestPage />} />
        </Routes>
      </AuthedWrapper>
    )

    await waitFor(() => {
      expect(screen.getByText(/do not have permission/i)).toBeInTheDocument()
    }, { timeout: 3000 })

    // Form should NOT be rendered
    expect(screen.queryByRole('button', { name: /ingest event/i })).not.toBeInTheDocument()

    console.log('✅ EventIngest: permission denied message shown for member role')
  })

  test('EventIngest: successful submission shows success with event ID', async () => {
    const user = userEvent.setup()

    mockApi.onGet('/users/me').reply(200, MOCK_USER_OPS_MGR)
    mockApi.onGet('/event-types').reply(200, { data: MOCK_EVENT_TYPES })
    mockApi.onPost('/events').reply(201, {
      data: {
        id: 'evt-new-001',
        organizationId: 'org-abc',
        eventTypeId: 'et-001',
        source: 'manual',
        payload: { orderId: 'ord-99' },
        idempotencyKey: 'key-new',
        status: 'received',
        receivedAt: new Date().toISOString(),
        processedAt: null,
      },
    })

    render(
      <AuthedWrapper initialPath="/events/ingest">
        <Routes>
          <Route path="/events" element={<div>Events List</div>} />
          <Route path="/events/ingest" element={<EventIngestPage />} />
        </Routes>
      </AuthedWrapper>
    )

    await waitFor(() => {
      expect(screen.getByLabelText(/event type/i)).toBeInTheDocument()
    }, { timeout: 3000 })

    // Wait for event types to populate the dropdown
    await waitFor(() => {
      expect(screen.getByText('order.created')).toBeInTheDocument()
    }, { timeout: 3000 })

    await user.selectOptions(screen.getByLabelText(/event type/i), 'et-001')
    await user.clear(screen.getByLabelText(/payload.*json/i))
    // Use fireEvent.change to avoid userEvent interpreting { } as keyboard modifiers
    fireEvent.change(screen.getByLabelText(/payload.*json/i), {
      target: { value: '{"orderId":"ord-99"}' },
    })
    await user.click(screen.getByRole('button', { name: /ingest event/i }))

    await waitFor(() => {
      expect(screen.getByText(/event ingested successfully/i)).toBeInTheDocument()
    }, { timeout: 3000 })

    expect(screen.getByText('evt-new-001')).toBeInTheDocument()
    expect(screen.getByText(/view all events/i)).toBeInTheDocument()

    console.log('✅ EventIngest: success state shows event ID after ingestion')
  })

  // ─── EVENT TYPES LIST PAGE ────────────────────────────────────────────────

  test('EventTypesList: renders with active and deprecated status badges', async () => {
    mockApi.onGet('/users/me').reply(200, MOCK_USER_OPS_MGR)
    mockApi.onGet('/event-types').reply(200, { data: MOCK_EVENT_TYPES })

    render(
      <AuthedWrapper>
        <Routes>
          <Route path="/" element={<EventTypesListPage />} />
        </Routes>
      </AuthedWrapper>
    )

    await waitFor(() => {
      expect(screen.getByText('order.created')).toBeInTheDocument()
    }, { timeout: 3000 })

    expect(screen.getByText('payment.failed')).toBeInTheDocument()
    expect(screen.getByText('active')).toBeInTheDocument()
    expect(screen.getByText('deprecated')).toBeInTheDocument()

    console.log('✅ EventTypesList: renders event types with active/deprecated status badges')
  })
})
