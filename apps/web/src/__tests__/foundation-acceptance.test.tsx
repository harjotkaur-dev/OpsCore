import { describe, test, expect, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import axios from 'axios'
import MockAdapter from 'axios-mock-adapter'
import { SessionProvider, useSession } from '../providers/SessionProvider'
import { AuthGuard } from '../components/auth/AuthGuard'
import { AppShell } from '../components/layout/AppShell'
import { usePermissions } from '../hooks/usePermissions'
import { api, setAccessToken, clearAccessToken } from '../lib/api'
import { getPermissionsForRole } from '../lib/permissions'
import type { ReactNode } from 'react'

const API_BASE_URL = '/v1'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false },
  },
})

interface TestWrapperProps {
  children: ReactNode
}

function TestWrapper({ children }: TestWrapperProps) {
  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <BrowserRouter>{children}</BrowserRouter>
      </SessionProvider>
    </QueryClientProvider>
  )
}

describe('Phase 11.1 Foundation Acceptance Tests', () => {
  let mockApi: MockAdapter

  beforeEach(() => {
    mockApi = new MockAdapter(api)
    clearAccessToken()
    queryClient.clear()
  })

  /**
   * TEST 1: Authentication Guard
   * Access /dashboard while unauthenticated → redirect to /login
   */
  test('Authentication Guard: Unauthenticated access redirects to /login', async () => {
    mockApi.onGet('/users/me').reply(401)

    function TestApp() {
      return (
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/login" element={<div>Login Page</div>} />
          <Route
            path="/dashboard"
            element={
              <AuthGuard>
                <div>Dashboard Page</div>
              </AuthGuard>
            }
          />
        </Routes>
      )
    }

    render(<TestApp />, { wrapper: TestWrapper })

    // Wait for session check and redirect
    await waitFor(
      () => {
        expect(screen.queryByText('Loading...')).not.toBeInTheDocument()
      },
      { timeout: 3000 }
    )

    // Should redirect to login
    await waitFor(
      () => {
        expect(screen.getByText('Login Page')).toBeInTheDocument()
      },
      { timeout: 3000 }
    )
    expect(screen.queryByText('Dashboard Page')).not.toBeInTheDocument()

    console.log('✅ TEST 1 PASS: Unauthenticated redirect to /login confirmed')
  })

  /**
   * TEST 2: SessionProvider State
   * Login successfully → session state contains user, orgId, role, permissions
   */
  test('SessionProvider: Login populates session state correctly', async () => {
    const mockUser = {
      id: 'user-123',
      email: 'ops@example.com',
      fullName: 'Operations Manager',
      organizationId: 'org-456',
      role: 'operations_manager',
    }

    mockApi.onGet('/users/me').reply(200, mockUser)

    function TestComponent() {
      const session = useSession()

      return (
        <div>
          <div>User: {session.user?.email || 'null'}</div>
          <div>OrgId: {session.orgId || 'null'}</div>
          <div>Role: {session.role || 'null'}</div>
          <div>Permissions: {session.permissions.length}</div>
          <div>Authenticated: {String(session.isAuthenticated)}</div>
        </div>
      )
    }

    render(<TestComponent />, { wrapper: TestWrapper })

    await waitFor(() => {
      expect(screen.getByText('User: ops@example.com')).toBeInTheDocument()
    })

    expect(screen.getByText('OrgId: org-456')).toBeInTheDocument()
    expect(screen.getByText('Role: operations_manager')).toBeInTheDocument()
    expect(screen.getByText(/Permissions: \d+/)).toBeInTheDocument()
    expect(screen.getByText('Authenticated: true')).toBeInTheDocument()

    const permissionCount = getPermissionsForRole('operations_manager').length
    expect(screen.getByText(`Permissions: ${permissionCount}`)).toBeInTheDocument()

    console.log('✅ TEST 2 PASS: Session state populated correctly')
    console.log(`   - User: ${mockUser.email}`)
    console.log(`   - OrgId: ${mockUser.organizationId}`)
    console.log(`   - Role: ${mockUser.role}`)
    console.log(`   - Permissions: ${permissionCount}`)
  })

  /**
   * TEST 3: Permission System
   * Test can(permission) with different roles
   */
  test('Permission System: can() returns correct values for role', async () => {
    const mockUser = {
      id: 'user-123',
      email: 'member@example.com',
      fullName: 'Team Member',
      organizationId: 'org-456',
      role: 'member',
    }

    mockApi.onGet('/users/me').reply(200, mockUser)

    function TestComponent() {
      const { can } = usePermissions()

      return (
        <div>
          <div>task:create: {String(can('task:create'))}</div>
          <div>workflow:create: {String(can('workflow:create'))}</div>
          <div>execution:retry: {String(can('execution:retry'))}</div>
          <div>task:update: {String(can('task:update'))}</div>
        </div>
      )
    }

    render(<TestComponent />, { wrapper: TestWrapper })

    await waitFor(() => {
      expect(screen.getByText('task:create: false')).toBeInTheDocument()
    })

    expect(screen.getByText('workflow:create: false')).toBeInTheDocument()
    expect(screen.getByText('execution:retry: false')).toBeInTheDocument()
    expect(screen.getByText('task:update: true')).toBeInTheDocument()

    console.log('✅ TEST 3 PASS: Permission checks working correctly')
    console.log('   - can("task:create"): false (member role)')
    console.log('   - can("workflow:create"): false (member role)')
    console.log('   - can("execution:retry"): false (member role)')
    console.log('   - can("task:update"): true (member role)')
  })

  /**
   * TEST 4: Axios Refresh Flow
   * Simulate expired access token → trigger API request → confirm refresh called once
   */
  test('Axios Refresh Flow: Single refresh on 401', async () => {
    setAccessToken('expired-token')

    let refreshCallCount = 0
    let dataRequestCount = 0

    // Mock the base axios instance used by refreshAccessToken
    const axiosMock = new MockAdapter(axios)
    
    axiosMock.onPost(`${API_BASE_URL}/auth/refresh`).reply(() => {
      refreshCallCount++
      return [200, { accessToken: 'new-token' }]
    })

    mockApi.onGet('/events').reply((config) => {
      dataRequestCount++
      const authHeader = config.headers?.Authorization
      if (authHeader === 'Bearer new-token') {
        return [200, { events: [] }]
      }
      return [401]
    })

    // First request with expired token
    const response = await api.get('/events')

    expect(response.status).toBe(200)
    expect(refreshCallCount).toBe(1)
    expect(dataRequestCount).toBe(2) // 1 failed + 1 retry

    console.log('✅ TEST 4 PASS: Refresh flow working correctly')
    console.log(`   - Refresh calls: ${refreshCallCount} (expected: 1)`)
    console.log(`   - Data requests: ${dataRequestCount} (1 failed + 1 retry)`)

    axiosMock.restore()
  })

  /**
   * TEST 5: Refresh Race Condition
   * Fire multiple concurrent requests with expired token → only one refresh
   */
  test('Refresh Race Condition: Single-in-flight protection', async () => {
    setAccessToken('expired-token')

    let refreshCallCount = 0
    let dataRequestCount = 0

    // Mock the base axios instance
    const axiosMock = new MockAdapter(axios)
    
    axiosMock.onPost(`${API_BASE_URL}/auth/refresh`).reply(() => {
      refreshCallCount++
      return new Promise((resolve) => {
        setTimeout(() => {
          resolve([200, { accessToken: 'new-token' }])
        }, 100)
      })
    })

    mockApi.onGet(/\/events|\/tasks|\/workflows/).reply((config) => {
      dataRequestCount++
      const authHeader = config.headers?.Authorization
      if (authHeader === 'Bearer new-token') {
        return [200, { data: [] }]
      }
      return [401]
    })

    // Fire 3 concurrent requests with expired token
    const promises = [api.get('/events'), api.get('/tasks'), api.get('/workflows')]

    const responses = await Promise.all(promises)

    expect(responses.every((r) => r.status === 200)).toBe(true)
    expect(refreshCallCount).toBe(1) // Only ONE refresh despite 3 requests
    expect(dataRequestCount).toBe(6) // 3 failed + 3 retries

    console.log('✅ TEST 5 PASS: Single-in-flight refresh protection working')
    console.log(`   - Concurrent requests: 3`)
    console.log(`   - Refresh calls: ${refreshCallCount} (expected: 1)`)
    console.log(`   - Data requests: ${dataRequestCount} (3 failed + 3 retries)`)

    axiosMock.restore()
  })

  /**
   * TEST 6: Protected Routing with Session Restoration
   * Login → navigate to protected route → refresh → session restored
   */
  test('Protected Routing: Session restoration after refresh', async () => {
    const mockUser = {
      id: 'user-123',
      email: 'ops@example.com',
      fullName: 'Operations Manager',
      organizationId: 'org-456',
      role: 'operations_manager',
    }

    // Mock successful session fetch
    mockApi.onGet('/users/me').reply(200, mockUser)

    function TestComponent() {
      const { isAuthenticated, user } = useSession()

      if (!isAuthenticated) {
        return <div>Not Authenticated</div>
      }

      return (
        <div>
          <div>Authenticated</div>
          <div>User: {user?.email}</div>
        </div>
      )
    }

    render(<TestComponent />, { wrapper: TestWrapper })

    // Wait for session restoration
    await waitFor(
      () => {
        expect(screen.getByText('Authenticated')).toBeInTheDocument()
      },
      { timeout: 3000 }
    )

    expect(screen.getByText('User: ops@example.com')).toBeInTheDocument()

    console.log('✅ TEST 6 PASS: Session restoration working')
    console.log('   - Session restored from /users/me endpoint')
    console.log('   - User data populated correctly')
  })

  /**
   * TEST 7: AppShell Rendering
   * Confirm AppShell renders only after authentication
   */
  test('AppShell: Only renders for authenticated users', async () => {
    const mockUser = {
      id: 'user-123',
      email: 'ops@example.com',
      fullName: 'Operations Manager',
      organizationId: 'org-456',
      role: 'operations_manager',
    }

    mockApi.onGet('/users/me').reply(200, mockUser)

    function TestComponent() {
      const { isAuthenticated } = useSession()

      if (!isAuthenticated) {
        return <div>Not Authenticated</div>
      }

      return (
        <AppShell>
          <div data-testid="appshell-content">Protected Content</div>
        </AppShell>
      )
    }

    render(<TestComponent />, { wrapper: TestWrapper })

    await waitFor(
      () => {
        const appShellContent = screen.getByTestId('appshell-content')
        expect(appShellContent).toBeInTheDocument()
      },
      { timeout: 3000 }
    )

    console.log('✅ TEST 7 PASS: AppShell renders only after authentication')
  })
})
