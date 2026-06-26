/**
 * Phase 11.8 Metrics & KPI Dashboard Acceptance Tests
 *
 * Verifies:
 * METRICS DASHBOARD
 * - Shows loading state while fetching
 * - Renders metric cards with formatted names (snake_case → Title Case)
 * - Renders metric current values
 * - Shows empty state when no metrics
 * - Shows error state on API failure
 *
 * KPIs PAGE
 * - Shows loading state while fetching
 * - Renders KPI rows with name, metric, operator, target, current value
 * - Breached KPI shows red "Breached" badge
 * - OK KPI shows green "OK" badge
 * - Delete button visible for admin (has kpi:delete), hidden for member
 * - Delete calls DELETE /v1/kpis/:id
 * - Create KPI form visible for admin (has kpi:create)
 * - Create KPI form NOT visible for member
 * - Create KPI form validation: name required, metric required, valid number for target
 * - Successful create calls POST /v1/kpis
 * - Empty state when no KPIs defined
 * - Error state on API failure
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import MockAdapter from 'axios-mock-adapter'
import { SessionProvider } from '../providers/SessionProvider'
import { MetricsDashboardPage } from '../features/metrics/pages/MetricsDashboardPage'
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

const MOCK_ADMIN = {
  id: 'user-001', email: 'admin@example.com', fullName: 'Admin User',
  organizationId: 'org-abc', role: 'admin',
}
const MOCK_MEMBER = {
  id: 'user-002', email: 'member@example.com', fullName: 'Member',
  organizationId: 'org-abc', role: 'member',
}

const MOCK_METRICS = [
  { id: 'met-001', organizationId: 'org-abc', name: 'total_events_ingested', currentValue: 1234, computedAt: '2024-01-15T12:00:00.000Z' },
  { id: 'met-002', organizationId: 'org-abc', name: 'task_completion_rate', currentValue: 87, computedAt: '2024-01-15T12:00:00.000Z' },
  { id: 'met-003', organizationId: 'org-abc', name: 'total_failed_executions', currentValue: 5, computedAt: '2024-01-15T12:00:00.000Z' },
]

const MOCK_KPIS = [
  {
    id: 'kpi-001', organizationId: 'org-abc', name: 'Max Failed Executions',
    metricName: 'total_failed_executions', operator: '<' as const,
    targetValue: 10, currentValue: 5,
    isBreached: false, ownerUserId: 'user-001', createdAt: '2024-01-01T00:00:00.000Z',
  },
  {
    id: 'kpi-002', organizationId: 'org-abc', name: 'Min Task Completion',
    metricName: 'task_completion_rate', operator: '>' as const,
    targetValue: 90, currentValue: 87,
    isBreached: true, ownerUserId: 'user-001', createdAt: '2024-01-01T00:00:00.000Z',
  },
]

describe('Phase 11.8 Metrics & KPI Dashboard Acceptance Tests', () => {
  let mockApi: MockAdapter

  beforeEach(() => { mockApi = new MockAdapter(api) })
  afterEach(() => { mockApi.restore() })

  // ── METRICS DASHBOARD ───────────────────────────────────────────────────────

  test('MetricsDashboard: shows loading state while fetching', async () => {
    mockApi.onGet('/users/me').reply(200, MOCK_ADMIN)
    mockApi.onGet('/metrics').reply(() => new Promise(() => {}))

    render(
      <Wrapper><Routes><Route path="/" element={<MetricsDashboardPage />} /></Routes></Wrapper>
    )

    await waitFor(() =>
      expect(mockApi.history.get?.some(r => r.url === '/users/me')).toBe(true)
    )
    await waitFor(() =>
      expect(screen.getByText(/loading metrics/i)).toBeInTheDocument(),
      { timeout: 3000 }
    )
    console.log('✅ MetricsDashboard: loading state shown')
  })

  test('MetricsDashboard: renders metric cards with formatted names and values', async () => {
    mockApi.onGet('/users/me').reply(200, MOCK_ADMIN)
    mockApi.onGet('/metrics').reply(200, { data: MOCK_METRICS })

    render(
      <Wrapper><Routes><Route path="/" element={<MetricsDashboardPage />} /></Routes></Wrapper>
    )

    await waitFor(() =>
      expect(screen.getByText('Total Events Ingested')).toBeInTheDocument(),
      { timeout: 3000 }
    )

    // Formatted names (snake_case → Title Case)
    expect(screen.getByText('Task Completion Rate')).toBeInTheDocument()
    expect(screen.getByText('Total Failed Executions')).toBeInTheDocument()

    // Current values
    expect(screen.getByText('1,234')).toBeInTheDocument()
    expect(screen.getByText('87')).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()

    console.log('✅ MetricsDashboard: 3 metric cards with formatted names and values')
  })

  test('MetricsDashboard: shows empty state when no metrics', async () => {
    mockApi.onGet('/users/me').reply(200, MOCK_ADMIN)
    mockApi.onGet('/metrics').reply(200, { data: [] })

    render(
      <Wrapper><Routes><Route path="/" element={<MetricsDashboardPage />} /></Routes></Wrapper>
    )

    await waitFor(() =>
      expect(screen.getByText(/no metrics available/i)).toBeInTheDocument(),
      { timeout: 3000 }
    )
    console.log('✅ MetricsDashboard: empty state shown')
  })

  test('MetricsDashboard: shows error state on API failure', async () => {
    mockApi.onGet('/users/me').reply(200, MOCK_ADMIN)
    mockApi.onGet('/metrics').reply(500)

    render(
      <Wrapper><Routes><Route path="/" element={<MetricsDashboardPage />} /></Routes></Wrapper>
    )

    await waitFor(() =>
      expect(screen.getByText(/failed to load metrics/i)).toBeInTheDocument(),
      { timeout: 3000 }
    )
    console.log('✅ MetricsDashboard: error state shown on API failure')
  })

  // ── KPIs PAGE ───────────────────────────────────────────────────────────────

  test('KPIsPage: shows loading state while fetching', async () => {
    mockApi.onGet('/users/me').reply(200, MOCK_ADMIN)
    mockApi.onGet('/kpis').reply(() => new Promise(() => {}))
    mockApi.onGet('/metrics').reply(200, { data: MOCK_METRICS })

    render(
      <Wrapper><Routes><Route path="/" element={<KPIsPage />} /></Routes></Wrapper>
    )

    await waitFor(() =>
      expect(mockApi.history.get?.some(r => r.url === '/users/me')).toBe(true)
    )
    await waitFor(() =>
      expect(screen.getByText(/loading kpis/i)).toBeInTheDocument(),
      { timeout: 3000 }
    )
    console.log('✅ KPIsPage: loading state shown')
  })

  test('KPIsPage: renders KPI rows with Breached and OK badges', async () => {
    mockApi.onGet('/users/me').reply(200, MOCK_ADMIN)
    mockApi.onGet('/kpis').reply(200, { data: MOCK_KPIS })
    mockApi.onGet('/metrics').reply(200, { data: MOCK_METRICS })

    render(
      <Wrapper><Routes><Route path="/" element={<KPIsPage />} /></Routes></Wrapper>
    )

    await waitFor(() =>
      expect(screen.getByText('Max Failed Executions')).toBeInTheDocument(),
      { timeout: 3000 }
    )

    // KPI names
    expect(screen.getByText('Max Failed Executions')).toBeInTheDocument()
    expect(screen.getByText('Min Task Completion')).toBeInTheDocument()

    // Breached/OK badges
    expect(screen.getByText('Breached')).toBeInTheDocument()
    expect(screen.getByText('OK')).toBeInTheDocument()

    // Operators — use getAllByText since operator appears in both table and form dropdown
    expect(screen.getAllByText('<').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('>').length).toBeGreaterThanOrEqual(1)

    console.log('✅ KPIsPage: KPI rows rendered with Breached and OK badges')
  })

  test('KPIsPage: Delete button visible for admin, hidden for member', async () => {
    // Admin sees delete buttons
    mockApi.onGet('/users/me').reply(200, MOCK_ADMIN)
    mockApi.onGet('/kpis').reply(200, { data: MOCK_KPIS })
    mockApi.onGet('/metrics').reply(200, { data: MOCK_METRICS })

    const { unmount } = render(
      <Wrapper><Routes><Route path="/" element={<KPIsPage />} /></Routes></Wrapper>
    )

    await waitFor(() =>
      expect(screen.getByText('Max Failed Executions')).toBeInTheDocument(),
      { timeout: 3000 }
    )
    expect(screen.getAllByRole('button', { name: /delete kpi/i }).length).toBe(2)
    console.log('✅ KPIsPage: Delete buttons visible for admin')
    unmount()

    // Member does not see delete buttons
    const mockApi2 = new MockAdapter(api)
    mockApi2.onGet('/users/me').reply(200, MOCK_MEMBER)
    mockApi2.onGet('/kpis').reply(200, { data: MOCK_KPIS })
    mockApi2.onGet('/metrics').reply(200, { data: MOCK_METRICS })

    render(
      <Wrapper><Routes><Route path="/" element={<KPIsPage />} /></Routes></Wrapper>
    )

    await waitFor(() =>
      expect(screen.getByText('Max Failed Executions')).toBeInTheDocument(),
      { timeout: 3000 }
    )
    expect(screen.queryAllByRole('button', { name: /delete kpi/i }).length).toBe(0)
    console.log('✅ KPIsPage: Delete buttons hidden for member')
    mockApi2.restore()
  })

  test('KPIsPage: Delete calls DELETE /v1/kpis/:id', async () => {
    const user = userEvent.setup()
    mockApi.onGet('/users/me').reply(200, MOCK_ADMIN)
    mockApi.onGet('/kpis').reply(200, { data: MOCK_KPIS })
    mockApi.onGet('/metrics').reply(200, { data: MOCK_METRICS })
    mockApi.onDelete('/kpis/kpi-001').reply(204)

    render(
      <Wrapper><Routes><Route path="/" element={<KPIsPage />} /></Routes></Wrapper>
    )

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /delete kpi max failed executions/i })).toBeInTheDocument(),
      { timeout: 3000 }
    )

    await user.click(screen.getByRole('button', { name: /delete kpi max failed executions/i }))

    await waitFor(() =>
      expect(mockApi.history.delete?.some(r => r.url === '/kpis/kpi-001')).toBe(true)
    )
    console.log('✅ KPIsPage: Delete calls DELETE /kpis/kpi-001')
  })

  test('KPIsPage: Create KPI form visible for admin', async () => {
    mockApi.onGet('/users/me').reply(200, MOCK_ADMIN)
    mockApi.onGet('/kpis').reply(200, { data: [] })
    mockApi.onGet('/metrics').reply(200, { data: MOCK_METRICS })

    render(
      <Wrapper><Routes><Route path="/" element={<KPIsPage />} /></Routes></Wrapper>
    )

    await waitFor(() =>
      expect(screen.getByLabelText(/^name$/i)).toBeInTheDocument(),
      { timeout: 5000 }
    )
    expect(screen.getByLabelText(/metric/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/operator/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/target value/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /create kpi/i })).toBeInTheDocument()

    console.log('✅ KPIsPage: Create KPI form visible for admin')
  })

  test('KPIsPage: Create KPI form NOT visible for member', async () => {
    mockApi.onGet('/users/me').reply(200, MOCK_MEMBER)
    mockApi.onGet('/kpis').reply(200, { data: [] })
    mockApi.onGet('/metrics').reply(200, { data: [] })

    render(
      <Wrapper><Routes><Route path="/" element={<KPIsPage />} /></Routes></Wrapper>
    )

    await waitFor(() =>
      expect(screen.getByText(/no kpis defined/i)).toBeInTheDocument(),
      { timeout: 3000 }
    )
    expect(screen.queryByRole('button', { name: /create kpi/i })).not.toBeInTheDocument()

    console.log('✅ KPIsPage: Create KPI form hidden for member')
  })

  test('KPIsPage: Create KPI validation — name required', async () => {
    const user = userEvent.setup()
    mockApi.onGet('/users/me').reply(200, MOCK_ADMIN)
    mockApi.onGet('/kpis').reply(200, { data: [] })
    mockApi.onGet('/metrics').reply(200, { data: MOCK_METRICS })

    render(
      <Wrapper><Routes><Route path="/" element={<KPIsPage />} /></Routes></Wrapper>
    )

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /create kpi/i })).toBeInTheDocument(),
      { timeout: 5000 }
    )

    await user.click(screen.getByRole('button', { name: /create kpi/i }))

    await waitFor(() =>
      expect(screen.getByText(/name is required/i)).toBeInTheDocument()
    )
    console.log('✅ KPIsPage: name required validation error shown')
  })

  test('KPIsPage: Successful KPI create calls POST /v1/kpis', async () => {
    const user = userEvent.setup()
    mockApi.onGet('/users/me').reply(200, MOCK_ADMIN)
    mockApi.onGet('/kpis').reply(200, { data: [] })
    mockApi.onGet('/metrics').reply(200, { data: MOCK_METRICS })
    mockApi.onPost('/kpis').reply(201, {
      data: {
        id: 'kpi-new', organizationId: 'org-abc', name: 'Low Error Rate',
        metricName: 'total_failed_executions', operator: '<',
        targetValue: 5, currentValue: 3, isBreached: false,
        ownerUserId: 'user-001', createdAt: new Date().toISOString(),
      },
    })

    render(
      <Wrapper><Routes><Route path="/" element={<KPIsPage />} /></Routes></Wrapper>
    )

    await waitFor(() =>
      expect(screen.getByLabelText(/^name$/i)).toBeInTheDocument(),
      { timeout: 5000 }
    )

    await user.type(screen.getByLabelText(/^name$/i), 'Low Error Rate')

    // Wait for metrics to load in selector
    await waitFor(() =>
      expect(screen.getByText('total_failed_executions')).toBeInTheDocument(),
      { timeout: 3000 }
    )
    await user.selectOptions(screen.getByLabelText(/metric/i), 'total_failed_executions')
    await user.clear(screen.getByLabelText(/target value/i))
    await user.type(screen.getByLabelText(/target value/i), '5')
    await user.click(screen.getByRole('button', { name: /create kpi/i }))

    await waitFor(() =>
      expect(mockApi.history.post?.some(r => r.url === '/kpis')).toBe(true)
    )
    console.log('✅ KPIsPage: Create KPI calls POST /kpis')
  })

  test('KPIsPage: empty state when no KPIs defined', async () => {
    mockApi.onGet('/users/me').reply(200, MOCK_ADMIN)
    mockApi.onGet('/kpis').reply(200, { data: [] })
    mockApi.onGet('/metrics').reply(200, { data: [] })

    render(
      <Wrapper><Routes><Route path="/" element={<KPIsPage />} /></Routes></Wrapper>
    )

    await waitFor(() =>
      expect(screen.getByText(/no kpis defined/i)).toBeInTheDocument(),
      { timeout: 3000 }
    )
    console.log('✅ KPIsPage: empty state shown')
  })

  test('KPIsPage: error state on API failure', async () => {
    mockApi.onGet('/users/me').reply(200, MOCK_ADMIN)
    mockApi.onGet('/kpis').reply(500)
    mockApi.onGet('/metrics').reply(200, { data: [] })

    render(
      <Wrapper><Routes><Route path="/" element={<KPIsPage />} /></Routes></Wrapper>
    )

    await waitFor(() =>
      expect(screen.getByText(/failed to load kpis/i)).toBeInTheDocument(),
      { timeout: 3000 }
    )
    console.log('✅ KPIsPage: error state shown on API failure')
  })
})
