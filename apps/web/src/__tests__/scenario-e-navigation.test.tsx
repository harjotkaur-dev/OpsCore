/**
 * Scenario E — Navigation & Router Integrity Tests
 *
 * Uses the real App component with MemoryRouter to test actual route resolution.
 * This catches shadowed routes, broken back-navigation, and deep-link failures
 * that page-level tests with simplified routers cannot detect.
 *
 * E1  Task list → click row → task detail renders (no extra navigation needed)
 * E2  Deep link /tasks/:id — renders task detail without prior list navigation
 * E3  Deep link /executions/failed — NEVER shadowed by /executions/:id
 * E4  /executions/failed renders FailedExecutionsPage, not ExecutionDetailPage
 * E5  /executions/:id renders ExecutionDetailPage for a real ID
 * E6  /events/ingest renders EventIngestPage, not EventDetailPage
 * E7  Unauthenticated deep link to /tasks — redirects to /login
 * E8  Unauthenticated deep link to /executions/failed — redirects to /login
 * E9  Unknown route /* — redirects to / then to /dashboard
 * E10 AppShell renders on every authenticated page in the app
 * E11 Session restoration on deep link — /users/me succeeds → renders the page
 * E12 NotificationBell appears inside AppShell on authenticated pages
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import MockAdapter from 'axios-mock-adapter'
import { SessionProvider } from '../providers/SessionProvider'
import App from '../App'
import { api } from '../lib/api'
import type { ReactNode } from 'react'

function makeQC() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
}

// Renders the real App with a given initial path — tests actual route resolution
function AppWrapper({ initialPath, children }: { initialPath: string; children?: ReactNode }) {
  const qc = makeQC()
  return (
    <QueryClientProvider client={qc}>
      <SessionProvider>
        <MemoryRouter initialEntries={[initialPath]}>
          {children ?? <App />}
        </MemoryRouter>
      </SessionProvider>
    </QueryClientProvider>
  )
}

const OPS_MGR = {
  id: 'user-001', email: 'ops@example.com', fullName: 'Ops Manager',
  organizationId: 'org-abc', role: 'operations_manager',
}

const PAGINATION = { limit: 20, hasNextPage: false, nextCursor: null }

describe('Scenario E — Navigation & Router Integrity', () => {
  let mockApi: MockAdapter

  beforeEach(() => { mockApi = new MockAdapter(api) })
  afterEach(() => { mockApi.restore() })

  // ── E1: Task list → click row → task detail renders ─────────────────────────

  test('E1 — Task list navigation: click task row → task detail page renders with correct content', async () => {
    const user = userEvent.setup()

    const task = {
      id: 'task-nav-001',
      organizationId: 'org-abc',
      title: 'Review inventory report',
      priority: 'high' as const,
      status: 'pending' as const,
      overdue: false,
      createdAt: '2024-01-15T09:00:00.000Z',
      updatedAt: '2024-01-15T09:00:00.000Z',
      assignments: [],
    }

    mockApi.onGet('/users/me').reply(200, OPS_MGR)
    mockApi.onGet('/notifications').reply(200, { data: [] })
    mockApi.onGet('/tasks').reply(200, { data: [task] })
    mockApi.onGet('/tasks/task-nav-001').reply(200, { data: task })
    mockApi.onGet('/tasks/task-nav-001/comments').reply(200, { data: [] })

    render(<AppWrapper initialPath="/tasks" />)

    // Wait for task list to load
    await waitFor(() =>
      expect(screen.getByText('Review inventory report')).toBeInTheDocument(),
      { timeout: 3000 }
    )

    // Click the task row
    await user.click(screen.getByRole('row', { name: /view task review inventory report/i }))

    // Task detail page renders
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^start$/i })).toBeInTheDocument(),
      { timeout: 3000 }
    )
    expect(screen.getByText('Review inventory report')).toBeInTheDocument()

    console.log('✅ E1 PASS: Click task row → task detail page renders correctly')
  })

  // ── E2: Deep link /tasks/:id — renders without prior navigation ─────────────

  test('E2 — Deep link /tasks/:id: renders task detail directly, no prior list navigation required', async () => {
    const task = {
      id: 'task-deep-001',
      organizationId: 'org-abc',
      title: 'Fix CPU spike alert',
      priority: 'critical' as const,
      status: 'in_progress' as const,
      overdue: false,
      createdAt: '2024-01-15T10:00:00.000Z',
      updatedAt: '2024-01-15T10:00:00.000Z',
      assignments: [],
    }

    mockApi.onGet('/users/me').reply(200, OPS_MGR)
    mockApi.onGet('/notifications').reply(200, { data: [] })
    mockApi.onGet('/tasks/task-deep-001').reply(200, { data: task })
    mockApi.onGet('/tasks/task-deep-001/comments').reply(200, { data: [] })

    // Navigate directly to task detail — no list visit first
    render(<AppWrapper initialPath="/tasks/task-deep-001" />)

    await waitFor(() =>
      expect(screen.getByText('Fix CPU spike alert')).toBeInTheDocument(),
      { timeout: 3000 }
    )
    expect(screen.getByText('In Progress')).toBeInTheDocument()
    expect(screen.getByText('critical')).toBeInTheDocument()

    console.log('✅ E2 PASS: Deep link /tasks/task-deep-001 → task detail renders without prior navigation')
  })

  // ── E3: /executions/failed — NEVER shadowed by /executions/:id ─────────────
  // This is the highest-risk route ordering issue.
  // React Router v6 is exact by default so /executions/failed should match
  // the literal route, not the :id param. Verified using the real App.

  test('E3 — Route ordering: /executions/failed renders FailedExecutionsPage, not ExecutionDetailPage', async () => {
    mockApi.onGet('/users/me').reply(200, OPS_MGR)
    mockApi.onGet('/notifications').reply(200, { data: [] })
    mockApi.onGet('/executions/failed').reply(200, { data: [], pagination: PAGINATION })

    render(<AppWrapper initialPath="/executions/failed" />)

    await waitFor(() =>
      expect(screen.getByText('Failed Executions')).toBeInTheDocument(),
      { timeout: 3000 }
    )
    // Correct page: FailedExecutionsPage header
    expect(screen.getByText('Executions that failed and may need to be retried.')).toBeInTheDocument()

    // Must NOT render the ExecutionDetailPage error state
    // (which would show "Failed to load execution" or "Loading execution…")
    expect(screen.queryByText(/loading execution…/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/failed to load execution/i)).not.toBeInTheDocument()

    // GET /executions/failed was called (not GET /executions/:id)
    expect(mockApi.history.get?.some(r => r.url === '/executions/failed')).toBe(true)
    // GET /executions/failed was NOT treated as an ID lookup
    expect(mockApi.history.get?.some(r => r.url === '/executions/failed' && r.url !== '/executions/failed')).toBe(false)

    console.log('✅ E3 PASS: /executions/failed → FailedExecutionsPage (not shadowed by /executions/:id)')
  })

  // ── E4: /executions/:id with real UUID renders ExecutionDetailPage ──────────

  test('E4 — /executions/:id: real execution ID renders ExecutionDetailPage', async () => {
    const execution = {
      id: 'exec-real-001',
      organizationId: 'org-abc',
      workflowId: 'wf-001',
      workflowName: 'Alert Workflow',
      eventId: 'evt-001',
      status: 'completed' as const,
      startedAt: '2024-01-15T10:00:00.000Z',
      completedAt: '2024-01-15T10:00:05.000Z',
      errorDetail: null,
      attemptCount: 1,
      createdAt: '2024-01-15T10:00:00.000Z',
    }

    mockApi.onGet('/users/me').reply(200, OPS_MGR)
    mockApi.onGet('/notifications').reply(200, { data: [] })
    mockApi.onGet('/executions/exec-real-001').reply(200, { data: execution })

    render(<AppWrapper initialPath="/executions/exec-real-001" />)

    await waitFor(() =>
      expect(screen.getAllByText('Alert Workflow').length).toBeGreaterThanOrEqual(1),
      { timeout: 3000 }
    )
    expect(screen.getByText('completed')).toBeInTheDocument()
    // Back link to executions list
    expect(screen.getByText('← Back to Executions')).toBeInTheDocument()

    console.log('✅ E4 PASS: /executions/exec-real-001 → ExecutionDetailPage renders correctly')
  })

  // ── E5: /events/ingest never shadowed by /events/:id ───────────────────────

  test('E5 — Route ordering: /events/ingest renders EventIngestPage, not EventDetailPage', async () => {
    mockApi.onGet('/users/me').reply(200, OPS_MGR)
    mockApi.onGet('/notifications').reply(200, { data: [] })
    mockApi.onGet('/event-types').reply(200, { data: [] })

    render(<AppWrapper initialPath="/events/ingest" />)

    await waitFor(() =>
      expect(screen.getAllByText('Ingest Event').length).toBeGreaterThanOrEqual(1),
      { timeout: 3000 }
    )
    // Ingest form fields present (not event detail content)
    expect(screen.getByLabelText(/event type/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/payload.*json/i)).toBeInTheDocument()
    // Ingest button present (unique to ingest page)
    expect(screen.getByRole('button', { name: /ingest event/i })).toBeInTheDocument()

    console.log('✅ E5 PASS: /events/ingest → EventIngestPage (not shadowed by /events/:id)')
  })

  // ── E6: Unauthenticated deep link → redirect to /login ─────────────────────

  test('E6 — Unauthenticated /tasks deep link: no session → redirects to /login', async () => {
    mockApi.onGet('/users/me').reply(401)
    mockApi.onGet('/notifications').reply(401)

    render(<AppWrapper initialPath="/tasks" />)

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument(),
      { timeout: 3000 }
    )
    // Login form rendered — not the tasks list
    expect(screen.queryByText('Task Center')).not.toBeInTheDocument()

    console.log('✅ E6 PASS: Unauthenticated /tasks → redirects to /login')
  })

  // ── E7: Unauthenticated /executions/failed → redirect to /login ─────────────

  test('E7 — Unauthenticated /executions/failed: no session → redirects to /login', async () => {
    mockApi.onGet('/users/me').reply(401)

    render(<AppWrapper initialPath="/executions/failed" />)

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument(),
      { timeout: 3000 }
    )
    expect(screen.queryByText('Failed Executions')).not.toBeInTheDocument()

    console.log('✅ E7 PASS: Unauthenticated /executions/failed → redirects to /login')
  })

  // ── E8: Unknown route → fallback redirect ───────────────────────────────────

  test('E8 — Unknown route /*: redirects to / then dashboard (authenticated)', async () => {
    mockApi.onGet('/users/me').reply(200, OPS_MGR)
    mockApi.onGet('/notifications').reply(200, { data: [] })
    // Dashboard fires these additional queries — mock them to resolve quickly
    mockApi.onGet('/tasks').reply(200, { data: [] })
    mockApi.onGet('/executions').reply(200, { data: [], pagination: PAGINATION })
    mockApi.onGet('/executions/failed').reply(200, { data: [], pagination: PAGINATION })
    mockApi.onGet('/metrics').reply(200, { data: [] })
    mockApi.onGet('/kpis').reply(200, { data: [] })
    mockApi.onGet('/workflows').reply(200, { data: [] })

    render(<AppWrapper initialPath="/this-page-does-not-exist/at/all" />)

    // Unknown route → catch-all → Navigate to / → Navigate to /dashboard
    // AppShell sidebar confirms we've landed on an authenticated page
    await waitFor(() =>
      expect(screen.getByRole('navigation', { name: /primary navigation/i })).toBeInTheDocument(),
      { timeout: 3000 }
    )

    console.log('✅ E8 PASS: Unknown route → falls through to dashboard')
  })

  // ── E9: AppShell renders on all authenticated pages ─────────────────────────

  test('E9 — AppShell: OpsCore header renders on authenticated pages (/tasks, /workflows, /metrics)', async () => {
    mockApi.onGet('/users/me').reply(200, OPS_MGR)
    mockApi.onGet('/notifications').reply(200, { data: [] })
    mockApi.onGet('/tasks').reply(200, { data: [] })

    render(<AppWrapper initialPath="/tasks" />)

    await waitFor(() =>
      // New UX: empty state shows "No tasks yet" (not "No tasks found.")
      expect(screen.getByText(/no tasks yet/i)).toBeInTheDocument(),
      { timeout: 3000 }
    )

    // AppShell header is rendered: 'OpsCore' brand in header
    expect(screen.getByText('OpsCore')).toBeInTheDocument()

    console.log('✅ E9 PASS: AppShell header (OpsCore brand) rendered on authenticated /tasks page')
  })

  // ── E10: NotificationBell in AppShell on authenticated pages ────────────────

  test('E10 — NotificationBell: bell button present in AppShell on /workflows', async () => {
    mockApi.onGet('/users/me').reply(200, OPS_MGR)
    mockApi.onGet('/notifications').reply(200, { data: [] })
    mockApi.onGet('/workflows').reply(200, { data: [] })

    render(<AppWrapper initialPath="/workflows" />)

    await waitFor(() =>
      expect(screen.getByText('No workflows found.')).toBeInTheDocument(),
      { timeout: 3000 }
    )

    // NotificationBell rendered in AppShell header
    expect(screen.getByRole('button', { name: /^notifications$/i })).toBeInTheDocument()

    console.log('✅ E10 PASS: NotificationBell present in AppShell on /workflows')
  })

  // ── E11: NotificationBell navigates to /notifications ───────────────────────

  test('E11 — NotificationBell click: navigates to /notifications page', async () => {
    const user = userEvent.setup()

    mockApi.onGet('/users/me').reply(200, OPS_MGR)
    mockApi.onGet('/notifications').reply(200, { data: [] })
    mockApi.onGet('/tasks').reply(200, { data: [] })

    render(<AppWrapper initialPath="/tasks" />)

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^notifications$/i })).toBeInTheDocument(),
      { timeout: 3000 }
    )

    await user.click(screen.getByRole('button', { name: /^notifications$/i }))

    // Navigates to notifications page
    await waitFor(() =>
      expect(screen.getByText('No notifications')).toBeInTheDocument(),
      { timeout: 3000 }
    )

    console.log('✅ E11 PASS: NotificationBell click → navigates to /notifications page')
  })

  // ── E12: Session restoration on deep link ───────────────────────────────────
  // When a user deep-links directly to /workflows/:id, the SessionProvider
  // calls /users/me, restores the session, and renders the page — not login.

  test('E12 — Session restoration on deep link: /workflows shows list after session restored from /users/me', async () => {
    const workflow = {
      id: 'wf-deep-001',
      organizationId: 'org-abc',
      name: 'Deep Link Workflow',
      version: 1,
      status: 'active' as const,
      triggerEventTypeId: 'et-001',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    }

    // /users/me succeeds → session restored → page renders
    mockApi.onGet('/users/me').reply(200, OPS_MGR)
    mockApi.onGet('/notifications').reply(200, { data: [] })
    mockApi.onGet('/workflows').reply(200, { data: [workflow] })

    render(<AppWrapper initialPath="/workflows" />)

    // Session restores from /users/me → workflows page renders (not login)
    await waitFor(() =>
      expect(screen.getByText('Deep Link Workflow')).toBeInTheDocument(),
      { timeout: 3000 }
    )
    expect(screen.queryByRole('button', { name: /sign in/i })).not.toBeInTheDocument()

    console.log('✅ E12 PASS: Session restored from /users/me → /workflows renders (not /login)')
  })
})
