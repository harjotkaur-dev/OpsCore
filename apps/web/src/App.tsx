import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthGuard } from './components/auth/AuthGuard'
import { AppShell } from './components/layout/AppShell'
import { LoginPage } from './features/auth/pages/LoginPage'
import { RegisterPage } from './features/auth/pages/RegisterPage'
import { InviteAcceptPage } from './features/auth/pages/InviteAcceptPage'
import { DashboardPage } from './features/dashboard/DashboardPage'
import { EventsListPage } from './features/events/pages/EventsListPage'
import { EventDetailPage } from './features/events/pages/EventDetailPage'
import { EventTypesListPage } from './features/events/pages/EventTypesListPage'
import { EventIngestPage } from './features/events/pages/EventIngestPage'
import { WorkflowsListPage } from './features/workflows/pages/WorkflowsListPage'
import { WorkflowFormPage } from './features/workflows/pages/WorkflowFormPage'
import { WorkflowDetailPage } from './features/workflows/pages/WorkflowDetailPage'
import { TasksListPage } from './features/tasks/pages/TasksListPage'
import { TaskFormPage } from './features/tasks/pages/TaskFormPage'
import { TaskDetailPage } from './features/tasks/pages/TaskDetailPage'
import { ExecutionsListPage } from './features/executions/pages/ExecutionsListPage'
import { FailedExecutionsPage } from './features/executions/pages/FailedExecutionsPage'
import { ExecutionDetailPage } from './features/executions/pages/ExecutionDetailPage'
import { NotificationsPage } from './features/notifications/pages/NotificationsPage'
import { MetricsDashboardPage } from './features/metrics/pages/MetricsDashboardPage'
import { KPIsPage } from './features/metrics/pages/KPIsPage'

function DashboardPlaceholder() {
  return null // replaced by DashboardPage
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/accept-invite/:token" element={<InviteAcceptPage />} />
      <Route
        path="/"
        element={
          <AuthGuard>
            <AppShell>
              <Navigate to="/dashboard" replace />
            </AppShell>
          </AuthGuard>
        }
      />
      <Route
        path="/dashboard"
        element={
          <AuthGuard>
            <AppShell>
              <DashboardPage />
            </AppShell>
          </AuthGuard>
        }
      />
      <Route
        path="/events"
        element={
          <AuthGuard>
            <AppShell>
              <EventsListPage />
            </AppShell>
          </AuthGuard>
        }
      />
      <Route
        path="/events/ingest"
        element={
          <AuthGuard>
            <AppShell>
              <EventIngestPage />
            </AppShell>
          </AuthGuard>
        }
      />
      <Route
        path="/events/:id"
        element={
          <AuthGuard>
            <AppShell>
              <EventDetailPage />
            </AppShell>
          </AuthGuard>
        }
      />
      <Route
        path="/event-types"
        element={
          <AuthGuard>
            <AppShell>
              <EventTypesListPage />
            </AppShell>
          </AuthGuard>
        }
      />
      <Route
        path="/workflows"
        element={
          <AuthGuard>
            <AppShell>
              <WorkflowsListPage />
            </AppShell>
          </AuthGuard>
        }
      />
      <Route
        path="/workflows/new"
        element={
          <AuthGuard>
            <AppShell>
              <WorkflowFormPage />
            </AppShell>
          </AuthGuard>
        }
      />
      <Route
        path="/workflows/:id"
        element={
          <AuthGuard>
            <AppShell>
              <WorkflowDetailPage />
            </AppShell>
          </AuthGuard>
        }
      />
      <Route
        path="/tasks"
        element={
          <AuthGuard>
            <AppShell>
              <TasksListPage />
            </AppShell>
          </AuthGuard>
        }
      />
      <Route
        path="/tasks/new"
        element={
          <AuthGuard>
            <AppShell>
              <TaskFormPage />
            </AppShell>
          </AuthGuard>
        }
      />
      <Route
        path="/tasks/:id"
        element={
          <AuthGuard>
            <AppShell>
              <TaskDetailPage />
            </AppShell>
          </AuthGuard>
        }
      />
      <Route
        path="/executions"
        element={
          <AuthGuard>
            <AppShell>
              <ExecutionsListPage />
            </AppShell>
          </AuthGuard>
        }
      />
      <Route
        path="/executions/failed"
        element={
          <AuthGuard>
            <AppShell>
              <FailedExecutionsPage />
            </AppShell>
          </AuthGuard>
        }
      />
      <Route
        path="/executions/:id"
        element={
          <AuthGuard>
            <AppShell>
              <ExecutionDetailPage />
            </AppShell>
          </AuthGuard>
        }
      />
      <Route
        path="/notifications"
        element={
          <AuthGuard>
            <AppShell>
              <NotificationsPage />
            </AppShell>
          </AuthGuard>
        }
      />
      <Route
        path="/metrics"
        element={
          <AuthGuard>
            <AppShell>
              <MetricsDashboardPage />
            </AppShell>
          </AuthGuard>
        }
      />
      <Route
        path="/kpis"
        element={
          <AuthGuard>
            <AppShell>
              <KPIsPage />
            </AppShell>
          </AuthGuard>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
