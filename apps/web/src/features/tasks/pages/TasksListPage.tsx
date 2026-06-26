/**
 * Phase 12.3 — Tasks UX
 * Enhanced with: search, skeleton loading, priority left-border accent,
 * due date column, inline quick-filters, improved empty state.
 * Data from existing useTasks() hook — no new API calls.
 */
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTasks } from '../hooks/useTasks'
import { usePermissions } from '../../../hooks/usePermissions'
import type { TaskStatus, TaskPriority, Task } from '../types/task'

// ── Design tokens ─────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<TaskStatus, { badge: string; dot: string; label: string }> = {
  pending:     { badge: 'bg-gray-100 text-gray-600 ring-gray-200',     dot: 'bg-gray-400',   label: 'Pending' },
  in_progress: { badge: 'bg-blue-50 text-blue-700 ring-blue-200',      dot: 'bg-blue-500',   label: 'In Progress' },
  completed:   { badge: 'bg-green-50 text-green-700 ring-green-200',   dot: 'bg-green-500',  label: 'Completed' },
  cancelled:   { badge: 'bg-red-50 text-red-500 ring-red-200',         dot: 'bg-red-400',    label: 'Cancelled' },
}

const PRIORITY_STYLES: Record<TaskPriority, { accent: string; badge: string; label: string }> = {
  low:      { accent: 'border-l-gray-300',   badge: 'bg-gray-50 text-gray-500',      label: 'Low' },
  medium:   { accent: 'border-l-blue-300',   badge: 'bg-blue-50 text-blue-700',      label: 'Medium' },
  high:     { accent: 'border-l-orange-400', badge: 'bg-orange-50 text-orange-700',  label: 'High' },
  critical: { accent: 'border-l-red-500',    badge: 'bg-red-50 text-red-700',        label: 'Critical' },
}

// ── Shared badge atoms ────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: TaskStatus }) {
  const s = STATUS_STYLES[status]
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${s.badge}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} aria-hidden="true" />
      {s.label}
    </span>
  )
}

function PriorityBadge({ priority }: { priority: TaskPriority }) {
  const p = PRIORITY_STYLES[priority]
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${p.badge}`}>
      {p.label}
    </span>
  )
}

// ── Skeleton row ──────────────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <tr className="border-l-4 border-l-transparent">
      <td className="py-3 pl-5 pr-4"><div className="h-4 w-48 animate-pulse rounded bg-gray-100" /></td>
      <td className="px-4 py-3"><div className="h-5 w-20 animate-pulse rounded-full bg-gray-100" /></td>
      <td className="px-4 py-3"><div className="h-5 w-16 animate-pulse rounded-md bg-gray-100" /></td>
      <td className="px-4 py-3"><div className="h-4 w-24 animate-pulse rounded bg-gray-100" /></td>
      <td className="px-4 py-3"><div className="h-4 w-16 animate-pulse rounded bg-gray-100" /></td>
    </tr>
  )
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState({ hasFilters, onClear }: { hasFilters: boolean; onClear: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-gray-100">
        <svg className="h-6 w-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
        </svg>
      </div>
      <p className="text-sm font-medium text-gray-700">
        {hasFilters ? 'No tasks match your filters' : 'No tasks yet'}
      </p>
      <p className="mt-1 text-xs text-gray-500">
        {hasFilters ? 'Try adjusting your search or filter.' : 'Create your first task to get started.'}
      </p>
      {hasFilters && (
        <button onClick={onClear} className="mt-3 text-xs font-medium text-blue-600 hover:text-blue-700">
          Clear filters
        </button>
      )}
    </div>
  )
}

// ── Quick filter pill ─────────────────────────────────────────────────────────

function FilterPill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
        active
          ? 'bg-blue-600 text-white shadow-sm'
          : 'bg-white text-gray-600 ring-1 ring-gray-200 hover:bg-gray-50'
      }`}
    >
      {children}
    </button>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

