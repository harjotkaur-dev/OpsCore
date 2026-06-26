/**
 * Phase 12.1 — Operations Command Center Dashboard
 *
 * All data comes from GET /v1/dashboard/summary (single aggregated endpoint).
 * No hardcoded numbers. No mock data. Everything reflects real database state.
 */
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useSession } from '../../providers/SessionProvider'
import { dashboardApi } from './dashboardApi'
import type { DashboardExecution, DashboardNotification, DashboardAuditLog } from './dashboardApi'

// ── Query key ─────────────────────────────────────────────────────────────────

const DASHBOARD_QUERY_KEY = (orgId: string) => ['dashboard', orgId, 'summary'] as const

// ── Shared UI primitives ──────────────────────────────────────────────────────

function StatusDot({ status }: { status: string }) {
  const colors: Record<string, string> = {
    completed: 'bg-green-500',
    running: 'bg-blue-500',
    failed: 'bg-red-500',
    queued: 'bg-gray-400',
    pending: 'bg-gray-400',
    in_progress: 'bg-blue-500',
    cancelled: 'bg-red-400',
  }
  return (
    <span
      className={`inline-block h-2 w-2 flex-shrink-0 rounded-full ${colors[status] ?? 'bg-gray-300'}`}
      aria-hidden="true"
    />
  )
}

function StatusPill({ status }: { status: string }) {
  const styles: Record<string, string> = {
    completed: 'bg-green-50 text-green-700 ring-green-200',
    running: 'bg-blue-50 text-blue-700 ring-blue-200',
    failed: 'bg-red-50 text-red-700 ring-red-200',
    queued: 'bg-gray-50 text-gray-600 ring-gray-200',
    pending: 'bg-gray-50 text-gray-600 ring-gray-200',
    in_progress: 'bg-blue-50 text-blue-700 ring-blue-200',
  }
  const labels: Record<string, string> = {
    completed: 'Completed', running: 'Running', failed: 'Failed',
    queued: 'Queued', pending: 'Pending', in_progress: 'In Progress',
  }
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${styles[status] ?? 'bg-gray-50 text-gray-600 ring-gray-200'}`}>
      {labels[status] ?? status}
    </span>
  )
}

function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="h-2 w-2 flex-shrink-0 rounded-full bg-gray-200" />
      <div className="h-3.5 w-2/3 animate-pulse rounded bg-gray-100" />
      <div className="ml-auto h-3.5 w-16 animate-pulse rounded bg-gray-100" />
    </div>
  )
}

// ── KPI stat card ─────────────────────────────────────────────────────────────

interface StatCardProps {
  label: string
  value: number | string
  sublabel?: string | undefined
  icon: string
  accent: 'blue' | 'green' | 'red' | 'yellow' | 'purple' | 'gray'
  onClick?: (() => void) | undefined
}

const ACCENT = {
  blue:   { card: 'border-blue-100 bg-blue-50',   value: 'text-blue-700',   icon: 'bg-blue-100 text-blue-600' },
  green:  { card: 'border-green-100 bg-green-50',  value: 'text-green-700',  icon: 'bg-green-100 text-green-600' },
  red:    { card: 'border-red-100 bg-red-50',      value: 'text-red-700',    icon: 'bg-red-100 text-red-600' },
  yellow: { card: 'border-yellow-100 bg-yellow-50',value: 'text-yellow-700', icon: 'bg-yellow-100 text-yellow-600' },
  purple: { card: 'border-purple-100 bg-purple-50',value: 'text-purple-700', icon: 'bg-purple-100 text-purple-600' },
  gray:   { card: 'border-gray-100 bg-gray-50',    value: 'text-gray-700',   icon: 'bg-gray-100 text-gray-500' },
}

function StatCard({ label, value, sublabel, icon, accent, onClick }: StatCardProps) {
  const a = ACCENT[accent]
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group flex flex-col gap-3 rounded-xl border p-4 text-left transition-shadow hover:shadow-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${a.card} ${onClick ? 'cursor-pointer' : 'cursor-default'}`}
    >
      <div className="flex items-center justify-between">
        <span className={`flex h-9 w-9 items-center justify-center rounded-lg text-lg ${a.icon}`}>
          {icon}
        </span>
      </div>
      <div>
        <p className={`text-3xl font-bold tabular-nums leading-none ${a.value}`}>{value}</p>
        <p className="mt-1 text-sm font-medium text-gray-600">{label}</p>
        {sublabel && <p className="mt-0.5 text-xs text-gray-400">{sublabel}</p>}
      </div>
    </button>
  )
}

