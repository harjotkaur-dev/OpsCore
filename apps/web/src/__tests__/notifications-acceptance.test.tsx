/**
 * Phase 11.9 Notification Inbox Acceptance Tests
 *
 * Verifies:
 * NOTIFICATIONS PAGE
 * - Shows loading state while fetching
 * - Renders notification list with messages and timestamps
 * - Unread items show blue dot indicator and bold text
 * - Read items show no unread dot
 * - Shows empty state when no notifications
 * - Shows error state on API failure
 * - "All" / "Unread" filter toggle present
 * - "Mark all as read" button disabled when no unread items
 * - "Mark all as read" button enabled when unread items exist
 * - Individual "Mark as read" button shown only for unread items
 * - Mark as read calls POST /v1/notifications/:id/read
 * - Mark all as read calls POST /v1/notifications/read-all
 *
 * NOTIFICATION BELL
 * - Renders with no badge when no unread notifications
 * - Renders badge with correct count when unread notifications exist
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import MockAdapter from 'axios-mock-adapter'
import { SessionProvider } from '../providers/SessionProvider'
import { NotificationsPage } from '../features/notifications/pages/NotificationsPage'
import { NotificationBell } from '../features/notifications/components/NotificationBell'
import { api } from '../lib/api'
import type { ReactNode } from 'react'

function makeQC() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
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

const MOCK_OPS_MGR = {
  id: 'user-001', email: 'ops@example.com', fullName: 'Ops Manager',
  organizationId: 'org-abc', role: 'operations_manager',
}

const MOCK_NOTIFICATIONS = [
  {
    id: 'notif-001', organizationId: 'org-abc', recipientUserId: 'user-001',
    message: 'KPI threshold breached: Failed executions > 10',
    sourceEntityType: 'kpi', sourceEntityId: 'kpi-001',
    isRead: false, readAt: null,
    createdAt: '2024-01-15T10:00:00.000Z',
  },
  {
    id: 'notif-002', organizationId: 'org-abc', recipientUserId: 'user-001',
    message: 'Workflow "Alert on Order" activated',
    sourceEntityType: 'workflow', sourceEntityId: 'wf-001',
    isRead: false, readAt: null,
    createdAt: '2024-01-15T09:00:00.000Z',
  },
  {
    id: 'notif-003', organizationId: 'org-abc', recipientUserId: 'user-001',
    message: 'Task "Investigate CPU Spike" was assigned to you',
    sourceEntityType: 'task', sourceEntityId: 'task-001',
    isRead: true, readAt: '2024-01-15T08:30:00.000Z',
    createdAt: '2024-01-15T08:00:00.000Z',
  },
]

describe('Phase 11.9 Notification Inbox Acceptance Tests', () => {
  let mockApi: MockAdapter

  beforeEach(() => { mockApi = new MockAdapter(api) })
  afterEach(() => { mockApi.restore() })

  // ── NOTIFICATIONS PAGE ──────────────────────────────────────────────────────

  test('NotificationsPage: shows loading state while fetching', async () => {
    mockApi.onGet('/users/me').reply(200, MOCK_OPS_MGR)
    mockApi.onGet('/notifications').reply(() => new Promise(() => {}))

    render(
      <Wrapper><Routes><Route path="/" element={<NotificationsPage />} /></Routes></Wrapper>
    )

    await waitFor(() =>
      expect(mockApi.history.get?.some(r => r.url === '/users/me')).toBe(true)
    )
    await waitFor(() =>
      expect(screen.getByText(/loading notifications/i)).toBeInTheDocument(),
      { timeout: 3000 }
    )
    console.log('✅ NotificationsPage: loading state shown')
  })

  test('NotificationsPage: renders notification messages', async () => {
    mockApi.onGet('/users/me').reply(200, MOCK_OPS_MGR)
    mockApi.onGet('/notifications').reply(200, { data: MOCK_NOTIFICATIONS })

    render(
      <Wrapper><Routes><Route path="/" element={<NotificationsPage />} /></Routes></Wrapper>
    )

    await waitFor(() =>
      expect(screen.getByText('KPI threshold breached: Failed executions > 10')).toBeInTheDocument(),
      { timeout: 3000 }
    )
    expect(screen.getByText('Workflow "Alert on Order" activated')).toBeInTheDocument()
    expect(screen.getByText('Task "Investigate CPU Spike" was assigned to you')).toBeInTheDocument()

    console.log('✅ NotificationsPage: all 3 notification messages rendered')
  })

  test('NotificationsPage: unread items show blue dot indicator', async () => {
    mockApi.onGet('/users/me').reply(200, MOCK_OPS_MGR)
    mockApi.onGet('/notifications').reply(200, { data: MOCK_NOTIFICATIONS })

    render(
      <Wrapper><Routes><Route path="/" element={<NotificationsPage />} /></Routes></Wrapper>
    )

    await waitFor(() =>
      expect(screen.getByText('KPI threshold breached: Failed executions > 10')).toBeInTheDocument(),
      { timeout: 3000 }
    )

    // Two unread dots for the two unread notifications
    const unreadDots = screen.getAllByLabelText('Unread')
    expect(unreadDots.length).toBe(2)

    console.log('✅ NotificationsPage: 2 unread dot indicators shown')
  })

  test('NotificationsPage: "Mark as read" button shown only for unread items', async () => {
    mockApi.onGet('/users/me').reply(200, MOCK_OPS_MGR)
    mockApi.onGet('/notifications').reply(200, { data: MOCK_NOTIFICATIONS })

    render(
      <Wrapper><Routes><Route path="/" element={<NotificationsPage />} /></Routes></Wrapper>
    )

    await waitFor(() =>
      expect(screen.getByText('KPI threshold breached: Failed executions > 10')).toBeInTheDocument(),
      { timeout: 3000 }
    )

    // 2 unread notifications → 2 "Mark as read" buttons
    const markReadButtons = screen.getAllByRole('button', { name: /mark as read/i })
    expect(markReadButtons.length).toBe(2)

    console.log('✅ NotificationsPage: 2 "Mark as read" buttons (one per unread item)')
  })

  test('NotificationsPage: "Mark all as read" enabled when unread items exist', async () => {
    mockApi.onGet('/users/me').reply(200, MOCK_OPS_MGR)
    mockApi.onGet('/notifications').reply(200, { data: MOCK_NOTIFICATIONS })

    render(
      <Wrapper><Routes><Route path="/" element={<NotificationsPage />} /></Routes></Wrapper>
    )

    // Wait for data to load first (messages visible), THEN check button state
    await waitFor(() =>
      expect(screen.getByText('KPI threshold breached: Failed executions > 10')).toBeInTheDocument(),
      { timeout: 3000 }
    )
    expect(screen.getByRole('button', { name: /mark all as read/i })).not.toBeDisabled()

    console.log('✅ NotificationsPage: "Mark all as read" enabled when unread items exist')
  })

  test('NotificationsPage: "Mark all as read" disabled when all items are read', async () => {
    const allRead = MOCK_NOTIFICATIONS.map(n => ({ ...n, isRead: true, readAt: new Date().toISOString() }))
    mockApi.onGet('/users/me').reply(200, MOCK_OPS_MGR)
    mockApi.onGet('/notifications').reply(200, { data: allRead })

    render(
      <Wrapper><Routes><Route path="/" element={<NotificationsPage />} /></Routes></Wrapper>
    )

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /mark all as read/i })).toBeInTheDocument(),
      { timeout: 3000 }
    )
    expect(screen.getByRole('button', { name: /mark all as read/i })).toBeDisabled()

    console.log('✅ NotificationsPage: "Mark all as read" disabled when all items read')
  })

  test('NotificationsPage: empty state when no notifications', async () => {
    mockApi.onGet('/users/me').reply(200, MOCK_OPS_MGR)
    mockApi.onGet('/notifications').reply(200, { data: [] })

    render(
      <Wrapper><Routes><Route path="/" element={<NotificationsPage />} /></Routes></Wrapper>
    )

    await waitFor(() =>
      expect(screen.getByText(/no notifications/i)).toBeInTheDocument(),
      { timeout: 3000 }
    )
    console.log('✅ NotificationsPage: empty state shown')
  })

  test('NotificationsPage: error state on API failure', async () => {
    mockApi.onGet('/users/me').reply(200, MOCK_OPS_MGR)
    mockApi.onGet('/notifications').reply(500)

    render(
      <Wrapper><Routes><Route path="/" element={<NotificationsPage />} /></Routes></Wrapper>
    )

    await waitFor(() =>
      expect(screen.getByText(/failed to load notifications/i)).toBeInTheDocument(),
      { timeout: 3000 }
    )
    console.log('✅ NotificationsPage: error state shown on API failure')
  })

  test('NotificationsPage: All/Unread filter toggle buttons present', async () => {
    mockApi.onGet('/users/me').reply(200, MOCK_OPS_MGR)
    mockApi.onGet('/notifications').reply(200, { data: [] })

    render(
      <Wrapper><Routes><Route path="/" element={<NotificationsPage />} /></Routes></Wrapper>
    )

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^all$/i })).toBeInTheDocument(),
      { timeout: 3000 }
    )
    expect(screen.getByRole('button', { name: /^unread$/i })).toBeInTheDocument()

    console.log('✅ NotificationsPage: All/Unread filter toggles present')
  })

  test('NotificationsPage: Mark as read calls POST /v1/notifications/:id/read', async () => {
    const user = userEvent.setup()
    mockApi.onGet('/users/me').reply(200, MOCK_OPS_MGR)
    mockApi.onGet('/notifications').reply(200, { data: MOCK_NOTIFICATIONS })
    mockApi.onPost('/notifications/notif-001/read').reply(200)
    // After invalidation refetch
    mockApi.onGet('/notifications').reply(200, { data: MOCK_NOTIFICATIONS })

    render(
      <Wrapper><Routes><Route path="/" element={<NotificationsPage />} /></Routes></Wrapper>
    )

    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: /mark as read/i }).length).toBe(2),
      { timeout: 3000 }
    )

    await user.click(screen.getAllByRole('button', { name: /mark as read/i })[0]!)

    await waitFor(() =>
      expect(
        mockApi.history.post?.some(r => r.url === '/notifications/notif-001/read')
      ).toBe(true)
    )
    console.log('✅ NotificationsPage: Mark as read calls POST /notifications/notif-001/read')
  })

  test('NotificationsPage: Mark all as read calls POST /v1/notifications/read-all', async () => {
    const user = userEvent.setup()
    mockApi.onGet('/users/me').reply(200, MOCK_OPS_MGR)
    // Both initial fetch and any refetch return the same data for this test
    mockApi.onGet('/notifications').reply(200, { data: MOCK_NOTIFICATIONS })
    mockApi.onPost('/notifications/read-all').reply(200)

    render(
      <Wrapper><Routes><Route path="/" element={<NotificationsPage />} /></Routes></Wrapper>
    )

    // Wait for data, then verify the button is enabled
    await waitFor(() =>
      expect(screen.getByText('KPI threshold breached: Failed executions > 10')).toBeInTheDocument(),
      { timeout: 3000 }
    )
    expect(screen.getByRole('button', { name: /mark all as read/i })).not.toBeDisabled()

    await user.click(screen.getByRole('button', { name: /mark all as read/i }))

    await waitFor(() =>
      expect(
        mockApi.history.post?.some(r => r.url === '/notifications/read-all')
      ).toBe(true)
    )
    console.log('✅ NotificationsPage: Mark all as read calls POST /notifications/read-all')
  })

  // ── NOTIFICATION BELL ───────────────────────────────────────────────────────

  test('NotificationBell: renders with no badge when no unread notifications', async () => {
    const allRead = MOCK_NOTIFICATIONS.map(n => ({ ...n, isRead: true }))
    mockApi.onGet('/users/me').reply(200, MOCK_OPS_MGR)
    mockApi.onGet('/notifications').reply(200, { data: allRead })

    render(
      <Wrapper>
        <Routes>
          <Route path="/" element={<NotificationBell />} />
        </Routes>
      </Wrapper>
    )

    await waitFor(() =>
      expect(mockApi.history.get?.some(r => r.url?.includes('/notifications'))).toBe(true),
      { timeout: 3000 }
    )

    // Bell button exists but no badge text (no number shown)
    expect(screen.getByRole('button', { name: /notifications$/i })).toBeInTheDocument()
    // No number badge
    expect(screen.queryByText(/^\d+$/)).not.toBeInTheDocument()

    console.log('✅ NotificationBell: no badge when all notifications are read')
  })

  test('NotificationBell: shows unread count badge', async () => {
    mockApi.onGet('/users/me').reply(200, MOCK_OPS_MGR)
    mockApi.onGet('/notifications').reply(200, { data: MOCK_NOTIFICATIONS })

    render(
      <Wrapper>
        <Routes>
          <Route path="/" element={<NotificationBell />} />
        </Routes>
      </Wrapper>
    )

    await waitFor(() =>
      // 2 unread notifications → badge shows "2"
      expect(screen.getByText('2')).toBeInTheDocument(),
      { timeout: 3000 }
    )

    // Bell aria-label includes the count
    expect(screen.getByRole('button', { name: /2 unread/i })).toBeInTheDocument()

    console.log('✅ NotificationBell: shows badge with count 2 for 2 unread notifications')
  })
})
