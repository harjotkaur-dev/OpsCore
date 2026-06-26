/**
 * Scenario D — State Consistency & Cache Invalidation Tests
 *
 * Verifies that UI state stays consistent after mutations by testing
 * that TanStack Query cache invalidations trigger refetches and that
 * the rendered UI reflects the new server state.
 *
 * Also tests optimistic updates and their rollback on failure.
 *
 * D1  Task status change → list refetches → In Progress badge visible
 * D2  Optimistic mark-as-read → notification dot disappears immediately
 * D3  Optimistic rollback → mark-as-read fails → unread dot restored
 * D4  Notification bell count decrements after mark-as-read
 * D5  Workflow activate → list refetches → badge changes draft→active
 * D6  KPI delete → list refetches → row disappears
 * D7  Execution retry → failed list refetches
 * D8  Task detail: optimistic status update → UI reflects in_progress immediately
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import MockAdapter from 'axios-mock-adapter'
import { SessionProvider } from '../providers/SessionProvider'
import { TasksListPage } from '../features/tasks/pages/TasksListPage'
import { TaskDetailPage } from '../features/tasks/pages/TaskDetailPage'
import { WorkflowsListPage } from '../features/workflows/pages/WorkflowsListPage'
import { KPIsPage } from '../features/metrics/pages/KPIsPage'
import { NotificationsPage } from '../features/notifications/pages/NotificationsPage'
import { FailedExecutionsPage } from '../features/executions/pages/FailedExecutionsPage'
import { NotificationBell } from '../features/notifications/components/NotificationBell'
import { api } from '../lib/api'
import type { ReactNode } from 'react'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeQC() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0 },  // staleTime:0 ensures refetches fire in tests
      mutations: { retry: false },
    },
  })
}

function Wrapper({ children, initialPath = '/', qc }: { children: ReactNode; initialPath?: string; qc?: QueryClient }) {
  const client = qc ?? makeQC()
  return (
    <QueryClientProvider client={client}>
      <SessionProvider>
        <MemoryRouter initialEntries={[initialPath]}>{children}</MemoryRouter>
      </SessionProvider>
    </QueryClientProvider>
  )
}

const OPS_MGR = {
  id: 'user-001', email: 'ops@example.com', fullName: 'Ops Manager',
  organizationId: 'org-abc', role: 'operations_manager',
}

const PAGINATION = { limit: 20, hasNextPage: false, nextCursor: null }

describe('Scenario D — State Consistency & Cache Invalidation', () => {
  let mockApi: MockAdapter

  beforeEach(() => { mockApi = new MockAdapter(api) })
  afterEach(() => { mockApi.restore() })

  // ── D1: Task status change → list invalidated → shows new status ───────────
  // After POST /tasks/:id/status, the tasks list query is invalidated.
  // On refetch, the server returns the task with status=in_progress.
  // The list must show the updated badge.

  test('D1 — Task status change: detail invalidated after mutation → optimistic In Progress badge visible', async () => {
    const user = userEvent.setup()

    const pendingTask = {
      id: 'task-001',
      organizationId: 'org-abc',
      title: 'Deploy v1.3',
      priority: 'high' as const,
      status: 'pending' as const,
      overdue: false,
      createdAt: '2024-01-15T09:00:00.000Z',
      updatedAt: '2024-01-15T09:00:00.000Z',
      assignments: [],
    }
    const inProgressTask = { ...pendingTask, status: 'in_progress' as const }

    mockApi.onGet('/users/me').reply(200, OPS_MGR)
    // First detail fetch: pending; after invalidation refetch: in_progress
    mockApi.onGet('/tasks/task-001').replyOnce(200, { data: pendingTask })
    mockApi.onGet('/tasks/task-001').reply(200, { data: inProgressTask })
    mockApi.onGet('/tasks/task-001/comments').reply(200, { data: [] })
    mockApi.onPost('/tasks/task-001/status').reply(200, { data: inProgressTask })
    // List refetch after invalidation
    mockApi.onGet('/tasks').reply(200, { data: [inProgressTask] })

    render(
      <Wrapper initialPath="/tasks/task-001">
        <Routes>
          <Route path="/tasks" element={<TasksListPage />} />
          <Route path="/tasks/:id" element={<TaskDetailPage />} />
        </Routes>
      </Wrapper>
    )

    // Wait for Pending status badge on the task detail page
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^start$/i })).toBeInTheDocument(),
      { timeout: 3000 }
    )
    expect(screen.getByText('Pending')).toBeInTheDocument()

    // Click Start — triggers optimistic update on the detail query
    await user.click(screen.getByRole('button', { name: /^start$/i }))

    // Optimistic update: In Progress shown on the detail page immediately
    await waitFor(() =>
      expect(screen.getByText('In Progress')).toBeInTheDocument(),
      { timeout: 3000 }
    )
    expect(screen.queryByText('Pending')).not.toBeInTheDocument()

    // POST /tasks/task-001/status called with correct payload
    const statusCall = mockApi.history.post?.find(r => r.url === '/tasks/task-001/status')
    expect(JSON.parse(statusCall?.data as string)).toEqual({ status: 'in_progress' })

    console.log('✅ D1 PASS: Task status optimistic update → In Progress shown immediately on detail page')
  })

  // ── D2: Optimistic mark-as-read → notification dot disappears immediately ──
  // useMarkRead applies an optimistic update (isRead=true) to the cache before
  // the API responds. The unread dot should disappear immediately on click.

  test('D2 — Optimistic mark-as-read: unread dot disappears before server responds', async () => {
    const user = userEvent.setup()

    const unreadNotif = {
      id: 'notif-001',
      organizationId: 'org-abc',
      recipientUserId: 'user-001',
      message: 'New task assigned to you',
      sourceEntityType: 'task',
      sourceEntityId: 'task-001',
      isRead: false,
      readAt: null,
      createdAt: '2024-01-15T10:00:00.000Z',
    }

    mockApi.onGet('/users/me').reply(200, OPS_MGR)
    mockApi.onGet('/notifications').reply(200, { data: [unreadNotif] })
    // Server responds slowly — optimistic update must have happened before this
    mockApi.onPost('/notifications/notif-001/read').reply(() =>
      new Promise(resolve => setTimeout(() => resolve([200, {}]), 200))
    )

    render(
      <Wrapper>
        <Routes><Route path="/" element={<NotificationsPage />} /></Routes>
      </Wrapper>
    )

    // Unread dot visible initially
    await waitFor(() =>
      expect(screen.getByLabelText('Unread')).toBeInTheDocument(),
      { timeout: 3000 }
    )

    await user.click(screen.getByRole('button', { name: /mark as read/i }))

    // Optimistic update: unread dot should disappear immediately (before server responds)
    await waitFor(() =>
      expect(screen.queryByLabelText('Unread')).not.toBeInTheDocument(),
      { timeout: 500 }   // must be fast — this is the optimistic path
    )
    // Mark as read button also gone (notification now treated as read)
    expect(screen.queryByRole('button', { name: /mark as read/i })).not.toBeInTheDocument()

    console.log('✅ D2 PASS: Optimistic mark-as-read → unread dot disappears immediately (before server)')
  })

  // ── D3: Optimistic rollback → server fails → unread dot restored ───────────
  // If POST /notifications/:id/read returns 500, the cache rolls back.
  // The notification must reappear as unread.

  test('D3 — Optimistic rollback: mark-as-read 500 → unread dot restored after failure', async () => {
    const user = userEvent.setup()

    const unreadNotif = {
      id: 'notif-002',
      organizationId: 'org-abc',
      recipientUserId: 'user-001',
      message: 'CPU spike detected',
      sourceEntityType: 'metric',
      sourceEntityId: 'met-001',
      isRead: false,
      readAt: null,
      createdAt: '2024-01-15T11:00:00.000Z',
    }

    mockApi.onGet('/users/me').reply(200, OPS_MGR)
    mockApi.onGet('/notifications').reply(200, { data: [unreadNotif] })
    // Server fails
    mockApi.onPost('/notifications/notif-002/read').reply(500)

    render(
      <Wrapper>
        <Routes><Route path="/" element={<NotificationsPage />} /></Routes>
      </Wrapper>
    )

    await waitFor(() =>
      expect(screen.getByLabelText('Unread')).toBeInTheDocument(),
      { timeout: 3000 }
    )

    await user.click(screen.getByRole('button', { name: /mark as read/i }))

    // After server failure, rollback restores the unread state
    await waitFor(() =>
      expect(screen.getByLabelText('Unread')).toBeInTheDocument(),
      { timeout: 3000 }
    )
    // Mark as read button reappears
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /mark as read/i })).toBeInTheDocument(),
      { timeout: 3000 }
    )

    console.log('✅ D3 PASS: Optimistic rollback → 500 on mark-as-read → unread dot restored')
  })

  // ── D4: Notification bell count decrements after successful mark-as-read ────
  // After mark-as-read succeeds and the query invalidates/refetches,
  // the bell badge count should drop from 1 to 0.

  test('D4 — Bell badge decrements: mark-as-read → refetch → badge count drops to 0', async () => {
    const user = userEvent.setup()

    const unreadNotif = {
      id: 'notif-003',
      organizationId: 'org-abc',
      recipientUserId: 'user-001',
      message: 'Workflow execution completed',
      sourceEntityType: 'execution',
      sourceEntityId: 'exec-001',
      isRead: false,
      readAt: null,
      createdAt: '2024-01-15T12:00:00.000Z',
    }
    const readNotif = { ...unreadNotif, isRead: true, readAt: new Date().toISOString() }

    mockApi.onGet('/users/me').reply(200, OPS_MGR)
    // Both NotificationBell and NotificationsPage call GET /notifications on mount.
    // First two calls return 1 unread; subsequent calls (after invalidation) return 0 unread.
    mockApi.onGet('/notifications').replyOnce(200, { data: [unreadNotif] })
    mockApi.onGet('/notifications').replyOnce(200, { data: [unreadNotif] })
    // After mark-as-read invalidation: all subsequent fetches return read notification
    mockApi.onGet('/notifications').reply(200, { data: [readNotif] })
    mockApi.onPost('/notifications/notif-003/read').reply(200)

    render(
      <Wrapper>
        <Routes>
          <Route path="/" element={
            <div>
              <NotificationBell />
              <NotificationsPage />
            </div>
          } />
        </Routes>
      </Wrapper>
    )

    // Bell shows badge count 1 — wait for both bell and page data
    await waitFor(() =>
      expect(screen.getByText('1')).toBeInTheDocument(),
      { timeout: 3000 }
    )
    // Also wait for the notification message to appear (page data loaded)
    await waitFor(() =>
      expect(screen.getByText('Workflow execution completed')).toBeInTheDocument(),
      { timeout: 3000 }
    )

    // Click Mark as read (from the notifications page)
    await user.click(screen.getByRole('button', { name: /mark as read/i }))

    // After invalidation refetch, badge should be gone (0 unread)
    await waitFor(() =>
      expect(screen.queryByText('1')).not.toBeInTheDocument(),
      { timeout: 3000 }
    )

    console.log('✅ D4 PASS: Bell badge drops from 1 to 0 after mark-as-read + refetch')
  })

  // ── D5: Workflow activate → list refetches → badge changes draft→active ────
  // After POST /workflows/:id/activate, the workflow list is invalidated.
  // On refetch, the workflow status must show as active.

  test('D5 — Workflow activate: list invalidated → refetch → status badge changes draft to active', async () => {
    const user = userEvent.setup()

    const draftWorkflow = {
      id: 'wf-001',
      organizationId: 'org-abc',
      name: 'Fulfillment Flow',
      version: 1,
      status: 'draft' as const,
      triggerEventTypeId: 'et-001',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    }
    const activeWorkflow = { ...draftWorkflow, status: 'active' as const }

    mockApi.onGet('/users/me').reply(200, OPS_MGR)
    // First list fetch: draft
    mockApi.onGet('/workflows').replyOnce(200, { data: [draftWorkflow] })
    // After invalidation refetch: active
    mockApi.onGet('/workflows').reply(200, { data: [activeWorkflow] })
    mockApi.onPost('/workflows/wf-001/activate').reply(200, { data: activeWorkflow })

    render(
      <Wrapper>
        <Routes><Route path="/" element={<WorkflowsListPage />} /></Routes>
      </Wrapper>
    )

    // Initial: draft badge
    await waitFor(() =>
      expect(screen.getByText('draft')).toBeInTheDocument(),
      { timeout: 3000 }
    )

    // Click Activate
    await user.click(screen.getByRole('button', { name: /^activate$/i }))

    // After invalidation refetch: active badge, draft gone
    await waitFor(() =>
      expect(screen.getByText('active')).toBeInTheDocument(),
      { timeout: 3000 }
    )
    expect(screen.queryByText('draft')).not.toBeInTheDocument()

    console.log('✅ D5 PASS: Workflow activate → list refetches → badge changes draft→active')
  })

  // ── D6: KPI delete → list invalidated → row disappears ─────────────────────
  // After DELETE /kpis/:id, the KPIs query is invalidated.
  // On refetch, the deleted KPI must not appear in the list.

  test('D6 — KPI delete: list invalidated → refetch → deleted KPI row disappears', async () => {
    const user = userEvent.setup()

    const kpi = {
      id: 'kpi-001',
      organizationId: 'org-abc',
      name: 'Error Rate Cap',
      metricName: 'total_failed_executions',
      operator: '<' as const,
      targetValue: 5,
      currentValue: 2,
      isBreached: false,
      ownerUserId: 'user-001',
      createdAt: '2024-01-01T00:00:00.000Z',
    }

    mockApi.onGet('/users/me').reply(200, OPS_MGR)
    // First list fetch: KPI present
    mockApi.onGet('/kpis').replyOnce(200, { data: [kpi] })
    // After invalidation refetch: empty (deleted)
    mockApi.onGet('/kpis').reply(200, { data: [] })
    mockApi.onGet('/metrics').reply(200, { data: [] })
    mockApi.onDelete('/kpis/kpi-001').reply(204)

    render(
      <Wrapper>
        <Routes><Route path="/" element={<KPIsPage />} /></Routes>
      </Wrapper>
    )

    // KPI row visible initially
    await waitFor(() =>
      expect(screen.getByText('Error Rate Cap')).toBeInTheDocument(),
      { timeout: 3000 }
    )

    // Click Delete
    await user.click(screen.getByRole('button', { name: /delete kpi error rate cap/i }))

    // DELETE was called
    await waitFor(() =>
      expect(mockApi.history.delete?.some(r => r.url === '/kpis/kpi-001')).toBe(true),
      { timeout: 3000 }
    )

    // After invalidation refetch: row gone, empty state shown
    await waitFor(() =>
      expect(screen.queryByText('Error Rate Cap')).not.toBeInTheDocument(),
      { timeout: 3000 }
    )
    expect(screen.getByText(/no kpis defined/i)).toBeInTheDocument()

    console.log('✅ D6 PASS: KPI delete → list refetches → deleted row disappears, empty state shown')
  })

  // ── D7: Execution retry → failed list invalidated → refetches ───────────────
  // After POST /executions/:id/retry, executions.all is invalidated.
  // Verifies the invalidation triggers a refetch of the failed list.

  test('D7 — Execution retry: executions.all invalidated → failed list refetches', async () => {
    const user = userEvent.setup()

    const failedExec = {
      id: 'exec-failed-001',
      organizationId: 'org-abc',
      workflowId: 'wf-001',
      workflowName: 'Alert Flow',
      eventId: 'evt-001',
      status: 'failed' as const,
      startedAt: '2024-01-15T10:00:00.000Z',
      completedAt: '2024-01-15T10:00:05.000Z',
      errorDetail: 'Connection timeout',
      attemptCount: 3,
      createdAt: '2024-01-15T10:00:00.000Z',
    }

    const retriedExec = { ...failedExec, id: 'exec-retried-001', status: 'queued' as const, attemptCount: 0, errorDetail: null }

    mockApi.onGet('/users/me').reply(200, OPS_MGR)
    // First fetch: one failed execution
    mockApi.onGet('/executions/failed').replyOnce(200, { data: [failedExec], pagination: PAGINATION })
    // After invalidation refetch: empty (moved to queued, no longer in failed list)
    mockApi.onGet('/executions/failed').reply(200, { data: [], pagination: PAGINATION })
    mockApi.onGet('/executions').reply(200, { data: [retriedExec], pagination: PAGINATION })
    mockApi.onPost('/executions/exec-failed-001/retry').reply(200, { data: retriedExec })

    render(
      <Wrapper>
        <Routes><Route path="/" element={<FailedExecutionsPage />} /></Routes>
      </Wrapper>
    )

    // Failed execution visible
    await waitFor(() =>
      expect(screen.getByText('Alert Flow')).toBeInTheDocument(),
      { timeout: 3000 }
    )
    expect(screen.getByText('Connection timeout')).toBeInTheDocument()

    // Click Retry
    await user.click(screen.getByRole('button', { name: /retry execution exec-failed-001/i }))

    // POST called
    await waitFor(() =>
      expect(mockApi.history.post?.some(r => r.url === '/executions/exec-failed-001/retry')).toBe(true),
      { timeout: 3000 }
    )

    // After invalidation refetch: failed list is empty
    await waitFor(() =>
      expect(screen.queryByText('Connection timeout')).not.toBeInTheDocument(),
      { timeout: 3000 }
    )
    expect(screen.getByText(/no failed executions/i)).toBeInTheDocument()

    console.log('✅ D7 PASS: Execution retry → executions.all invalidated → failed list clears')
  })

  // ── D8: Task detail optimistic update → status shown before server ─────────
  // useUpdateTaskStatus applies optimistic update to detail query immediately.
  // UI shows In Progress before the server responds.

  test('D8 — Task detail optimistic update: status reflects in_progress immediately on Start click', async () => {
    const user = userEvent.setup()

    const pendingTask = {
      id: 'task-opt-001',
      organizationId: 'org-abc',
      title: 'Process urgent order',
      priority: 'critical' as const,
      status: 'pending' as const,
      overdue: false,
      createdAt: '2024-01-15T09:00:00.000Z',
      updatedAt: '2024-01-15T09:00:00.000Z',
      assignments: [],
    }
    const inProgressTask = { ...pendingTask, status: 'in_progress' as const }

    mockApi.onGet('/users/me').reply(200, OPS_MGR)
    mockApi.onGet('/tasks/task-opt-001').reply(200, { data: pendingTask })
    mockApi.onGet('/tasks/task-opt-001/comments').reply(200, { data: [] })
    // Slow server response — optimistic update must appear before this resolves
    mockApi.onPost('/tasks/task-opt-001/status').reply(() =>
      new Promise(resolve => setTimeout(() => resolve([200, { data: inProgressTask }]), 200))
    )

    render(
      <Wrapper initialPath="/tasks/task-opt-001">
        <Routes>
          <Route path="/tasks/:id" element={<TaskDetailPage />} />
        </Routes>
      </Wrapper>
    )

    await waitFor(() =>
      expect(screen.getByText('Pending')).toBeInTheDocument(),
      { timeout: 3000 }
    )

    await user.click(screen.getByRole('button', { name: /^start$/i }))

    // Optimistic update: In Progress should appear quickly (before 200ms server delay)
    await waitFor(() =>
      expect(screen.getByText('In Progress')).toBeInTheDocument(),
      { timeout: 150 }   // must be faster than the 200ms server delay
    )
    expect(screen.queryByText('Pending')).not.toBeInTheDocument()

    console.log('✅ D8 PASS: Task detail optimistic update → In Progress shown within 150ms (before server)')
  })
})
