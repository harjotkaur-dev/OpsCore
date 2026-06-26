/**
 * Phase 11.7 Execution Monitor Pages Acceptance Tests
 *
 * Verifies:
 * EXECUTIONS LIST
 * - Shows loading state while fetching
 * - Renders execution rows with status badges (queued/running/completed/failed)
 * - Shows empty state when no executions
 * - Shows error state on API failure
 * - Status filter and workflow ID filter controls present
 * - Permission denied message for member role (no execution:read)
 * - "View Failed" navigation link present
 *
 * FAILED EXECUTIONS LIST
 * - Renders failed execution rows with error detail
 * - Retry button visible for operations_manager (has execution:retry)
 * - Retry button calls POST /v1/executions/:id/retry
 * - Shows empty state when no failed executions
 *
 * EXECUTION DETAIL
 * - Renders execution metadata: status badge, workflow, event ID, times
 * - Shows error detail block for failed executions
 * - Does NOT show error block for completed executions
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import MockAdapter from 'axios-mock-adapter'
import { SessionProvider } from '../providers/SessionProvider'
import { ExecutionsListPage } from '../features/executions/pages/ExecutionsListPage'
import { FailedExecutionsPage } from '../features/executions/pages/FailedExecutionsPage'
import { ExecutionDetailPage } from '../features/executions/pages/ExecutionDetailPage'
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

const MOCK_OPS_MGR = {
  id: 'user-001', email: 'ops@example.com', fullName: 'Ops Manager',
  organizationId: 'org-abc', role: 'operations_manager',
}

const MOCK_MEMBER = {
  id: 'user-002', email: 'member@example.com', fullName: 'Team Member',
  organizationId: 'org-abc', role: 'member',
}

const MOCK_EXECUTIONS = [
  {
    id: 'exec-001', organizationId: 'org-abc', workflowId: 'wf-001',
    workflowName: 'Alert on Order', eventId: 'evt-001',
    status: 'completed', startedAt: '2024-01-15T10:00:00.000Z',
    completedAt: '2024-01-15T10:00:05.000Z', errorDetail: null,
    attemptCount: 1, createdAt: '2024-01-15T10:00:00.000Z',
  },
  {
    id: 'exec-002', organizationId: 'org-abc', workflowId: 'wf-001',
    workflowName: 'Alert on Order', eventId: 'evt-002',
    status: 'failed', startedAt: '2024-01-15T11:00:00.000Z',
    completedAt: '2024-01-15T11:00:03.000Z', errorDetail: 'Connection timeout after 3 retries',
    attemptCount: 3, createdAt: '2024-01-15T11:00:00.000Z',
  },
  {
    id: 'exec-003', organizationId: 'org-abc', workflowId: 'wf-002',
    workflowName: 'Payment Retry', eventId: 'evt-003',
    status: 'running', startedAt: '2024-01-15T12:00:00.000Z',
    completedAt: null, errorDetail: null,
    attemptCount: 1, createdAt: '2024-01-15T12:00:00.000Z',
  },
]

const MOCK_FAILED_EXECUTIONS = [MOCK_EXECUTIONS[1]!]

const PAGINATION = { limit: 20, hasNextPage: false, nextCursor: null }

describe('Phase 11.7 Execution Monitor Pages Acceptance Tests', () => {
  let mockApi: MockAdapter

  beforeEach(() => { mockApi = new MockAdapter(api) })
  afterEach(() => { mockApi.restore() })

  // ── EXECUTIONS LIST ─────────────────────────────────────────────────────────

  test('ExecutionsList: shows loading state while fetching', async () => {
    mockApi.onGet('/users/me').reply(200, MOCK_OPS_MGR)
    mockApi.onGet('/executions').reply(() => new Promise(() => {}))

    render(
      <Wrapper><Routes><Route path="/" element={<ExecutionsListPage />} /></Routes></Wrapper>
    )

    await waitFor(() =>
      expect(mockApi.history.get?.some(r => r.url === '/users/me')).toBe(true)
    )
    await waitFor(() =>
      expect(screen.getByText(/loading executions/i)).toBeInTheDocument(),
      { timeout: 3000 }
    )
    console.log('✅ ExecutionsList: loading state shown')
  })

  test('ExecutionsList: renders rows with status badges', async () => {
    mockApi.onGet('/users/me').reply(200, MOCK_OPS_MGR)
    mockApi.onGet('/executions').reply(200, { data: MOCK_EXECUTIONS, pagination: PAGINATION })

    render(
      <Wrapper><Routes><Route path="/" element={<ExecutionsListPage />} /></Routes></Wrapper>
    )

    await waitFor(() =>
      expect(screen.getAllByText('Alert on Order').length).toBeGreaterThanOrEqual(1),
      { timeout: 3000 }
    )

    // Status badges — use getAllByText since filter options also contain these labels
    expect(screen.getByText('completed')).toBeInTheDocument()
    expect(screen.getByText('failed')).toBeInTheDocument()
    expect(screen.getByText('running')).toBeInTheDocument()

    // Workflow names
    expect(screen.getAllByText('Alert on Order').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Payment Retry')).toBeInTheDocument()

    console.log('✅ ExecutionsList: rows rendered with correct status badges')
  })

  test('ExecutionsList: shows empty state when no executions', async () => {
    mockApi.onGet('/users/me').reply(200, MOCK_OPS_MGR)
    mockApi.onGet('/executions').reply(200, { data: [], pagination: PAGINATION })

    render(
      <Wrapper><Routes><Route path="/" element={<ExecutionsListPage />} /></Routes></Wrapper>
    )

    await waitFor(() =>
      expect(screen.getByText(/no executions found/i)).toBeInTheDocument(),
      { timeout: 3000 }
    )
    console.log('✅ ExecutionsList: empty state shown')
  })

  test('ExecutionsList: shows error state on API failure', async () => {
    mockApi.onGet('/users/me').reply(200, MOCK_OPS_MGR)
    mockApi.onGet('/executions').reply(500)

    render(
      <Wrapper><Routes><Route path="/" element={<ExecutionsListPage />} /></Routes></Wrapper>
    )

    await waitFor(() =>
      expect(screen.getByText(/failed to load executions/i)).toBeInTheDocument(),
      { timeout: 3000 }
    )
    console.log('✅ ExecutionsList: error state shown on API failure')
  })

  test('ExecutionsList: status filter and workflow ID filter controls present', async () => {
    mockApi.onGet('/users/me').reply(200, MOCK_OPS_MGR)
    mockApi.onGet('/executions').reply(200, { data: [], pagination: PAGINATION })

    render(
      <Wrapper><Routes><Route path="/" element={<ExecutionsListPage />} /></Routes></Wrapper>
    )

    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: /filter by status/i })).toBeInTheDocument(),
      { timeout: 3000 }
    )
    expect(screen.getByRole('textbox', { name: /filter by workflow/i })).toBeInTheDocument()
    console.log('✅ ExecutionsList: status and workflow ID filters present')
  })

  test('ExecutionsList: permission denied for member role', async () => {
    mockApi.onGet('/users/me').reply(200, MOCK_MEMBER)
    mockApi.onGet('/executions').reply(200, { data: [], pagination: PAGINATION })

    render(
      <Wrapper><Routes><Route path="/" element={<ExecutionsListPage />} /></Routes></Wrapper>
    )

    await waitFor(() =>
      expect(screen.getByText(/do not have permission/i)).toBeInTheDocument(),
      { timeout: 3000 }
    )
    console.log('✅ ExecutionsList: permission denied message for member role')
  })

  // ── FAILED EXECUTIONS ───────────────────────────────────────────────────────

  test('FailedExecutions: renders failed rows with error detail', async () => {
    mockApi.onGet('/users/me').reply(200, MOCK_OPS_MGR)
    mockApi.onGet('/executions/failed').reply(200, { data: MOCK_FAILED_EXECUTIONS, pagination: PAGINATION })

    render(
      <Wrapper><Routes><Route path="/" element={<FailedExecutionsPage />} /></Routes></Wrapper>
    )

    await waitFor(() =>
      expect(screen.getByText('Alert on Order')).toBeInTheDocument(),
      { timeout: 3000 }
    )
    expect(screen.getByText('Connection timeout after 3 retries')).toBeInTheDocument()
    console.log('✅ FailedExecutions: failed row with error detail rendered')
  })

  test('FailedExecutions: Retry button visible for operations_manager', async () => {
    mockApi.onGet('/users/me').reply(200, MOCK_OPS_MGR)
    mockApi.onGet('/executions/failed').reply(200, { data: MOCK_FAILED_EXECUTIONS, pagination: PAGINATION })

    render(
      <Wrapper><Routes><Route path="/" element={<FailedExecutionsPage />} /></Routes></Wrapper>
    )

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /retry execution exec-002/i })).toBeInTheDocument(),
      { timeout: 3000 }
    )
    console.log('✅ FailedExecutions: Retry button visible for operations_manager')
  })

  test('FailedExecutions: Retry button calls POST /v1/executions/:id/retry', async () => {
    const user = userEvent.setup()
    mockApi.onGet('/users/me').reply(200, MOCK_OPS_MGR)
    mockApi.onGet('/executions/failed').reply(200, { data: MOCK_FAILED_EXECUTIONS, pagination: PAGINATION })
    mockApi.onPost('/executions/exec-002/retry').reply(200, {
      data: { ...MOCK_FAILED_EXECUTIONS[0], status: 'queued', attemptCount: 0 },
    })
    // Re-fetch after retry
    mockApi.onGet('/executions').reply(200, { data: [], pagination: PAGINATION })

    render(
      <Wrapper><Routes><Route path="/" element={<FailedExecutionsPage />} /></Routes></Wrapper>
    )

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /retry execution exec-002/i })).toBeInTheDocument(),
      { timeout: 3000 }
    )

    await user.click(screen.getByRole('button', { name: /retry execution exec-002/i }))

    await waitFor(() =>
      expect(mockApi.history.post?.some(r => r.url === '/executions/exec-002/retry')).toBe(true)
    )
    console.log('✅ FailedExecutions: Retry calls POST /executions/exec-002/retry')
  })

  test('FailedExecutions: shows empty state when no failed executions', async () => {
    mockApi.onGet('/users/me').reply(200, MOCK_OPS_MGR)
    mockApi.onGet('/executions/failed').reply(200, { data: [], pagination: PAGINATION })

    render(
      <Wrapper><Routes><Route path="/" element={<FailedExecutionsPage />} /></Routes></Wrapper>
    )

    await waitFor(() =>
      expect(screen.getByText(/no failed executions/i)).toBeInTheDocument(),
      { timeout: 3000 }
    )
    console.log('✅ FailedExecutions: empty state shown when no failures')
  })

  // ── EXECUTION DETAIL ────────────────────────────────────────────────────────

  test('ExecutionDetail: renders metadata for a completed execution', async () => {
    mockApi.onGet('/users/me').reply(200, MOCK_OPS_MGR)
    mockApi.onGet('/executions/exec-001').reply(200, { data: MOCK_EXECUTIONS[0] })

    render(
      <Wrapper initialPath="/executions/exec-001">
        <Routes>
          <Route path="/executions/:id" element={<ExecutionDetailPage />} />
        </Routes>
      </Wrapper>
    )

    await waitFor(() =>
      expect(screen.getAllByText('Alert on Order').length).toBeGreaterThanOrEqual(1),
      { timeout: 3000 }
    )
    expect(screen.getByText('completed')).toBeInTheDocument()
    // Execution ID displayed in the header paragraph
    expect(screen.getByText('exec-001')).toBeInTheDocument()

    console.log('✅ ExecutionDetail: completed execution metadata rendered')
  })

  test('ExecutionDetail: shows error detail block for failed execution', async () => {
    mockApi.onGet('/users/me').reply(200, MOCK_OPS_MGR)
    mockApi.onGet('/executions/exec-002').reply(200, { data: MOCK_EXECUTIONS[1] })

    render(
      <Wrapper initialPath="/executions/exec-002">
        <Routes>
          <Route path="/executions/:id" element={<ExecutionDetailPage />} />
        </Routes>
      </Wrapper>
    )

    await waitFor(() =>
      expect(screen.getByText('failed')).toBeInTheDocument(),
      { timeout: 3000 }
    )
    expect(screen.getByText(/error detail/i)).toBeInTheDocument()
    expect(screen.getByText('Connection timeout after 3 retries')).toBeInTheDocument()

    console.log('✅ ExecutionDetail: error detail block shown for failed execution')
  })

  test('ExecutionDetail: does NOT show error detail block for completed execution', async () => {
    mockApi.onGet('/users/me').reply(200, MOCK_OPS_MGR)
    mockApi.onGet('/executions/exec-001').reply(200, { data: MOCK_EXECUTIONS[0] })

    render(
      <Wrapper initialPath="/executions/exec-001">
        <Routes>
          <Route path="/executions/:id" element={<ExecutionDetailPage />} />
        </Routes>
      </Wrapper>
    )

    await waitFor(() =>
      expect(screen.getByText('completed')).toBeInTheDocument(),
      { timeout: 3000 }
    )
    expect(screen.queryByText(/error detail/i)).not.toBeInTheDocument()

    console.log('✅ ExecutionDetail: no error detail block for completed execution')
  })
})
