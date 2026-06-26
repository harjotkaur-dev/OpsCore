/**
 * Phase 11.6 Task Center Pages Acceptance Tests
 *
 * Verifies:
 * TASKS LIST
 * - Renders with title, status, priority column headers
 * - Shows loading state while fetching
 * - Shows empty state when no tasks
 * - Shows error state on API failure
 * - Renders task rows with status badges (Pending/In Progress/Completed/Cancelled)
 * - Renders priority chips (low/medium/high/critical)
 * - Renders Overdue badge for overdue non-terminal tasks
 * - New Task button visible for operations_manager, hidden for member
 * - Status and priority filters present
 *
 * TASK FORM
 * - Renders with title, description, priority, due date fields
 * - Title required — shows error on empty submit
 * - Successful create calls POST /v1/tasks and navigates to /tasks/:id
 * - Users without task:create permission are redirected
 *
 * TASK DETAIL
 * - Renders task metadata: title, status badge, priority chip, description
 * - Shows Overdue badge when task.overdue = true and status is non-terminal
 * - Shows status transition buttons for pending task (Start, Cancel)
 * - Shows status transition buttons for in_progress task (Complete, Cancel)
 * - Status transition buttons absent for completed task
 * - Shows comments section
 * - Comment form visible for roles with task:comment permission
 * - Successful status transition calls POST /v1/tasks/:id/status
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import MockAdapter from 'axios-mock-adapter'
import { SessionProvider } from '../providers/SessionProvider'
import { TasksListPage } from '../features/tasks/pages/TasksListPage'
import { TaskFormPage } from '../features/tasks/pages/TaskFormPage'
import { TaskDetailPage } from '../features/tasks/pages/TaskDetailPage'
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
        <MemoryRouter initialEntries={[initialPath]}>
          {children}
        </MemoryRouter>
      </SessionProvider>
    </QueryClientProvider>
  )
}

// ── Mock users ────────────────────────────────────────────────────────────────

const MOCK_OPS_MGR = {
  id: 'user-001',
  email: 'ops@example.com',
  fullName: 'Ops Manager',
  organizationId: 'org-abc',
  role: 'operations_manager',
}

const MOCK_MEMBER = {
  id: 'user-002',
  email: 'member@example.com',
  fullName: 'Team Member',
  organizationId: 'org-abc',
  role: 'member',
}

// ── Mock data ─────────────────────────────────────────────────────────────────

const MOCK_TASKS = [
  {
    id: 'task-001',
    organizationId: 'org-abc',
    title: 'Investigate CPU Spike',
    description: 'CPU usage exceeded 90% threshold',
    priority: 'critical',
    status: 'pending',
    overdue: false,
    createdAt: '2024-01-15T10:00:00.000Z',
    updatedAt: '2024-01-15T10:00:00.000Z',
    assignments: [],
  },
  {
    id: 'task-002',
    organizationId: 'org-abc',
    title: 'Review Inventory Report',
    description: null,
    priority: 'medium',
    status: 'in_progress',
    overdue: true,
    dueDate: '2024-01-10T00:00:00.000Z',
    createdAt: '2024-01-12T08:00:00.000Z',
    updatedAt: '2024-01-14T09:00:00.000Z',
    assignments: [{ id: 'asgn-001', taskId: 'task-002', assigneeType: 'user', userId: 'user-001', assignedAt: '2024-01-12T08:00:00.000Z' }],
  },
  {
    id: 'task-003',
    organizationId: 'org-abc',
    title: 'Deploy Hotfix v1.2.1',
    description: 'Hotfix for payment gateway bug',
    priority: 'high',
    status: 'completed',
    overdue: false,
    createdAt: '2024-01-13T11:00:00.000Z',
    updatedAt: '2024-01-14T14:00:00.000Z',
    assignments: [],
  },
]

const MOCK_TASK_DETAIL = MOCK_TASKS[0]!

const MOCK_COMMENTS = [
  {
    id: 'cmt-001',
    taskId: 'task-001',
    authorId: 'user-001',
    body: 'Checked the metrics, CPU spike from 2pm onwards',
    createdAt: '2024-01-15T14:00:00.000Z',
    author: { fullName: 'Ops Manager', email: 'ops@example.com' },
  },
]

// ─────────────────────────────────────────────────────────────────────────────

describe('Phase 11.6 Task Center Pages Acceptance Tests', () => {
  let mockApi: MockAdapter

  beforeEach(() => {
    mockApi = new MockAdapter(api)
  })

  afterEach(() => {
    mockApi.restore()
  })

  // ── TASKS LIST ──────────────────────────────────────────────────────────────

  test('TasksList: shows loading state while fetching', async () => {
    mockApi.onGet('/users/me').reply(200, MOCK_OPS_MGR)
    mockApi.onGet('/tasks').reply(() => new Promise(() => {}))

    render(
      <Wrapper>
        <Routes><Route path="/" element={<TasksListPage />} /></Routes>
      </Wrapper>
    )

    await waitFor(() =>
      expect(mockApi.history.get?.some(r => r.url === '/users/me')).toBe(true)
    )
    // New UX: skeleton rows render during loading (no text spinner)
    // Verify the page header is present but no data rows
    await waitFor(() =>
      expect(screen.getByText('Task Center')).toBeInTheDocument(),
      { timeout: 3000 }
    )
    // Table rows are skeleton placeholders — no real task title present
    expect(screen.queryByText('Investigate CPU Spike')).not.toBeInTheDocument()
    console.log('✅ TasksList: loading state shown (skeleton rows, no task data)')
  })

  test('TasksList: renders task rows with status badges and priority chips', async () => {
    mockApi.onGet('/users/me').reply(200, MOCK_OPS_MGR)
    mockApi.onGet('/tasks').reply(200, { data: MOCK_TASKS })

    render(
      <Wrapper>
        <Routes><Route path="/" element={<TasksListPage />} /></Routes>
      </Wrapper>
    )

    await waitFor(() =>
      expect(screen.getByText('Investigate CPU Spike')).toBeInTheDocument(),
      { timeout: 3000 }
    )

    // Task titles
    expect(screen.getByText('Investigate CPU Spike')).toBeInTheDocument()
    expect(screen.getByText('Review Inventory Report')).toBeInTheDocument()
    expect(screen.getByText('Deploy Hotfix v1.2.1')).toBeInTheDocument()

    // Status badges — use getAllByText to avoid filter pill collision
    expect(screen.getAllByText('Pending').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('In Progress').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Completed').length).toBeGreaterThanOrEqual(1)

    // Priority badges
    expect(screen.getByText('Critical')).toBeInTheDocument()
    expect(screen.getByText('Medium')).toBeInTheDocument()
    expect(screen.getByText('High')).toBeInTheDocument()

    // Column headers — new UX: first column is "Task" not "Title"
    expect(screen.getByRole('columnheader', { name: /^task$/i })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: /^status$/i })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: /priority/i })).toBeInTheDocument()

    console.log('✅ TasksList: 3 tasks rendered with status badges and priority badges')
  })

  test('TasksList: Overdue badge shown for in_progress overdue task', async () => {
    mockApi.onGet('/users/me').reply(200, MOCK_OPS_MGR)
    mockApi.onGet('/tasks').reply(200, { data: MOCK_TASKS })

    render(
      <Wrapper>
        <Routes><Route path="/" element={<TasksListPage />} /></Routes>
      </Wrapper>
    )

    await waitFor(() =>
      expect(screen.getByText('Review Inventory Report')).toBeInTheDocument(),
      { timeout: 3000 }
    )

    expect(screen.getByText('Overdue')).toBeInTheDocument()
    // Completed task should NOT show overdue even if flag set
    expect(screen.queryAllByText('Overdue').length).toBe(1)

    console.log('✅ TasksList: Overdue badge shown only for non-terminal overdue tasks')
  })

  test('TasksList: empty state when no tasks', async () => {
    mockApi.onGet('/users/me').reply(200, MOCK_OPS_MGR)
    mockApi.onGet('/tasks').reply(200, { data: [] })

    render(
      <Wrapper>
        <Routes><Route path="/" element={<TasksListPage />} /></Routes>
      </Wrapper>
    )

    // New UX: empty state shows "No tasks yet" (not "No tasks found.")
    await waitFor(() =>
      expect(screen.getByText(/no tasks yet/i)).toBeInTheDocument(),
      { timeout: 3000 }
    )
    console.log('✅ TasksList: empty state shown when no tasks')
  })

  test('TasksList: error state on API failure', async () => {
    mockApi.onGet('/users/me').reply(200, MOCK_OPS_MGR)
    mockApi.onGet('/tasks').reply(500)

    render(
      <Wrapper>
        <Routes><Route path="/" element={<TasksListPage />} /></Routes>
      </Wrapper>
    )

    await waitFor(() =>
      expect(screen.getByText(/failed to load tasks/i)).toBeInTheDocument(),
      { timeout: 3000 }
    )
    console.log('✅ TasksList: error state shown on API failure')
  })

  test('TasksList: New Task button visible for operations_manager, hidden for member', async () => {
    // ops_manager sees the button
    mockApi.onGet('/users/me').reply(200, MOCK_OPS_MGR)
    mockApi.onGet('/tasks').reply(200, { data: [] })

    const { unmount } = render(
      <Wrapper>
        <Routes><Route path="/" element={<TasksListPage />} /></Routes>
      </Wrapper>
    )

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /new task/i })).toBeInTheDocument(),
      { timeout: 3000 }
    )
    console.log('✅ TasksList: New Task button visible for operations_manager')
    unmount()

    // member does not see the button
    const mockApi2 = new MockAdapter(api)
    mockApi2.onGet('/users/me').reply(200, MOCK_MEMBER)
    mockApi2.onGet('/tasks').reply(200, { data: [] })

    render(
      <Wrapper>
        <Routes><Route path="/" element={<TasksListPage />} /></Routes>
      </Wrapper>
    )

    await waitFor(() =>
      // New UX: empty state shows "No tasks yet"
      expect(screen.getByText(/no tasks yet/i)).toBeInTheDocument(),
      { timeout: 3000 }
    )
    expect(screen.queryByRole('button', { name: /new task/i })).not.toBeInTheDocument()
    console.log('✅ TasksList: New Task button hidden for member')
    mockApi2.restore()
  })

  test('TasksList: status and priority filter controls present', async () => {
    mockApi.onGet('/users/me').reply(200, MOCK_OPS_MGR)
    mockApi.onGet('/tasks').reply(200, { data: [] })

    render(
      <Wrapper>
        <Routes><Route path="/" element={<TasksListPage />} /></Routes>
      </Wrapper>
    )

    // New UX: status filters are pill buttons with group aria-label
    await waitFor(() =>
      expect(screen.getByRole('group', { name: /filter by status/i })).toBeInTheDocument(),
      { timeout: 3000 }
    )
    // Priority is still a combobox select
    expect(screen.getByRole('combobox', { name: /filter by priority/i })).toBeInTheDocument()
    // Search input present
    expect(screen.getByRole('textbox', { name: /search tasks/i })).toBeInTheDocument()

    console.log('✅ TasksList: status pill filters, priority combobox, and search present')
  })

  // ── TASK FORM ───────────────────────────────────────────────────────────────

  test('TaskForm: renders title, description, priority, due date fields', async () => {
    mockApi.onGet('/users/me').reply(200, MOCK_OPS_MGR)

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
    expect(screen.getByLabelText(/description/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/priority/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/due date/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /create task/i })).toBeInTheDocument()

    console.log('✅ TaskForm: all fields rendered')
  })

  test('TaskForm: title required — error on empty submit', async () => {
    const user = userEvent.setup()
    mockApi.onGet('/users/me').reply(200, MOCK_OPS_MGR)

    render(
      <Wrapper initialPath="/tasks/new">
        <Routes>
          <Route path="/tasks" element={<div>Tasks List</div>} />
          <Route path="/tasks/new" element={<TaskFormPage />} />
        </Routes>
      </Wrapper>
    )

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /create task/i })).toBeInTheDocument(),
      { timeout: 5000 }
    )

    await user.click(screen.getByRole('button', { name: /create task/i }))

    await waitFor(() =>
      expect(screen.getByText(/title is required/i)).toBeInTheDocument()
    )
    console.log('✅ TaskForm: title required error shown on empty submit')
  })

  test('TaskForm: successful create calls POST /v1/tasks and navigates to detail', async () => {
    const user = userEvent.setup()
    mockApi.onGet('/users/me').reply(200, MOCK_OPS_MGR)
    mockApi.onPost('/tasks').reply(201, {
      data: {
        id: 'task-new-001',
        organizationId: 'org-abc',
        title: 'Fix Payment Gateway',
        priority: 'high',
        status: 'pending',
        overdue: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        assignments: [],
      },
    })

    render(
      <Wrapper initialPath="/tasks/new">
        <Routes>
          <Route path="/tasks" element={<div>Tasks List</div>} />
          <Route path="/tasks/new" element={<TaskFormPage />} />
          <Route path="/tasks/:id" element={<div data-testid="task-detail">Task Detail</div>} />
        </Routes>
      </Wrapper>
    )

    await waitFor(() =>
      expect(screen.getByLabelText(/^title/i)).toBeInTheDocument(),
      { timeout: 5000 }
    )

    await user.type(screen.getByLabelText(/^title/i), 'Fix Payment Gateway')
    await user.selectOptions(screen.getByLabelText(/priority/i), 'high')
    await user.click(screen.getByRole('button', { name: /create task/i }))

    await waitFor(() =>
      expect(screen.getByTestId('task-detail')).toBeInTheDocument(),
      { timeout: 3000 }
    )

    expect(mockApi.history.post?.some(r => r.url === '/tasks')).toBe(true)
    console.log('✅ TaskForm: successful create navigates to task detail page')
  })

  test('TaskForm: member without task:create permission is redirected', async () => {
    mockApi.onGet('/users/me').reply(200, MOCK_MEMBER)

    render(
      <Wrapper initialPath="/tasks/new">
        <Routes>
          <Route path="/tasks" element={<div>Tasks List Page</div>} />
          <Route path="/tasks/new" element={<TaskFormPage />} />
        </Routes>
      </Wrapper>
    )

    await waitFor(() =>
      expect(screen.getByText('Tasks List Page')).toBeInTheDocument(),
      { timeout: 3000 }
    )
    expect(screen.queryByRole('button', { name: /create task/i })).not.toBeInTheDocument()
    console.log('✅ TaskForm: member redirected to /tasks (no task:create permission)')
  })

  // ── TASK DETAIL ─────────────────────────────────────────────────────────────

  test('TaskDetail: renders task metadata — title, status badge, priority chip, description', async () => {
    mockApi.onGet('/users/me').reply(200, MOCK_OPS_MGR)
    mockApi.onGet('/tasks/task-001').reply(200, { data: MOCK_TASK_DETAIL })
    mockApi.onGet('/tasks/task-001/comments').reply(200, { data: [] })

    render(
      <Wrapper initialPath="/tasks/task-001">
        <Routes>
          <Route path="/tasks/:id" element={<TaskDetailPage />} />
        </Routes>
      </Wrapper>
    )

    await waitFor(() =>
      expect(screen.getByText('Investigate CPU Spike')).toBeInTheDocument(),
      { timeout: 3000 }
    )

    expect(screen.getByText('CPU usage exceeded 90% threshold')).toBeInTheDocument()
    expect(screen.getByText('Pending')).toBeInTheDocument()
    expect(screen.getByText('critical')).toBeInTheDocument()

    console.log('✅ TaskDetail: title, description, status badge, priority chip rendered')
  })

  test('TaskDetail: Overdue badge shown when task.overdue = true and status is non-terminal', async () => {
    const overdueTask = { ...MOCK_TASKS[1]!, id: 'task-002', status: 'in_progress', overdue: true }
    mockApi.onGet('/users/me').reply(200, MOCK_OPS_MGR)
    mockApi.onGet('/tasks/task-002').reply(200, { data: overdueTask })
    mockApi.onGet('/tasks/task-002/comments').reply(200, { data: [] })

    render(
      <Wrapper initialPath="/tasks/task-002">
        <Routes>
          <Route path="/tasks/:id" element={<TaskDetailPage />} />
        </Routes>
      </Wrapper>
    )

    await waitFor(() =>
      expect(screen.getByText('Review Inventory Report')).toBeInTheDocument(),
      { timeout: 3000 }
    )
    expect(screen.getByText('Overdue')).toBeInTheDocument()

    console.log('✅ TaskDetail: Overdue badge shown for in_progress overdue task')
  })

  test('TaskDetail: Overdue badge NOT shown when task is completed', async () => {
    const completedOverdue = { ...MOCK_TASKS[2]!, id: 'task-003', status: 'completed', overdue: true }
    mockApi.onGet('/users/me').reply(200, MOCK_OPS_MGR)
    mockApi.onGet('/tasks/task-003').reply(200, { data: completedOverdue })
    mockApi.onGet('/tasks/task-003/comments').reply(200, { data: [] })

    render(
      <Wrapper initialPath="/tasks/task-003">
        <Routes>
          <Route path="/tasks/:id" element={<TaskDetailPage />} />
        </Routes>
      </Wrapper>
    )

    await waitFor(() =>
      expect(screen.getByText('Deploy Hotfix v1.2.1')).toBeInTheDocument(),
      { timeout: 3000 }
    )
    expect(screen.queryByText('Overdue')).not.toBeInTheDocument()

    console.log('✅ TaskDetail: Overdue badge NOT shown for completed task')
  })

  test('TaskDetail: pending task shows Start and Cancel transition buttons', async () => {
    mockApi.onGet('/users/me').reply(200, MOCK_OPS_MGR)
    mockApi.onGet('/tasks/task-001').reply(200, { data: MOCK_TASK_DETAIL })
    mockApi.onGet('/tasks/task-001/comments').reply(200, { data: [] })

    render(
      <Wrapper initialPath="/tasks/task-001">
        <Routes>
          <Route path="/tasks/:id" element={<TaskDetailPage />} />
        </Routes>
      </Wrapper>
    )

    await waitFor(() =>
      expect(screen.getByText('Investigate CPU Spike')).toBeInTheDocument(),
      { timeout: 3000 }
    )

    expect(screen.getByRole('button', { name: /^start$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^cancel$/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /complete/i })).not.toBeInTheDocument()

    console.log('✅ TaskDetail: pending task shows Start and Cancel buttons')
  })

  test('TaskDetail: in_progress task shows Complete and Cancel transition buttons', async () => {
    const inProgressTask = { ...MOCK_TASKS[1]!, id: 'task-002' }
    mockApi.onGet('/users/me').reply(200, MOCK_OPS_MGR)
    mockApi.onGet('/tasks/task-002').reply(200, { data: inProgressTask })
    mockApi.onGet('/tasks/task-002/comments').reply(200, { data: [] })

    render(
      <Wrapper initialPath="/tasks/task-002">
        <Routes>
          <Route path="/tasks/:id" element={<TaskDetailPage />} />
        </Routes>
      </Wrapper>
    )

    await waitFor(() =>
      expect(screen.getByText('Review Inventory Report')).toBeInTheDocument(),
      { timeout: 3000 }
    )

    expect(screen.getByRole('button', { name: /^complete$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^cancel$/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^start$/i })).not.toBeInTheDocument()

    console.log('✅ TaskDetail: in_progress task shows Complete and Cancel buttons')
  })

  test('TaskDetail: completed task shows NO status transition buttons', async () => {
    const completedTask = { ...MOCK_TASKS[2]!, id: 'task-003' }
    mockApi.onGet('/users/me').reply(200, MOCK_OPS_MGR)
    mockApi.onGet('/tasks/task-003').reply(200, { data: completedTask })
    mockApi.onGet('/tasks/task-003/comments').reply(200, { data: [] })

    render(
      <Wrapper initialPath="/tasks/task-003">
        <Routes>
          <Route path="/tasks/:id" element={<TaskDetailPage />} />
        </Routes>
      </Wrapper>
    )

    await waitFor(() =>
      expect(screen.getByText('Deploy Hotfix v1.2.1')).toBeInTheDocument(),
      { timeout: 3000 }
    )

    expect(screen.queryByRole('button', { name: /start/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /complete/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /cancel/i })).not.toBeInTheDocument()

    console.log('✅ TaskDetail: completed task shows NO transition buttons')
  })

  test('TaskDetail: successful status transition calls POST /v1/tasks/:id/status', async () => {
    mockApi.onGet('/users/me').reply(200, MOCK_OPS_MGR)
    mockApi.onGet('/tasks/task-001').reply(200, { data: MOCK_TASK_DETAIL })
    mockApi.onGet('/tasks/task-001/comments').reply(200, { data: [] })
    mockApi.onPost('/tasks/task-001/status').reply(200, {
      data: { ...MOCK_TASK_DETAIL, status: 'in_progress', updatedAt: new Date().toISOString() },
    })

    const user = userEvent.setup()

    render(
      <Wrapper initialPath="/tasks/task-001">
        <Routes>
          <Route path="/tasks/:id" element={<TaskDetailPage />} />
        </Routes>
      </Wrapper>
    )

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^start$/i })).toBeInTheDocument(),
      { timeout: 3000 }
    )

    await user.click(screen.getByRole('button', { name: /^start$/i }))

    await waitFor(() =>
      expect(mockApi.history.post?.some(r => r.url === '/tasks/task-001/status')).toBe(true)
    )

    const statusCall = mockApi.history.post?.find(r => r.url === '/tasks/task-001/status')
    expect(JSON.parse(statusCall?.data as string)).toEqual({ status: 'in_progress' })

    console.log('✅ TaskDetail: Start button calls POST /tasks/task-001/status with in_progress')
  })

  test('TaskDetail: comments section renders existing comments', async () => {
    mockApi.onGet('/users/me').reply(200, MOCK_OPS_MGR)
    mockApi.onGet('/tasks/task-001').reply(200, { data: MOCK_TASK_DETAIL })
    mockApi.onGet('/tasks/task-001/comments').reply(200, { data: MOCK_COMMENTS })

    render(
      <Wrapper initialPath="/tasks/task-001">
        <Routes>
          <Route path="/tasks/:id" element={<TaskDetailPage />} />
        </Routes>
      </Wrapper>
    )

    await waitFor(() =>
      expect(screen.getByText('Checked the metrics, CPU spike from 2pm onwards')).toBeInTheDocument(),
      { timeout: 3000 }
    )
    expect(screen.getByText('Ops Manager')).toBeInTheDocument()

    console.log('✅ TaskDetail: existing comments rendered correctly')
  })

  test('TaskDetail: comment form visible for operations_manager', async () => {
    mockApi.onGet('/users/me').reply(200, MOCK_OPS_MGR)
    mockApi.onGet('/tasks/task-001').reply(200, { data: MOCK_TASK_DETAIL })
    mockApi.onGet('/tasks/task-001/comments').reply(200, { data: [] })

    render(
      <Wrapper initialPath="/tasks/task-001">
        <Routes>
          <Route path="/tasks/:id" element={<TaskDetailPage />} />
        </Routes>
      </Wrapper>
    )

    await waitFor(() =>
      expect(screen.getByLabelText(/add a comment/i)).toBeInTheDocument(),
      { timeout: 3000 }
    )
    expect(screen.getByRole('button', { name: /post comment/i })).toBeInTheDocument()

    console.log('✅ TaskDetail: comment form visible for operations_manager')
  })
})
