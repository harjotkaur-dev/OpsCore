import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useTask } from '../hooks/useTask'
import { useUpdateTaskStatus } from '../hooks/useUpdateTaskStatus'
import { useTaskComments } from '../hooks/useTaskComments'
import { useAddComment } from '../hooks/useAddComment'
import { usePermissions } from '../../../hooks/usePermissions'
import type { TaskStatus, TaskPriority } from '../types/task'

// ── Badge helpers ─────────────────────────────────────────────────────────────

const STATUS_BADGE: Record<TaskStatus, string> = {
  pending: 'bg-gray-100 text-gray-700',
  in_progress: 'bg-blue-100 text-blue-700',
  completed: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-400',
}

const STATUS_LABEL: Record<TaskStatus, string> = {
  pending: 'Pending',
  in_progress: 'In Progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
}

const PRIORITY_CHIP: Record<TaskPriority, string> = {
  low: 'bg-gray-100 text-gray-700',
  medium: 'bg-blue-100 text-blue-700',
  high: 'bg-orange-100 text-orange-700',
  critical: 'bg-red-100 text-red-700',
}

function StatusBadge({ status }: { status: TaskStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_BADGE[status]}`}
    >
      {STATUS_LABEL[status]}
    </span>
  )
}

function PriorityChip({ priority }: { priority: TaskPriority }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${PRIORITY_CHIP[priority]}`}
    >
      {priority}
    </span>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

export function TaskDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { can } = usePermissions()
  const taskId = id ?? ''

  const { data: taskData, isLoading, isError } = useTask(taskId)
  const { data: commentsData, isLoading: isLoadingComments } = useTaskComments(taskId)
  const updateStatus = useUpdateTaskStatus()
  const addComment = useAddComment()

  const [commentBody, setCommentBody] = useState('')

  const task = taskData?.data
  const comments = commentsData?.data ?? []

  // ── Status transition handlers ──
  const handleStatusChange = (status: 'in_progress' | 'completed' | 'cancelled') => {
    updateStatus.mutate({ taskId, payload: { status } })
  }

  // ── Add comment handler ──
  const handleAddComment = (e: React.FormEvent) => {
    e.preventDefault()
    if (!commentBody.trim()) return
    addComment.mutate(
      { taskId, payload: { body: commentBody.trim() } },
      { onSuccess: () => setCommentBody('') }
    )
  }

  // ── Loading / error states ──
  if (isLoading) {
    return <div className="py-12 text-center text-sm text-gray-500">Loading task…</div>
  }

  if (isError || !task) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <div className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
          Failed to load task. Please try again.
        </div>
        <div className="mt-4">
          <Link to="/tasks" className="text-sm text-blue-600 hover:underline">
            ← Back to Tasks
          </Link>
        </div>
      </div>
    )
  }

  const isOverdue = task.overdue && task.status !== 'completed' && task.status !== 'cancelled'
  const firstAssignment = task.assignments?.[0]

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      {/* Back link */}
      <div className="mb-6">
        <Link to="/tasks" className="text-sm text-blue-600 hover:underline">
          ← Back to Tasks
        </Link>
      </div>

      {/* Title & badges */}
      <div className="mb-6 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex-1">
            <h1 className="text-2xl font-semibold text-gray-900">{task.title}</h1>
            {task.description && (
              <p className="mt-2 text-sm text-gray-600">{task.description}</p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <StatusBadge status={task.status} />
            <PriorityChip priority={task.priority} />
            {isOverdue && (
              <span className="inline-flex items-center rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-700">
                Overdue
              </span>
            )}
          </div>
        </div>

        {/* Metadata */}
        <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
          {task.dueDate && (
            <div>
              <dt className="text-xs font-medium text-gray-500">Due Date</dt>
              <dd className="mt-1 text-sm text-gray-900">
                {new Date(task.dueDate).toLocaleDateString()}
              </dd>
            </div>
          )}
          <div>
            <dt className="text-xs font-medium text-gray-500">Created</dt>
            <dd className="mt-1 text-sm text-gray-900">
              {new Date(task.createdAt).toLocaleDateString()}
            </dd>
          </div>
          {firstAssignment && (
            <div>
              <dt className="text-xs font-medium text-gray-500">Assigned To</dt>
              <dd className="mt-1 text-sm text-gray-900">
                {firstAssignment.assigneeType === 'user'
                  ? `User: ${firstAssignment.userId ?? '—'}`
                  : `Team: ${firstAssignment.teamId ?? '—'}`}
              </dd>
            </div>
          )}
        </dl>
      </div>

      {/* Status transitions */}
      {can('task:update') && (
        <div className="mb-6 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <p className="mb-3 text-sm font-medium text-gray-700">Transition Status</p>
          <div className="flex flex-wrap gap-2">
            {task.status === 'pending' && (
              <>
                <button
                  onClick={() => handleStatusChange('in_progress')}
                  disabled={updateStatus.isPending}
                  className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {updateStatus.isPending ? 'Updating…' : 'Start'}
                </button>
                <button
                  onClick={() => handleStatusChange('cancelled')}
                  disabled={updateStatus.isPending}
                  className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  Cancel
                </button>
              </>
            )}
            {task.status === 'in_progress' && (
              <>
                <button
                  onClick={() => handleStatusChange('completed')}
                  disabled={updateStatus.isPending}
                  className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
                >
                  {updateStatus.isPending ? 'Updating…' : 'Complete'}
                </button>
                <button
                  onClick={() => handleStatusChange('cancelled')}
                  disabled={updateStatus.isPending}
                  className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  Cancel
                </button>
              </>
            )}
          </div>
          {updateStatus.isError && (
            <p className="mt-2 text-xs text-red-600">Failed to update status. Please try again.</p>
          )}
        </div>
      )}

      {/* Comments section */}
      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-base font-medium text-gray-900">Comments</h2>

        {isLoadingComments ? (
          <p className="text-sm text-gray-500">Loading comments…</p>
        ) : comments.length === 0 ? (
          <p className="text-sm text-gray-500">No comments yet.</p>
        ) : (
          <ul className="mb-6 space-y-4">
            {comments.map((comment) => {
              const authorName =
                comment.author?.fullName ?? comment.authorId.slice(0, 8) + '…'
              return (
                <li key={comment.id} className="border-b border-gray-100 pb-4 last:border-0 last:pb-0">
                  <div className="mb-1 flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-900">{authorName}</span>
                    <span className="text-xs text-gray-400">
                      {new Date(comment.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <p className="text-sm text-gray-700">{comment.body}</p>
                </li>
              )
            })}
          </ul>
        )}

        {/* Add comment form */}
        {can('task:comment') && (
          <form onSubmit={handleAddComment} noValidate>
            <label
              htmlFor="comment-body"
              className="mb-1 block text-sm font-medium text-gray-700"
            >
              Add a comment
            </label>
            <textarea
              id="comment-body"
              value={commentBody}
              onChange={(e) => setCommentBody(e.target.value)}
              rows={3}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="Write a comment…"
            />
            <div className="mt-2 flex items-center gap-3">
              <button
                type="submit"
                disabled={addComment.isPending || !commentBody.trim()}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {addComment.isPending ? 'Posting…' : 'Post Comment'}
              </button>
              {addComment.isError && (
                <span className="text-xs text-red-600">Failed to post comment.</span>
              )}
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