export function TasksListPage() {
  const navigate = useNavigate()
  const { can } = usePermissions()

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<TaskStatus | ''>('')
  const [priorityFilter, setPriorityFilter] = useState<TaskPriority | ''>('')

  const filters: import('../types/task').TaskFilters = {}
  if (statusFilter) filters.status = statusFilter
  if (priorityFilter) filters.priority = priorityFilter

  const { data, isLoading, isError } = useTasks(
    Object.keys(filters).length > 0 ? filters : undefined
  )

  const allTasks = data?.data ?? []

  // Client-side search against title (already-fetched data)
  const tasks = search.trim()
    ? allTasks.filter(t => t.title.toLowerCase().includes(search.toLowerCase().trim()))
    : allTasks

  const hasFilters = !!statusFilter || !!priorityFilter || !!search.trim()

  const clearFilters = () => {
    setSearch('')
    setStatusFilter('')
    setPriorityFilter('')
  }

  return (
    <div className="flex h-full flex-col">
      {/* ── Page header ─────────────────────────────────────── */}
      <div className="border-b border-gray-200 bg-white px-6 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-gray-900">Task Center</h1>
            <p className="mt-0.5 text-xs text-gray-500">
              {isLoading ? 'Loading…' : `${tasks.length} task${tasks.length !== 1 ? 's' : ''}${hasFilters ? ' matching filters' : ''}`}
            </p>
          </div>
          {can('task:create') && (
            <button
              onClick={() => navigate('/tasks/new')}
              className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              New Task
            </button>
          )}
        </div>

        {/* ── Filter bar ──────────────────────────────────────── */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {/* Search */}
          <div className="relative">
            <svg className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search tasks…"
              className="w-52 rounded-lg border border-gray-200 py-1.5 pl-8 pr-3 text-sm text-gray-800 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              aria-label="Search tasks"
            />
          </div>

          {/* Status quick filters */}
          <div className="flex gap-1.5" role="group" aria-label="Filter by status">
            <FilterPill active={statusFilter === ''} onClick={() => setStatusFilter('')}>All</FilterPill>
            <FilterPill active={statusFilter === 'pending'} onClick={() => setStatusFilter('pending')}>Pending</FilterPill>
            <FilterPill active={statusFilter === 'in_progress'} onClick={() => setStatusFilter('in_progress')}>In Progress</FilterPill>
            <FilterPill active={statusFilter === 'completed'} onClick={() => setStatusFilter('completed')}>Completed</FilterPill>
          </div>

          {/* Priority select */}
          <select
            value={priorityFilter}
            onChange={e => setPriorityFilter(e.target.value as TaskPriority | '')}
            className="rounded-lg border border-gray-200 py-1.5 pl-3 pr-8 text-sm text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            aria-label="Filter by priority"
          >
            <option value="">All priorities</option>
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>

          {hasFilters && (
            <button onClick={clearFilters} className="text-xs font-medium text-gray-500 hover:text-gray-700">
              Clear ✕
            </button>
          )}
        </div>
      </div>

      {/* ── Table area ──────────────────────────────────────── */}
      <div className="flex-1 overflow-auto px-6 py-4">
        {isError && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            Failed to load tasks. Please try again.
          </div>
        )}

        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <table className="min-w-full">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="py-2.5 pl-5 pr-4 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Task</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Status</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Priority</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Due</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {isLoading ? (
                Array.from({ length: 6 }).map((_, i) => <SkeletonRow key={i} />)
              ) : tasks.length === 0 ? (
                <tr>
                  <td colSpan={5}>
                    <EmptyState hasFilters={hasFilters} onClear={clearFilters} />
                  </td>
                </tr>
              ) : (
                tasks.map((task: Task) => {
                  const p = PRIORITY_STYLES[task.priority]
                  const isOverdue = task.overdue && task.status !== 'completed' && task.status !== 'cancelled'
                  return (
                    <tr
                      key={task.id}
                      onClick={() => navigate(`/tasks/${task.id}`)}
                      className={`cursor-pointer border-l-4 transition-colors hover:bg-blue-50/30 ${p.accent}`}
                      aria-label={`View task ${task.title}`}
                    >
                      <td className="max-w-xs py-3 pl-4 pr-4">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium text-gray-900">{task.title}</span>
                          {isOverdue && (
                            <span className="flex-shrink-0 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                              Overdue
                            </span>
                          )}
                        </div>
                        {task.description && (
                          <p className="mt-0.5 truncate text-xs text-gray-400">{task.description}</p>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <StatusBadge status={task.status} />
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <PriorityBadge priority={task.priority} />
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-500">
                        {task.dueDate
                          ? <span className={isOverdue ? 'font-medium text-red-600' : ''}>{new Date(task.dueDate).toLocaleDateString()}</span>
                          : <span className="text-gray-300">—</span>
                        }
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-400">
                        {new Date(task.createdAt).toLocaleDateString()}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
