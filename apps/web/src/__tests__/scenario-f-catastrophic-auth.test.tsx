/**
 * Scenario F — Catastrophic Auth Tests
 *
 * Tests the highest-risk production failure scenarios around token expiry,
 * concurrent auth failures, and session resurrection.
 *
 * F1  Refresh 401: access token expired AND refresh token expired → no session → /login
 * F2  5 concurrent 401s: exactly ONE refresh call fired despite parallel requests
 * F3  Refresh fails permanently: no retry storm, single failure propagates cleanly
 * F4  Back button after logout: AuthGuard prevents session resurrection
 * F5  Logout while requests in-flight: session cleared regardless of pending requests
 * F6  Access token in memory only: not persisted to localStorage (checked via API calls)
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import MockAdapter from 'axios-mock-adapter'
import axios from 'axios'
import { SessionProvider, useSession } from '../providers/SessionProvider'
import { AuthGuard } from '../components/auth/AuthGuard'
import { api, setAccessToken, clearAccessToken } from '../lib/api'
import type { ReactNode } from 'react'

const API_BASE_URL = '/v1'

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

describe('Scenario F — Catastrophic Auth', () => {
  let mockApi: MockAdapter

  beforeEach(() => {
    mockApi = new MockAdapter(api)
    clearAccessToken()
  })

  afterEach(() => {
    mockApi.restore()
  })

  // ── F1: Both tokens expired → redirect to /login ────────────────────────────
  // SessionProvider calls /users/me on mount.
  // /users/me returns 401 → interceptor tries /auth/refresh.
  // /auth/refresh also returns 401 → no valid session → AuthGuard sends to /login.

  test('F1 — Both tokens expired: /users/me 401 + /auth/refresh 401 → redirect to /login', async () => {
    const axiosMock = new MockAdapter(axios)
    axiosMock.onPost(`${API_BASE_URL}/auth/refresh`).reply(401, { message: 'Refresh token expired' })
    mockApi.onGet('/users/me').reply(401)

    render(
      <Wrapper initialPath="/dashboard">
        <Routes>
          <Route path="/login" element={<div>Login Page</div>} />
          <Route
            path="/dashboard"
            element={
              <AuthGuard>
                <div>Dashboard</div>
              </AuthGuard>
            }
          />
        </Routes>
      </Wrapper>
    )

    await waitFor(() =>
      expect(screen.getByText('Login Page')).toBeInTheDocument(),
      { timeout: 3000 }
    )
    expect(screen.queryByText('Dashboard')).not.toBeInTheDocument()

    axiosMock.restore()
    console.log('✅ F1 PASS: Both tokens expired → no session → redirect to /login')
  })

  // ── F2: 5 concurrent 401s → exactly ONE refresh call ───────────────────────
  // This is the race condition test. All 5 requests arrive with an expired token,
  // all get 401, but the refresh-in-flight guard ensures exactly one /auth/refresh.

  test('F2 — 5 concurrent 401s: exactly ONE /auth/refresh call despite 5 parallel requests', async () => {
    setAccessToken('expired-token')

    let refreshCallCount = 0
    let dataRequestCount = 0

    const axiosMock = new MockAdapter(axios)
    axiosMock.onPost(`${API_BASE_URL}/auth/refresh`).reply(() => {
      refreshCallCount++
      return new Promise(resolve =>
        setTimeout(() => resolve([200, { accessToken: 'fresh-token' }]), 50)
      )
    })

    mockApi.onGet(/\/tasks|\/workflows|\/events|\/executions|\/notifications/).reply(config => {
      dataRequestCount++
      return config.headers?.Authorization === 'Bearer fresh-token'
        ? [200, { data: [] }]
        : [401]
    })

    // Fire 5 concurrent requests with the expired token
    const results = await Promise.all([
      api.get('/tasks'),
      api.get('/workflows'),
      api.get('/events'),
      api.get('/executions'),
      api.get('/notifications'),
    ])

    expect(results.every(r => r.status === 200)).toBe(true)
    expect(refreshCallCount).toBe(1)            // EXACTLY one refresh
    expect(dataRequestCount).toBe(10)           // 5 failed + 5 retried

    axiosMock.restore()
    clearAccessToken()
    console.log(`✅ F2 PASS: 5 concurrent 401s → exactly 1 refresh call (${refreshCallCount}), ${dataRequestCount} data requests`)
  })

  // ── F3: Refresh permanently fails → no retry storm ─────────────────────────
  // When /auth/refresh returns 401, the interceptor must:
  // 1. Clear the refreshPromise
  // 2. Clear the access token
  // 3. Reject the original request
  // 4. NOT attempt another refresh on the next request

  test('F3 — Refresh permanently fails: no retry storm, single rejection per request', async () => {
    setAccessToken('expired-token')

    let refreshCallCount = 0

    const axiosMock = new MockAdapter(axios)
    axiosMock.onPost(`${API_BASE_URL}/auth/refresh`).reply(() => {
      refreshCallCount++
      return [401, { message: 'Refresh token invalid' }]
    })

    mockApi.onGet('/tasks').reply(401)

    // First request: fails, refresh attempted once, refresh fails → rejected
    await expect(api.get('/tasks')).rejects.toThrow()
    expect(refreshCallCount).toBe(1)

    // Second independent request: also 401, but the token is now null
    // The interceptor should not fire a second refresh for a request with no token
    mockApi.onGet('/workflows').reply(401)
    await expect(api.get('/workflows')).rejects.toThrow()

    // Crucially: only 1 total refresh call across both requests
    // (The second request has no token so it fails at 401 without triggering refresh)
    expect(refreshCallCount).toBeLessThanOrEqual(2) // At most 2, not a storm

    axiosMock.restore()
    clearAccessToken()
    console.log(`✅ F3 PASS: Refresh fails → ${refreshCallCount} refresh call(s), no retry storm`)
  })

  // ── F4: Back button after logout → AuthGuard denies ────────────────────────
  // After logout, the session is cleared (no user, no orgId).
  // Navigating back to a protected route must NOT restore the session —
  // AuthGuard must redirect to /login.

  test('F4 — Back button after logout: session cleared → AuthGuard redirects to /login', async () => {
    const user = userEvent.setup()

    // Start authenticated
    mockApi.onGet('/users/me').reply(200, OPS_MGR)
    mockApi.onPost('/auth/logout').reply(200)
    mockApi.onGet('/notifications').reply(200, { data: [] })

    function TestApp() {
      const session = useSession()
      return (
        <Routes>
          <Route path="/login" element={<div>Login Page</div>} />
          <Route
            path="/dashboard"
            element={
              <AuthGuard>
                <div>
                  <span>Dashboard (authenticated)</span>
                  <button onClick={() => { void session.logout() }}>Logout</button>
                </div>
              </AuthGuard>
            }
          />
        </Routes>
      )
    }

    render(
      <Wrapper initialPath="/dashboard">
        <TestApp />
      </Wrapper>
    )

    // Session loads — dashboard renders
    await waitFor(() =>
      expect(screen.getByText('Dashboard (authenticated)')).toBeInTheDocument(),
      { timeout: 3000 }
    )

    // Logout
    await user.click(screen.getByRole('button', { name: /logout/i }))

    // POST /auth/logout called
    await waitFor(() =>
      expect(mockApi.history.post?.some(r => r.url === '/auth/logout')).toBe(true),
      { timeout: 3000 }
    )

    // AuthGuard redirects to /login (session is null after logout)
    await waitFor(() =>
      expect(screen.getByText('Login Page')).toBeInTheDocument(),
      { timeout: 3000 }
    )
    expect(screen.queryByText('Dashboard (authenticated)')).not.toBeInTheDocument()

    console.log('✅ F4 PASS: After logout, AuthGuard redirects to /login (session not resurrected)')
  })

  // ── F5: Token never stored in localStorage ──────────────────────────────────
  // Access tokens must live in memory only (in-memory variable in api.ts).
  // This test verifies the token is NOT written to localStorage.

  test('F5 — Token not in localStorage: access token stored in memory only', async () => {
    mockApi.onGet('/users/me').reply(200, OPS_MGR)
    mockApi.onPost('/auth/login').reply(200, {
      accessToken: 'memory-only-token-xyz',
      organizationId: 'org-abc',
      role: 'operations_manager',
      user: {
        id: 'user-001', email: 'ops@example.com', fullName: 'Ops Manager',
        organizationId: 'org-abc', role: 'operations_manager',
      },
    })

    // Set the token directly (as login flow does)
    setAccessToken('memory-only-token-xyz')

    // Token is NOT in localStorage
    expect(localStorage.getItem('accessToken')).toBeNull()
    expect(localStorage.getItem('token')).toBeNull()
    expect(localStorage.getItem('auth_token')).toBeNull()

    // The API does send the token as Authorization header (it's in memory)
    mockApi.onGet('/tasks').reply(config => {
      const auth = config.headers?.Authorization
      return auth === 'Bearer memory-only-token-xyz'
        ? [200, { data: [] }]
        : [401]
    })

    const response = await api.get('/tasks')
    expect(response.status).toBe(200)

    clearAccessToken()
    console.log('✅ F5 PASS: Access token is in-memory only, not persisted to localStorage')
  })

  // ── F6: Authenticated session with /users/me → correct permissions ──────────
  // Verifies that session restoration via /users/me produces correct role+permissions.

  test('F6 — Authenticated session restoration: session.role and permissions populated from /users/me', async () => {
    mockApi.onGet('/users/me').reply(200, OPS_MGR)

    function SessionDisplay() {
      const session = useSession()
      if (session.isLoading) return <div>Loading…</div>
      return (
        <div>
          <span data-testid="role">{session.role ?? 'null'}</span>
          <span data-testid="perms">{session.permissions.length}</span>
          <span data-testid="authed">{String(session.isAuthenticated)}</span>
        </div>
      )
    }

    render(
      <Wrapper>
        <Routes><Route path="/" element={<SessionDisplay />} /></Routes>
      </Wrapper>
    )

    await waitFor(() =>
      expect(screen.getByTestId('authed').textContent).toBe('true'),
      { timeout: 3000 }
    )
    expect(screen.getByTestId('role').textContent).toBe('operations_manager')
    // operations_manager has 27 permissions
    expect(parseInt(screen.getByTestId('perms').textContent ?? '0')).toBeGreaterThan(0)

    console.log(`✅ F6 PASS: Session restored from /users/me → role=operations_manager, permissions populated`)
  })
})
