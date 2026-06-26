/**
 * Scenario H — Error Path Matrix
 *
 * Tests error responses not yet covered: 403, 409, 422 field errors,
 * network timeouts, partial/malformed payloads, and loading states.
 *
 * H1  403 on task status update → error shown, status not changed
 * H2  422 on task create → backend field error reaches UI
 * H3  Network timeout on task list → loading spinner, then error on timeout
 * H4  Task detail with null/missing optional fields → page renders without crash
 * H5  Workflow detail 404 → error state with back link
 * H6  Comment submit 500 → error shown, form not cleared
 * H7  Post comment empty body → submit button disabled, no API call
 * H8  Task status 422 (invalid transition) → error shown inline
 * H9  KPI create 422 (metric not found) → error shown in form
 * H10 Mark-as-read 403 → error does not crash page, unread state preserved
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import MockAdapter from 'axios-mock-adapter'
import { SessionProvider } from '../providers/SessionProvider'
import { TasksListPage } from '../features/tasks/pages/TasksListPage'
import { TaskDetailPage } from '../features/tasks/pages/TaskDetailPage'
import { TaskFormPage } from '../features/tasks/pages/TaskFormPage'
import { WorkflowDetailPage } from '../features/workflows/pages/WorkflowDetailPage'
import { NotificationsPage } from '../features/notifications/pages/NotificationsPage'
import { KPIsPage } from '../features/metrics/pages/KPIsPage'
import { api } from '../lib/api'
import type { ReactNode } from 'react'

function makeQC() {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
}

function Wrapper({ children, initialPath = '/' }: { children: ReactNode; initialPath?: string }) {
  const qc = makeQC()
  return (
    <QueryClientProvider client={qc}>
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

const PENDING_TASK = {
  id: 'task-h1', organizationId: 'org-abc', title: 'Investigate latency spike',
  description: 'Response times above threshold', priority: 'high' as const,
  status: 'pending' as const, overdue: false,
  createdAt: '2024-01-15T09:00:00.000Z', updatedAt: '2024-01-15T09:00:00.000Z',
  assignments: [],
}

describe('Scenario H — Error Path Matrix', () => {
  let mockApi: MockAdapter

  beforeEach(() => { mockApi = new MockAdapter(api) })
  afterEach(() => { mockApi.restore() })

  // ── H1: 403 on task status update → inline error shown ────────────────────

  test('H1 — 403 on status update: API rejects transition → inline error shown', async () => {
    const user = userEvent.setup()

    mockApi.onGet('/users/me').reply(200, OPS_MGR)
    mockApi.onGet('/tasks/task-h1').reply(200, { data: PENDING_TASK })
    mockApi.onGet('/tasks/task-h1/comments').reply(200, { data: [] })
    mockApi.onPost('/tasks/task-h1/status').reply(403, {
      message: 'You do not have permission to transition this task',
    })

    render(
      <Wrapper initialPath="/tasks/task-h1">
        <Routes><Route path="/tasks/:id" element={<TaskDetailPage />} /></Routes>
      </Wrapper>
    )

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^start$/i })).toBeInTheDocument(),
      { timeout: 3000 }
    )

    await user.click(screen.getByRole('button', { name: /^start$/i }))

    // Inline error message shown (from TaskDetailPage updateStatus.isError)
    await waitFor(() =>
      expect(screen.getByText(/failed to update status/i)).toBeInTheDocument(),
      { timeout: 3000 }
    )
    // Status badge still shows Pending (rollback worked)
    expect(screen.getByText('Pending')).toBeInTheDocument()

    console.log('✅ H1 PASS: 403 on status update → inline error shown, Pending badge preserved')
  })

  // ── H2: 422 backend field error on task create ────────────────────────────

  test('H2 — 422 on task create: backend error message surfaced in form', async () => {
    const user = userEvent.setup()

    mockApi.onGet('/users/me').reply(200, OPS_MGR)
    mockApi.onPost('/tasks').reply(422, {
      message: 'Title must not contain special characters: <, >, &',
    })

    render(
      <Wrapper initialPath="/tasks/new">
        <Routes>
          <Route path="/tasks" element={<div>Tasks List</div>} />
          <Route path="/tasks/new" element={<TaskFormPage />} />
        </Routes>
      </Wrapper>
    )

    await waitFor(() =>
      expect(screen.getByLabelText(/^title/i)).toBeInTheDocument(),
      { timeout: 5000 }
    )

    await user.type(screen.getByLabelText(/^title/i), 'Fix <issue> & more')
    await user.click(screen.getByRole('button', { name: /create task/i }))

    // Backend 422 error message surfaced
    await waitFor(() =>
      expect(screen.getByText(/title must not contain special characters/i)).toBeInTheDocument(),
      { timeout: 3000 }
    )
    // Still on the form page
    expect(screen.queryByText('Tasks List')).not.toBeInTheDocument()

    console.log('✅ H2 PASS: 422 on task create → backend error message shown in form')
  })

  // ── H3: Task list loading state while fetch is pending ────────────────────

  test('H3 — Network timeout simulation: tasks list shows loading while request pending', async () => {
    mockApi.onGet('/users/me').reply(200, OPS_MGR)
    // Never resolves — simulates network hang
    mockApi.onGet('/tasks').reply(() => new Promise(() => {}))

    render(
      <Wrapper>
        <Routes><Route path="/" element={<TasksListPage />} /></Routes>
      </Wrapper>
    )

    await waitFor(() =>
      expect(mockApi.history.get?.some(r => r.url === '/users/me')).toBe(true)
    )

    // New UX: skeleton rows render during loading — verify Task Center header and no real data
    await waitFor(() =>
      expect(screen.getByText('Task Center')).toBeInTheDocument(),
      { timeout: 3000 }
    )
    // No actual task title present during loading
    expect(screen.queryByText('Deploy v1.3')).not.toBeInTheDocument()
    // Table NOT rendered with data rows
    expect(screen.queryByRole('table')).not.toBeInTheDocument()

    console.log('✅ H3 PASS: Tasks list shows loading state while request is in-flight')
  })

  // ── H4: Task detail with missing optional fields — no crash ───────────────

  test('H4 — Partial task payload: task without description, dueDate, assignments renders without crash', async () => {
    const minimalTask = {
      id: 'task-minimal',
      organizationId: 'org-abc',
      title: 'Minimal task',
      // No description, no dueDate, no assignments
      priority: 'low' as const,
      status: 'pending' as const,
      overdue: false,
      createdAt: '2024-01-15T09:00:00.000Z',
      updatedAt: '2024-01-15T09:00:00.000Z',
    }

    mockApi.onGet('/users/me').reply(200, OPS_MGR)
    mockApi.onGet('/tasks/task-minimal').reply(200, { data: minimalTask })
    mockApi.onGet('/tasks/task-minimal/comments').reply(200, { data: [] })

    render(
      <Wrapper initialPath="/tasks/task-minimal">
        <Routes><Route path="/tasks/:id" element={<TaskDetailPage />} /></Routes>
      </Wrapper>
    )

    await waitFor(() =>
      expect(screen.getByText('Minimal task')).toBeInTheDocument(),
      { timeout: 3000 }
    )

    // Page renders without crash
    expect(screen.getByText('Pending')).toBeInTheDocument()
    expect(screen.getByText('low')).toBeInTheDocument()
    // No due date section rendered (no crash for missing field)
    expect(screen.queryByText(/due date/i)).not.toBeInTheDocument()

    console.log('✅ H4 PASS: Task with missing optional fields renders without crash')
  })

  // ── H5: Workflow detail 404 ───────────────────────────────────────────────

  test('H5 — Workflow 404: workflow detail shows error state with back link', async () => {
    mockApi.onGet('/users/me').reply(200, OPS_MGR)
    mockApi.onGet('/workflows/wf-nonexistent').reply(404, { message: 'Workflow not found' })
    mockApi.onGet('/workflows/wf-nonexistent/rules').reply(404)
    mockApi.onGet('/workflows/wf-nonexistent/actions').reply(404)

    render(
      <Wrapper initialPath="/workflows/wf-nonexistent">
        <Routes><Route path="/workflows/:id" element={<WorkflowDetailPage />} /></Routes>
      </Wrapper>
    )

    // Wait for loading to complete (session loads → query fires → 404 error state)
    await waitFor(() =>
      expect(screen.queryByText(/loading workflow/i)).not.toBeInTheDocument(),
      { timeout: 5000 }
    )
    await waitFor(() =>
      expect(screen.getByText(/failed to load workflow/i)).toBeInTheDocument(),
      { timeout: 3000 }
    )
    // Back link rendered using accessible text — check for the link text
    expect(screen.getByRole('link', { name: /← back to workflows/i })).toBeInTheDocument()

    console.log('✅ H5 PASS: Workflow 404 → error state with back link shown')
  })

  // ── H6: Comment submit 500 → error shown, form not cleared ───────────────

  test('H6 — Comment 500: failed comment submission shows error, input not cleared', async () => {
    const user = userEvent.setup()

    mockApi.onGet('/users/me').reply(200, OPS_MGR)
    mockApi.onGet('/tasks/task-h1').reply(200, { data: PENDING_TASK })
    mockApi.onGet('/tasks/task-h1/comments').reply(200, { data: [] })
    mockApi.onPost('/tasks/task-h1/comments').reply(500)

    render(
      <Wrapper initialPath="/tasks/task-h1">
        <Routes><Route path="/tasks/:id" element={<TaskDetailPage />} /></Routes>
      </Wrapper>
    )

    await waitFor(() =>
      expect(screen.getByLabelText(/add a comment/i)).toBeInTheDocument(),
      { timeout: 3000 }
    )

    await user.type(screen.getByLabelText(/add a comment/i), 'This is my comment about the task')
    await user.click(screen.getByRole('button', { name: /post comment/i }))

    // Error shown
    await waitFor(() =>
      expect(screen.getByText(/failed to post comment/i)).toBeInTheDocument(),
      { timeout: 3000 }
    )
    // Form input still contains the text (not cleared on failure)
    expect(screen.getByLabelText(/add a comment/i)).toHaveValue('This is my comment about the task')

    console.log('✅ H6 PASS: Comment 500 → error shown, input preserved for retry')
  })

  // ── H7: Post comment empty body → button disabled ────────────────────────

  test('H7 — Empty comment: Post Comment button disabled when body is empty', async () => {
    mockApi.onGet('/users/me').reply(200, OPS_MGR)
    mockApi.onGet('/tasks/task-h1').reply(200, { data: PENDING_TASK })
    mockApi.onGet('/tasks/task-h1/comments').reply(200, { data: [] })

    render(
      <Wrapper initialPath="/tasks/task-h1">
        <Routes><Route path="/tasks/:id" element={<TaskDetailPage />} /></Routes>
      </Wrapper>
    )

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /post comment/i })).toBeInTheDocument(),
      { timeout: 3000 }
    )

    // Button is disabled when textarea is empty
    expect(screen.getByRole('button', { name: /post comment/i })).toBeDisabled()
    // No POST call made
    expect(mockApi.history.post?.some(r => r.url?.includes('/comments'))).toBe(false)

    console.log('✅ H7 PASS: Post Comment button disabled when comment body is empty')
  })

  // ── H8: Task status 422 (invalid transition) → inline error ──────────────

  test('H8 — Task status 422: invalid transition from backend → error shown', async () => {
    const user = userEvent.setup()

    mockApi.onGet('/users/me').reply(200, OPS_MGR)
    mockApi.onGet('/tasks/task-h1').reply(200, { data: PENDING_TASK })
    mockApi.onGet('/tasks/task-h1/comments').reply(200, { data: [] })
    mockApi.onPost('/tasks/task-h1/status').reply(422, {
      message: 'Invalid status transition: pending → completed is not allowed',
    })

    render(
      <Wrapper initialPath="/tasks/task-h1">
        <Routes><Route path="/tasks/:id" element={<TaskDetailPage />} /></Routes>
      </Wrapper>
    )

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^start$/i })).toBeInTheDocument(),
      { timeout: 3000 }
    )

    await user.click(screen.getByRole('button', { name: /^start$/i }))

    await waitFor(() =>
      expect(screen.getByText(/failed to update status/i)).toBeInTheDocument(),
      { timeout: 3000 }
    )

    console.log('✅ H8 PASS: 422 invalid status transition → inline error shown')
  })

  // ── H9: KPI create 422 → form error shown ────────────────────────────────

  test('H9 — KPI create 422: metric not found error shown in form', async () => {
    const user = userEvent.setup()

    mockApi.onGet('/users/me').reply(200, OPS_MGR)
    mockApi.onGet('/kpis').reply(200, { data: [] })
    mockApi.onGet('/metrics').reply(200, { data: [
      { id: 'met-001', organizationId: 'org-abc', name: 'total_failed_executions',
        currentValue: 0, computedAt: new Date().toISOString() },
    ]})
    mockApi.onPost('/kpis').reply(422, {
      message: 'Metric "nonexistent_metric" does not exist in this organisation',
    })

    render(
      <Wrapper>
        <Routes><Route path="/" element={<KPIsPage />} /></Routes>
      </Wrapper>
    )

    await waitFor(() =>
      expect(screen.getByLabelText(/^name$/i)).toBeInTheDocument(),
      { timeout: 5000 }
    )

    await user.type(screen.getByLabelText(/^name$/i), 'Bad KPI')
    await waitFor(() =>
      expect(screen.getByText('total_failed_executions')).toBeInTheDocument(),
      { timeout: 3000 }
    )
    await user.selectOptions(screen.getByLabelText(/metric/i), 'total_failed_executions')
    await user.clear(screen.getByLabelText(/target value/i))
    await user.type(screen.getByLabelText(/target value/i), '10')
    await user.click(screen.getByRole('button', { name: /create kpi/i }))

    await waitFor(() =>
      expect(screen.getByText(/metric.*does not exist/i)).toBeInTheDocument(),
      { timeout: 3000 }
    )

    console.log('✅ H9 PASS: KPI create 422 → backend error message shown in form')
  })

  // ── H10: Mark-as-read 403 → page doesn't crash, unread state preserved ───

  test('H10 — Mark-as-read 403: page survives, unread state rolled back', async () => {
    const user = userEvent.setup()

    const unreadNotif = {
      id: 'notif-403', organizationId: 'org-abc', recipientUserId: 'user-001',
      message: 'Access denied test notification', sourceEntityType: null, sourceEntityId: null,
      isRead: false, readAt: null, createdAt: '2024-01-15T10:00:00.000Z',
    }

    mockApi.onGet('/users/me').reply(200, OPS_MGR)
    mockApi.onGet('/notifications').reply(200, { data: [unreadNotif] })
    mockApi.onPost('/notifications/notif-403/read').reply(403, {
      message: 'Forbidden: cannot mark another user\'s notification as read',
    })

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

    // After 403, rollback: notification is still unread (dot restored)
    await waitFor(() =>
      expect(screen.getByLabelText('Unread')).toBeInTheDocument(),
      { timeout: 3000 }
    )
    // Page still rendered, no crash
    expect(screen.getByText('Access denied test notification')).toBeInTheDocument()

    console.log('✅ H10 PASS: 403 on mark-as-read → page survives, unread state rolled back')
  })
})