// ── Section card wrapper ──────────────────────────────────────────────────────

function SectionCard({ title, viewAllTo, children, loading }: {
  title: string
  viewAllTo?: string
  children: ReactNode
  loading?: boolean
}) {
  const navigate = useNavigate()
  return (
    <div className="flex flex-col rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
        <h2 className="text-sm font-semibold text-gray-800">{title}</h2>
        {viewAllTo && (
          <button
            onClick={() => navigate(viewAllTo)}
            className="text-xs font-medium text-blue-600 hover:text-blue-700"
          >
            View all →
          </button>
        )}
      </div>
      <div className="flex-1 overflow-hidden">
        {loading ? (
          <div className="divide-y divide-gray-50">
            {Array.from({ length: 4 }).map((_, i) => <SkeletonRow key={i} />)}
          </div>
        ) : children}
      </div>
    </div>
  )
}

// ── Donut summary ─────────────────────────────────────────────────────────────
// Simple SVG donut without external charting libs — purely presentational.

function DonutSummary({ segments, total, label }: {
  segments: { value: number; color: string; name: string }[]
  total: number
  label: string
}) {
  const r = 36
  const cx = 44
  const cy = 44
  const circumference = 2 * Math.PI * r
  let offset = 0

  const arcs = segments.map(seg => {
    const pct = total > 0 ? seg.value / total : 0
    const dash = pct * circumference
    const gap = circumference - dash
    const arc = { ...seg, dash, gap, offset, pct }
    offset += dash
    return arc
  })

  return (
    <div className="flex items-center gap-4 p-4">
      <svg width="88" height="88" viewBox="0 0 88 88" aria-hidden="true">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#f3f4f6" strokeWidth="12" />
        {arcs.map((arc, i) => arc.value > 0 && (
          <circle
            key={i}
            cx={cx} cy={cy} r={r}
            fill="none"
            stroke={arc.color}
            strokeWidth="12"
            strokeDasharray={`${arc.dash} ${arc.gap}`}
            strokeDashoffset={-arc.offset + circumference * 0.25}
            strokeLinecap="butt"
          />
        ))}
        <text x={cx} y={cy - 4} textAnchor="middle" className="text-base font-bold" fontSize="14" fontWeight="700" fill="#111827">{total}</text>
        <text x={cx} y={cy + 11} textAnchor="middle" fontSize="9" fill="#6b7280">{label}</text>
      </svg>
      <div className="flex flex-col gap-1.5">
        {segments.map(seg => (
          <div key={seg.name} className="flex items-center gap-2 text-xs text-gray-600">
            <span className="h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{ backgroundColor: seg.color }} />
            <span className="font-medium" style={{ color: seg.color }}>{seg.value}</span>
            <span className="text-gray-500">{seg.name}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Queue status row ──────────────────────────────────────────────────────────

function QueueRow({ name, counts }: { name: string; counts: Record<string, number> }) {
  const waiting = counts['waiting'] ?? 0
  const active = counts['active'] ?? 0
  const failed = counts['failed'] ?? 0
  const isHealthy = failed === 0 && waiting < 20
  const isWarning = failed > 0 || waiting >= 20

  return (
    <tr className="border-b border-gray-50 last:border-0">
      <td className="px-4 py-2.5">
        <span className="font-mono text-xs text-gray-700">{name}</span>
      </td>
      <td className="px-4 py-2.5 text-center text-xs tabular-nums text-gray-600">{waiting}</td>
      <td className="px-4 py-2.5 text-center text-xs tabular-nums text-blue-600 font-medium">{active}</td>
      <td className="px-4 py-2.5 text-center text-xs tabular-nums text-red-600 font-medium">{failed}</td>
      <td className="px-4 py-2.5 text-right">
        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
          isWarning ? 'bg-yellow-50 text-yellow-700' : 'bg-green-50 text-green-700'
        }`}>
          <span className={`h-1.5 w-1.5 rounded-full ${isWarning ? 'bg-yellow-500' : 'bg-green-500'}`} />
          {isWarning ? 'Warning' : 'Healthy'}
        </span>
      </td>
    </tr>
  )
}

// ── Imports needed above ──────────────────────────────────────────────────────

import type { ReactNode } from 'react'

// ── Main page ─────────────────────────────────────────────────────────────────

export function DashboardPage() {
  const navigate = useNavigate()
  const { orgId, user } = useSession()

  const { data, isLoading } = useQuery({
    queryKey: DASHBOARD_QUERY_KEY(orgId ?? ''),
    queryFn: () => dashboardApi.getSummary(),
    enabled: !!orgId,
    staleTime: 30_000,
    refetchInterval: 30_000,
  })

  const summary = data?.summary
  const workflowHealth = data?.workflowHealth
  const taskOverview = data?.taskOverview
  const recentExecutions = data?.recentExecutions ?? []
  const recentNotifications = data?.recentNotifications ?? []
  const recentAuditLogs = data?.recentAuditLogs ?? []
  const queueStatus = data?.queueStatus ?? {}

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const firstName = user?.fullName?.split(' ')[0] ?? ''

  return (
    <div className="min-h-full bg-gray-50/50 px-4 py-6 sm:px-6">
      {/* Page header */}
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">
          {greeting}{firstName ? `, ${firstName}` : ''}
        </h1>
        <p className="mt-0.5 text-sm text-gray-500">
          Real-time overview of your platform operations and system health
        </p>
      </div>

      {/* ── KPI summary row ────────────────────────────────────── */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard
          label="Active Workflows"
          value={isLoading ? '—' : (summary?.activeWorkflows ?? 0)}
          icon="⚡"
          accent="blue"
          onClick={() => navigate('/workflows')}
        />
        <StatCard
          label="Running Executions"
          value={isLoading ? '—' : (summary?.runningExecutions ?? 0)}
          icon="▶"
          accent="green"
          onClick={() => navigate('/executions')}
        />
        <StatCard
          label="Failed Executions"
          value={isLoading ? '—' : (summary?.failedExecutions ?? 0)}
          sublabel={summary?.failedExecutions ? 'need retry' : 'all clear'}
          icon="✕"
          accent={summary?.failedExecutions ? 'red' : 'gray'}
          onClick={() => navigate('/executions/failed')}
        />
        <StatCard
          label="Open Tasks"
          value={isLoading ? '—' : (summary?.openTasks ?? 0)}
          sublabel={taskOverview?.overdue ? `${taskOverview.overdue} overdue` : undefined}
          icon="✓"
          accent={taskOverview?.overdue ? 'yellow' : 'purple'}
          onClick={() => navigate('/tasks')}
        />
        <StatCard
          label="KPI Alerts"
          value={isLoading ? '—' : (summary?.kpiAlerts ?? 0)}
          sublabel={summary?.kpiAlerts ? 'thresholds breached' : 'all thresholds met'}
          icon="⚠"
          accent={summary?.kpiAlerts ? 'red' : 'green'}
          onClick={() => navigate('/kpis')}
        />
      </div>

      {/* ── Middle row: Workflow Health + Task Overview + Queue Status ── */}
      <div className="mb-5 grid grid-cols-1 gap-4 lg:grid-cols-3">

        {/* Workflow Health */}
        <SectionCard title="Workflow Health" viewAllTo="/workflows" loading={isLoading}>
          {workflowHealth && (
            <DonutSummary
              total={workflowHealth.total}
              label="Total"
              segments={[
                { value: workflowHealth.active, color: '#22c55e', name: 'Active' },
                { value: workflowHealth.archived, color: '#d1d5db', name: 'Archived' },
              ]}
            />
          )}
          {!isLoading && !workflowHealth && (
            <p className="px-4 py-6 text-sm text-gray-400">No workflows yet</p>
          )}
        </SectionCard>

        {/* Task Overview */}
        <SectionCard title="Task Overview" viewAllTo="/tasks" loading={isLoading}>
          {taskOverview && (
            <DonutSummary
              total={taskOverview.total}
              label="Total"
              segments={[
                { value: taskOverview.overdue, color: '#ef4444', name: 'Overdue' },
                { value: taskOverview.inProgress, color: '#3b82f6', name: 'In Progress' },
                { value: taskOverview.pending, color: '#9ca3af', name: 'Pending' },
                { value: taskOverview.completed, color: '#22c55e', name: 'Completed' },
              ]}
            />
          )}
          {!isLoading && !taskOverview && (
            <p className="px-4 py-6 text-sm text-gray-400">No tasks yet</p>
          )}
        </SectionCard>

        {/* Queue Status */}
        <SectionCard title="Queue Status" loading={isLoading}>
          {Object.keys(queueStatus).length > 0 ? (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="px-4 py-2 text-left font-medium text-gray-500">Queue</th>
                  <th className="px-4 py-2 text-center font-medium text-gray-500">Wait</th>
                  <th className="px-4 py-2 text-center font-medium text-gray-500">Active</th>
                  <th className="px-4 py-2 text-center font-medium text-gray-500">Failed</th>
                  <th className="px-4 py-2 text-right font-medium text-gray-500">Status</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(queueStatus).map(([name, counts]) => (
                  <QueueRow key={name} name={name} counts={counts} />
                ))}
              </tbody>
            </table>
          ) : (
            <p className="px-4 py-6 text-sm text-gray-400">Queue data unavailable</p>
          )}
        </SectionCard>
      </div>

      {/* ── Bottom row: Recent Executions + Recent Notifications + Audit Activity ── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">

        {/* Recent Executions */}
        <SectionCard title="Recent Executions" viewAllTo="/executions" loading={isLoading}>
          {recentExecutions.length === 0 ? (
            <p className="px-4 py-6 text-sm text-gray-400">No executions yet</p>
          ) : (
            <ul className="divide-y divide-gray-50">
              {recentExecutions.map((exec: DashboardExecution) => (
                <li
                  key={exec.id}
                  className="flex cursor-pointer items-center gap-3 px-4 py-3 hover:bg-gray-50"
                  onClick={() => navigate(`/executions/${exec.id}`)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={e => { if (e.key === 'Enter') navigate(`/executions/${exec.id}`) }}
                  aria-label={`View execution for ${exec.workflowName}`}
                >
                  <StatusDot status={exec.status} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-gray-800">{exec.workflowName}</p>
                    <p className="text-xs text-gray-400">
                      {exec.startedAt
                        ? new Date(exec.startedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                        : new Date(exec.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                      }
                    </p>
                  </div>
                  <StatusPill status={exec.status} />
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        {/* Recent Notifications */}
        <SectionCard title="Recent Notifications" viewAllTo="/notifications" loading={isLoading}>
          {recentNotifications.length === 0 ? (
            <p className="px-4 py-6 text-sm text-gray-400">No notifications</p>
          ) : (
            <ul className="divide-y divide-gray-50">
              {recentNotifications.map((notif: DashboardNotification) => (
                <li
                  key={notif.id}
                  className="flex cursor-pointer items-start gap-3 px-4 py-3 hover:bg-gray-50"
                  onClick={() => navigate('/notifications')}
                  role="button"
                  tabIndex={0}
                  onKeyDown={e => { if (e.key === 'Enter') navigate('/notifications') }}
                >
                  {!notif.isRead && (
                    <span className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full bg-blue-500" aria-label="Unread" />
                  )}
                  <div className={`min-w-0 flex-1 ${notif.isRead ? 'ml-5' : ''}`}>
                    <p className={`line-clamp-2 text-sm ${notif.isRead ? 'text-gray-600' : 'font-medium text-gray-800'}`}>
                      {notif.message}
                    </p>
                    <p className="mt-0.5 text-xs text-gray-400">
                      {new Date(notif.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        {/* Audit Activity */}
        <SectionCard title="Audit Activity" viewAllTo="/audit-logs" loading={isLoading}>
          {recentAuditLogs.length === 0 ? (
            <p className="px-4 py-6 text-sm text-gray-400">No audit activity</p>
          ) : (
            <ul className="divide-y divide-gray-50">
              {recentAuditLogs.map((log: DashboardAuditLog) => (
                <li key={log.id} className="px-4 py-3">
                  <p className="text-sm text-gray-700">
                    <span className="font-medium capitalize">{log.action}</span>
                    {' '}
                    <span className="text-gray-500">{log.entityType}</span>
                  </p>
                  <p className="mt-0.5 text-xs text-gray-400">
                    {new Date(log.timestamp).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>
    </div>
  )
}
