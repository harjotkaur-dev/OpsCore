import { useState } from 'react'
import { useNavigate, Link, Navigate } from 'react-router-dom'
import { useCreateTask } from '../hooks/useCreateTask'
import { usePermissions } from '../../../hooks/usePermissions'
import { useSession } from '../../../providers/SessionProvider'
import type { TaskPriority } from '../types/task'

export function TaskFormPage() {
  const navigate = useNavigate()
  const { isLoading: sessionLoading } = useSession()
  const { can } = usePermissions()
  const createTask = useCreateTask()

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState<TaskPriority>('medium')
  const [dueDate, setDueDate] = useState('')
  const [submitError, setSubmitError] = useState<string | null>(null)

  // Wait for session to load before checking permissions
  if (sessionLoading) {
    return <div className="py-12 text-center text-sm text-gray-500">Loading…</div>
  }

  // Gate: redirect if no create permission
  if (!can('task:create')) {
    return <Navigate to="/tasks" replace />
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitError(null)

    if (!title.trim()) {
      setSubmitError('Title is required.')
      return
    }

    const descriptionValue = description.trim()
    const dueDateValue = dueDate.trim()

    createTask.mutate(
      {
        title: title.trim(),
        ...(descriptionValue ? { description: descriptionValue } : {}),
        priority,
        ...(dueDateValue ? { dueDate: dueDateValue } : {}),
      },
      {
        onSuccess: (response) => {
          navigate(`/tasks/${response.data.id}`)
        },
        onError: (err: unknown) => {
          const axiosMessage =
            (err as { response?: { data?: { message?: string } } }).response?.data?.message
          const message =
            axiosMessage ??
            (err instanceof Error ? err.message : 'An unexpected error occurred. Please try again.')
          setSubmitError(message)
        },
      }
    )
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <div className="mb-6">
        <Link to="/tasks" className="text-sm text-blue-600 hover:underline">
          ← Back to Tasks
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-gray-900">New Task</h1>
      </div>

      <form
        onSubmit={handleSubmit}
        noValidate
        className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm"
      >
        {/* Title */}
        <div className="mb-4">
          <label htmlFor="title" className="mb-1 block text-sm font-medium text-gray-700">
            Title <span className="text-red-500">*</span>
          </label>
          <input
            id="title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            placeholder="e.g. Investigate CPU spike"
          />
        </div>

        {/* Description */}
        <div className="mb-4">
          <label htmlFor="description" className="mb-1 block text-sm font-medium text-gray-700">
            Description
          </label>
          <textarea
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            placeholder="Optional description…"
          />
        </div>

        {/* Priority */}
        <div className="mb-4">
          <label htmlFor="priority" className="mb-1 block text-sm font-medium text-gray-700">
            Priority <span className="text-red-500">*</span>
          </label>
          <select
            id="priority"
            value={priority}
            onChange={(e) => setPriority(e.target.value as TaskPriority)}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </select>
        </div>

        {/* Due Date */}
        <div className="mb-6">
          <label htmlFor="dueDate" className="mb-1 block text-sm font-medium text-gray-700">
            Due Date
          </label>
          <input
            id="dueDate"
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        {/* Error */}
        {submitError && (
          <div className="mb-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
            {submitError}
          </div>
        )}

        {/* Submit */}
        <div className="flex items-center gap-4">
          <button
            type="submit"
            disabled={createTask.isPending}
            className="rounded-md bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50"
          >
            {createTask.isPending ? 'Creating…' : 'Create Task'}
          </button>
          <Link to="/tasks" className="text-sm text-gray-600 hover:text-gray-900">
            Cancel
          </Link>
        </div>
      </form>
    </div>
  )
}
