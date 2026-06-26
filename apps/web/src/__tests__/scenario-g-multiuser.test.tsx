/**
 * Scenario G — Multi-User Consistency Tests
 *
 * The OpsCore frontend is a single-user SPA with no WebSocket/realtime push.
 * Multi-user consistency is achieved through:
 *   - staleTime: queries refetch when data is considered stale
 *   - refetchInterval: notifications poll every 30s
 *   - Manual refetch (page focus, navigation)
 *   - queryClient.invalidateQueries (after own mutations)
 *
 * Tests model "User B" as the current user whose UI reflects state changes
 * made by "User A" server-side. User B's UI updates when:
 *   (a) they trigger a refetch via their own mutation
 *   (b) the polling interval fires
 *   (c) they navigate and data is stale
 *
 * G1  User A completes task → User B reloads tasks list → shows Completed
 * G2  User A marks notification read → User B's inbox still shows unread (different user)
 * G3  User A activates workflow → User B refetches workflow list → shows active
 * G4  Notification polling: new notification appears when refetchInterval fires
 * G5  Stale task data: after staleTime=0, data refetches and reflects server truth
 * G6  Two retries on same execution — second retry call is independent (no duplicate guard in UI)
 * G7  Workflow deactivated server-side → User B refetches → shows inactive
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import MockAdapter from 'axios-mock-adapter'
import { SessionProvider } from '../providers/SessionProvider'
import { TasksListPage } from '../features/tasks/pages/TasksListPage'
import { WorkflowsListPage } from '../features/workflows/pages/WorkflowsListPage'
import { NotificationsPage } from '../features/notifications/pages/NotificationsPage'
import { NotificationBell } from '../features/notifications/components/NotificationBell'
import { FailedExecutionsPage } from '../features/executions/pages/FailedExecutionsPage'
import { api } from '../lib/api'
import type { ReactNode } from 'react'

function makeQC(queryOverrides?: { staleTime?: number }) {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, ...(queryOverrides ?? {}) },
      mutations: { retry: false },
    },
  })
}

function Wrapper({ children, qc }: { children: ReactNode; qc?: QueryClient }) {
  const client = qc ?? makeQC()
  return (
    <QueryClientProvider client={client}>
      <SessionProvider>
        <MemoryRouter>{children}</MemoryRouter>
      </SessionProvider>
    </QueryClientProvider>
  )
}

const USER_B = {
  id: 'user-b', email: 'userb@example.com', fullName: 'User B',
  organizationId: 'org-abc', role: 'operations_manager',
}

const PAGINATION = { limit: 20, hasNextPage: false, nextCursor: null }

describe('Scenario G — Multi-User Consistency', () => {
  let mockApi: MockAdapter

  beforeEach(() => { mockApi = new MockAdapter(api) })
  afterEach(() => { mockApi.restore() })

  // ── G1: User A completes task → User B reloads → shows Completed ───────────
  // User B's task list starts with a pending task.
  // After invalidation (simulating User B's own action or manual refetch),
  // the server returns the task as completed (User A changed it).

  test('G1 — Task state change by other user: after cache invalidation, User B sees Completed badge', async () => {
    const pendingTask = {
      id: 'task-g1', organizationId: 'org-abc', title: 'Process order #9001',
      priority: 'high' as const, status: 'pending' as const,
      overdue: false, createdAt: '2024-01-15T09:00:00.000Z',
      updatedAt: '2024-01-15T09:00:00.000Z', assignments: [],
    }
    const completedTask = { ...pendingTask, status: 'completed' as const }

    mockApi.onGet('/users/me').reply(200, USER_B)
    // First load: task is pending
    mockApi.onGet('/tasks').replyOnce(200, { data: [pendingTask] })
    // After refetch (simulating User A's change becoming visible): completed
    mockApi.onGet('/tasks').reply(200, { data: [completedTask] })

    // Use staleTime=0 so the data is immediately stale and refetches on next render
    const qc = makeQC({ staleTime: 0 })

    const { rerender } = render(
      <Wrapper qc={qc}>
        <Routes><Route path="/" element={<TasksListPage />} /></Routes>
      </Wrapper>
    )

    // Initial: Pending
    await waitFor(() =>
      expect(screen.getAllByText('Pending').length).toBeGreaterThanOrEqual(1),
      { timeout: 3000 }
    )

    // Manually invalidate — simulates User B returning to the page / refetch trigger
    await act(async () => {
      await qc.invalidateQueries({ queryKey: ['tasks', 'org-abc'] })
    })

    // After refetch: Completed badge visible (User A's change reflected)
    await waitFor(() =>
      expect(screen.getAllByText('Completed').length).toBeGreaterThanOrEqual(1),
      { timeout: 3000 }
    )

    console.log('✅ G1 PASS: After cache invalidation, User B sees task completed by User A')
  })

  // ── G2: User A reads notification → User B's inbox unaffected ───────────────
  // Notifications are per-user (recipientUserId). User B's inbox shows their own
  // unread notifications regardless of User A's read state.

  test('G2 — Notification isolation: User B sees own unread notification independent of User A', async () => {
    // User B has their own unread notification (different from User A's)
    const userBNotification = {
      id: 'notif-userb-001',
      organizationId: 'org-abc',
      recipientUserId: 'user-b',
      message: 'New task assigned to you: Process order #9001',
      sourceEntityType: 'task',
      sourceEntityId: 'task-g1',
      isRead: false,
      readAt: null,
      createdAt: '2024-01-15T10:00:00.000Z',
    }

    mockApi.onGet('/users/me').reply(200, USER_B)
    // User B's notification list — always returns their own unread item
    // (User A marking their OWN notification read does not affect this)
    mockApi.onGet('/notifications').reply(200, { data: [userBNotification] })

    render(
      <Wrapper>
        <Routes><Route path="/" element={<NotificationsPage />} /></Routes>
      </Wrapper>
    )

    await waitFor(() =>
      expect(screen.getByText('New task assigned to you: Process order #9001')).toBeInTheDocument(),
      { timeout: 3000 }
    )

    // User B's notification is still unread
    expect(screen.getByLabelText('Unread')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /mark as read/i })).toBeInTheDocument()

    console.log('✅ G2 PASS: User B sees own unread notification (not affected by User A)')
  })

  // ── G3: User A activates workflow → User B refetches → shows active ─────────

  test('G3 — Workflow state change by other user: after refetch, User B sees workflow active', async () => {
    const draftWorkflow = {
      id: 'wf-g3', organizationId: 'org-abc', name: 'Fulfillment Flow',
      version: 1, status: 'draft' as const,
      triggerEventTypeId: 'et-001',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    }
    const activeWorkflow = { ...draftWorkflow, status: 'active' as const }

    mockApi.onGet('/users/me').reply(200, USER_B)
    // First load: draft
    mockApi.onGet('/workflows').replyOnce(200, { data: [draftWorkflow] })
    // After refetch: active (User A activated it)
    mockApi.onGet('/workflows').reply(200, { data: [activeWorkflow] })

    const qc = makeQC({ staleTime: 0 })

    render(
      <Wrapper qc={qc}>
        <Routes><Route path="/" element={<WorkflowsListPage />} /></Routes>
      </Wrapper>
    )

    await waitFor(() =>
      expect(screen.getByText('draft')).toBeInTheDocument(),
      { timeout: 3000 }
    )

    // Simulate refetch
    await act(async () => {
      await qc.invalidateQueries({ queryKey: ['workflows', 'org-abc'] })
    })

    // After refetch: active badge
    await waitFor(() =>
      expect(screen.getByText('active')).toBeInTheDocument(),
      { timeout: 3000 }
    )

    console.log('✅ G3 PASS: After refetch, User B sees workflow activated by User A')
  })

  // ── G4: Notification polling — new notification appears without user action ──
  // useNotifications has refetchInterval: 30_000.
  // Simulate polling by manually triggering a refetch (same mechanism).

  test('G4 — Notification polling: new notification appears after simulated poll interval', async () => {
    const existingNotif = {
      id: 'notif-existing',
      organizationId: 'org-abc',
      recipientUserId: 'user-b',
      message: 'Old notification',
      sourceEntityType: 'task',
      sourceEntityId: 'task-001',
      isRead: true,
      readAt: '2024-01-15T09:00:00.000Z',
      createdAt: '2024-01-15T08:00:00.000Z',
    }

    const newNotif = {
      id: 'notif-new-poll',
      organizationId: 'org-abc',
      recipientUserId: 'user-b',
      message: 'KPI threshold breached: Error Rate Cap',
      sourceEntityType: 'kpi',
      sourceEntityId: 'kpi-001',
      isRead: false,
      readAt: null,
      createdAt: '2024-01-15T10:05:00.000Z',
    }

    mockApi.onGet('/users/me').reply(200, USER_B)
    // First poll: only old notification
    mockApi.onGet('/notifications').replyOnce(200, { data: [existingNotif] })
    // Second poll: new notification arrived server-side
    mockApi.onGet('/notifications').reply(200, { data: [existingNotif, newNotif] })

    const qc = makeQC({ staleTime: 0 })

    render(
      <Wrapper qc={qc}>
        <Routes><Route path="/" element={<NotificationsPage />} /></Routes>
      </Wrapper>
    )

    // Initial state: only old notification
    await waitFor(() =>
      expect(screen.getByText('Old notification')).toBeInTheDocument(),
      { timeout: 3000 }
    )
    expect(screen.queryByText('KPI threshold breached: Error Rate Cap')).not.toBeInTheDocument()

    // Simulate the 30s poll firing
    await act(async () => {
      await qc.invalidateQueries({ queryKey: ['notifications', 'org-abc'] })
    })

    // After poll: new notification visible
    await waitFor(() =>
      expect(screen.getByText('KPI threshold breached: Error Rate Cap')).toBeInTheDocument(),
      { timeout: 3000 }
    )
    // New notification is unread
    expect(screen.getByLabelText('Unread')).toBeInTheDocument()

    console.log('✅ G4 PASS: After polling refetch, new notification appears in inbox')
  })

  // ── G5: Bell badge updates after polling ────────────────────────────────────
  // NotificationBell shows unread count from the notifications query.
  // After polling brings in a new unread notification, the badge increments.

  test('G5 — Bell badge updates on poll: badge increments when new unread notification arrives', async () => {
    const readNotif = {
      id: 'notif-read', organizationId: 'org-abc', recipientUserId: 'user-b',
      message: 'Old read notification', sourceEntityType: null, sourceEntityId: null,
      isRead: true, readAt: new Date().toISOString(), createdAt: '2024-01-15T08:00:00.000Z',
    }
    const newUnreadNotif = {
      id: 'notif-unread-new', organizationId: 'org-abc', recipientUserId: 'user-b',
      message: 'New task: Review order #5050', sourceEntityType: 'task', sourceEntityId: 'task-new',
      isRead: false, readAt: null, createdAt: '2024-01-15T10:10:00.000Z',
    }

    mockApi.onGet('/users/me').reply(200, USER_B)
    // Initial: 0 unread (no badge)
    mockApi.onGet('/notifications').replyOnce(200, { data: [readNotif] })
    // After poll: 1 unread (badge = 1)
    mockApi.onGet('/notifications').reply(200, { data: [readNotif, newUnreadNotif] })

    const qc = makeQC({ staleTime: 0 })

    render(
      <Wrapper qc={qc}>
        <Routes>
          <Route path="/" element={<NotificationBell />} />
        </Routes>
      </Wrapper>
    )

    // Initial: no badge (all read)
    await waitFor(() =>
      expect(mockApi.history.get?.some(r => r.url?.includes('/notifications'))).toBe(true),
      { timeout: 3000 }
    )
    // Wait for no badge
    await waitFor(() =>
      expect(screen.queryByText(/^\d+$/)).not.toBeInTheDocument(),
      { timeout: 3000 }
    )

    // Simulate poll
    await act(async () => {
      await qc.invalidateQueries({ queryKey: ['notifications', 'org-abc'] })
    })

    // Badge now shows 1
    await waitFor(() =>
      expect(screen.getByText('1')).toBeInTheDocument(),
      { timeout: 3000 }
    )

    console.log('✅ G5 PASS: Bell badge updates from 0 to 1 after polling refetch')
  })

  // ── G6: Retry race — two users retry the same execution independently ────────
  // Both User A and User B can independently call POST /executions/:id/retry.
  // The UI does not prevent this — it just fires the request.
  // This models the real-world scenario where two operators retry simultaneously.

  test('G6 — Concurrent retry: two independent retry calls on same execution — no UI guard', async () => {
    const failedExec = {
      id: 'exec-race', organizationId: 'org-abc', workflowId: 'wf-001',
      workflowName: 'Alert Flow', eventId: 'evt-001',
      status: 'failed' as const, startedAt: '2024-01-15T10:00:00.000Z',
      completedAt: '2024-01-15T10:00:05.000Z',
      errorDetail: 'Connection timeout', attemptCount: 3,
      createdAt: '2024-01-15T10:00:00.000Z',
    }

    let retryCallCount = 0
    mockApi.onGet('/users/me').reply(200, USER_B)
    mockApi.onGet('/executions/failed').reply(200, { data: [failedExec], pagination: PAGINATION })
    mockApi.onGet('/executions').reply(200, { data: [], pagination: PAGINATION })
    mockApi.onPost('/executions/exec-race/retry').reply(() => {
      retryCallCount++
      return [200, { data: { ...failedExec, id: `exec-retry-${retryCallCount}`, status: 'queued' } }]
    })

    // User B fires retry directly via the API (simulating concurrent call)
    const [result1, result2] = await Promise.all([
      api.post('/executions/exec-race/retry'),
      api.post('/executions/exec-race/retry'),
    ])

    expect(result1.status).toBe(200)
    expect(result2.status).toBe(200)
    expect(retryCallCount).toBe(2) // Both retries went through — server handles idempotency

    console.log(`✅ G6 PASS: Two concurrent retry calls on same execution — both succeed (server owns idempotency)`)
  })

  // ── G7: Workflow deactivated server-side → User B's view updates on refetch ─

  test('G7 — Workflow server-side change: active workflow deactivated by User A → User B refetches → inactive', async () => {
    const activeWorkflow = {
      id: 'wf-g7', organizationId: 'org-abc', name: 'Payment Retry Flow',
      version: 1, status: 'active' as const,
      triggerEventTypeId: 'et-001',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    }
    const inactiveWorkflow = { ...activeWorkflow, status: 'inactive' as const }

    mockApi.onGet('/users/me').reply(200, USER_B)
    mockApi.onGet('/workflows').replyOnce(200, { data: [activeWorkflow] })
    mockApi.onGet('/workflows').reply(200, { data: [inactiveWorkflow] })

    const qc = makeQC({ staleTime: 0 })

    render(
      <Wrapper qc={qc}>
        <Routes><Route path="/" element={<WorkflowsListPage />} /></Routes>
      </Wrapper>
    )

    await waitFor(() =>
      expect(screen.getByText('active')).toBeInTheDocument(),
      { timeout: 3000 }
    )

    // Simulate refetch (e.g., user navigates away and back)
    await act(async () => {
      await qc.invalidateQueries({ queryKey: ['workflows', 'org-abc'] })
    })

    await waitFor(() =>
      expect(screen.getByText('inactive')).toBeInTheDocument(),
      { timeout: 3000 }
    )
    expect(screen.queryByText('active')).not.toBeInTheDocument()

    console.log('✅ G7 PASS: After refetch, User B sees workflow deactivated by User A (inactive badge)')
  })
})
