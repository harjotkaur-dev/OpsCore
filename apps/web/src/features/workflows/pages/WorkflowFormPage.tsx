import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useSession } from '../../../providers/SessionProvider'
import { queryKeys } from '../../../lib/queryKeys'
import { workflowsApi } from '../api/workflowsApi'
import type { ActionType } from '../types/workflow'

interface RuleRow {
  expression: string
  description: string
}

interface ActionRow {
  actionType: ActionType
  config: string // JSON string edited in textarea
}

const ACTION_TYPE_OPTIONS: ActionType[] = [
  'create_task',
  'send_notification',
  'update_metric',
  'call_webhook',
]

export function WorkflowFormPage() {
  const navigate = useNavigate()
  const { orgId } = useSession()

  // Section 1 — Metadata
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [triggerEventTypeId, setTriggerEventTypeId] = useState('')

  // Section 2 — Rules
  const [rules, setRules] = useState<RuleRow[]>([])

  // Section 3 — Actions
  const [actions, setActions] = useState<ActionRow[]>([])

  // Submission state
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  // Load event types for trigger dropdown
  const { data: eventTypesData, isLoading: isLoadingEventTypes } = useQuery({
    queryKey: queryKeys.eventTypes.list(orgId ?? ''),
    queryFn: () => workflowsApi.listEventTypes(),
    enabled: !!orgId,
    staleTime: 60_000,
  })
  const eventTypes = eventTypesData?.data ?? []

  // --- Rule handlers ---
  const addRule = () => {
    setRules((prev) => [...prev, { expression: '', description: '' }])
  }

  const updateRule = (index: number, field: keyof RuleRow, value: string) => {
    setRules((prev) => prev.map((r, i) => (i === index ? { ...r, [field]: value } : r)))
  }

  const removeRule = (index: number) => {
    setRules((prev) => prev.filter((_, i) => i !== index))
  }

  // --- Action handlers ---
  const addAction = () => {
    setActions((prev) => [
      ...prev,
      { actionType: 'create_task', config: '{}' },
    ])
  }

  const updateAction = (index: number, field: keyof ActionRow, value: string) => {
    setActions((prev) => prev.map((a, i) => (i === index ? { ...a, [field]: value } : a)))
  }

  const removeAction = (index: number) => {
    setActions((prev) => prev.filter((_, i) => i !== index))
  }

  // --- Submit sequence ---
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitError(null)

    if (!name.trim()) {
      setSubmitError('Name is required.')
      return
    }
    if (!triggerEventTypeId) {
      setSubmitError('Trigger event type is required.')
      return
    }

    // Validate JSON configs before submitting
    for (let i = 0; i < actions.length; i++) {
      const action = actions[i]
      if (!action) continue
      try {
        JSON.parse(action.config)
      } catch {
        setSubmitError(`Action ${i + 1}: config is not valid JSON.`)
        return
      }
    }

    setIsSubmitting(true)

    try {
      // Step 1: Create the workflow
      const descriptionValue = description.trim()
      const workflowResult = await workflowsApi.create({
        name: name.trim(),
        ...(descriptionValue ? { description: descriptionValue } : {}),
        triggerEventTypeId,
      })
      const workflowId = workflowResult.data.id

      // Step 2: Create each rule
      for (const rule of rules) {
        if (!rule.expression.trim()) continue
        const ruleDesc = rule.description.trim()
        await workflowsApi.createRule(workflowId, {
          expression: rule.expression.trim(),
          ...(ruleDesc ? { description: ruleDesc } : {}),
        })
      }

      // Step 3: Create each action
      for (let i = 0; i < actions.length; i++) {
        const action = actions[i]
        if (!action) continue
        let parsedConfig: Record<string, unknown> = {}
        try {
          parsedConfig = JSON.parse(action.config) as Record<string, unknown>
        } catch {
          // Already validated above, but just in case
          parsedConfig = {}
        }
        await workflowsApi.createAction(workflowId, {
          actionType: action.actionType,
          orderIndex: i + 1,
          config: parsedConfig,
        })
      }

      // Step 4: Navigate to detail page
      navigate(`/workflows/${workflowId}`)
    } catch (err: unknown) {
      const axiosMessage =
        (err as { response?: { data?: { message?: string } } }).response?.data?.message
      const message =
        axiosMessage ??
        (err instanceof Error ? err.message : 'An unexpected error occurred. Please try again.')
      setSubmitError(message)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="mb-6">
        <Link to="/workflows" className="text-sm text-blue-600 hover:underline">
          ← Back to Workflows
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-gray-900">New Workflow</h1>
      </div>

      <form onSubmit={handleSubmit} noValidate>
        {/* ── Section 1: Metadata ── */}
        <section className="mb-8 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-medium text-gray-900">Metadata</h2>

          <div className="mb-4">
            <label htmlFor="name" className="mb-1 block text-sm font-medium text-gray-700">
              Name <span className="text-red-500">*</span>
            </label>
            <input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="e.g. Alert on high CPU"
            />
          </div>

          <div className="mb-4">
            <label htmlFor="description" className="mb-1 block text-sm font-medium text-gray-700">
              Description
            </label>
            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="Optional description…"
            />
          </div>

          <div>
            <label
              htmlFor="triggerEventTypeId"
              className="mb-1 block text-sm font-medium text-gray-700"
            >
              Trigger Event Type <span className="text-red-500">*</span>
            </label>
            <select
              id="triggerEventTypeId"
              value={triggerEventTypeId}
              onChange={(e) => setTriggerEventTypeId(e.target.value)}
              required
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="">
                {isLoadingEventTypes ? 'Loading event types…' : '— Select event type —'}
              </option>
              {eventTypes.map((et) => (
                <option key={et.id} value={et.id}>
                  {et.name}
                </option>
              ))}
            </select>
          </div>
        </section>

        {/* ── Section 2: Rules ── */}
        <section className="mb-8 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-medium text-gray-900">Rules</h2>
            <button
              type="button"
              onClick={addRule}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
            >
              Add Rule
            </button>
          </div>

          {rules.length === 0 ? (
            <p className="text-sm text-gray-500">No rules added. Workflows without rules match all events.</p>
          ) : (
            <div className="space-y-3">
              {rules.map((rule, index) => (
                <div
                  key={index}
                  className="flex items-start gap-3 rounded-md border border-gray-100 bg-gray-50 p-3"
                >
                  <div className="flex-1">
                    <label
                      htmlFor={`rule-expression-${index}`}
                      className="mb-1 block text-xs font-medium text-gray-600"
                    >
                      Expression
                    </label>
                    <input
                      id={`rule-expression-${index}`}
                      type="text"
                      value={rule.expression}
                      onChange={(e) => updateRule(index, 'expression', e.target.value)}
                      className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      placeholder="e.g. event.payload.cpu > 90"
                    />
                  </div>
                  <div className="flex-1">
                    <label
                      htmlFor={`rule-description-${index}`}
                      className="mb-1 block text-xs font-medium text-gray-600"
                    >
                      Description
                    </label>
                    <input
                      id={`rule-description-${index}`}
                      type="text"
                      value={rule.description}
                      onChange={(e) => updateRule(index, 'description', e.target.value)}
                      className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      placeholder="Optional description"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => removeRule(index)}
                    className="mt-5 shrink-0 rounded px-2 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
                    aria-label={`Remove rule ${index + 1}`}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ── Section 3: Actions ── */}
        <section className="mb-8 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-medium text-gray-900">Actions</h2>
            <button
              type="button"
              onClick={addAction}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
            >
              Add Action
            </button>
          </div>

          {actions.length === 0 ? (
            <p className="text-sm text-gray-500">No actions added yet.</p>
          ) : (
            <div className="space-y-3">
              {actions.map((action, index) => (
                <div
                  key={index}
                  className="rounded-md border border-gray-100 bg-gray-50 p-3"
                >
                  <div className="mb-2 flex items-center gap-3">
                    <span className="shrink-0 text-xs font-medium text-gray-500">
                      #{index + 1}
                    </span>
                    <div className="flex-1">
                      <label
                        htmlFor={`action-type-${index}`}
                        className="mb-1 block text-xs font-medium text-gray-600"
                      >
                        Action Type
                      </label>
                      <select
                        id={`action-type-${index}`}
                        value={action.actionType}
                        onChange={(e) =>
                          updateAction(index, 'actionType', e.target.value)
                        }
                        className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      >
                        {ACTION_TYPE_OPTIONS.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeAction(index)}
                      className="mt-4 shrink-0 rounded px-2 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
                      aria-label={`Remove action ${index + 1}`}
                    >
                      Remove
                    </button>
                  </div>
                  <div>
                    <label
                      htmlFor={`action-config-${index}`}
                      className="mb-1 block text-xs font-medium text-gray-600"
                    >
                      Config (JSON)
                    </label>
                    <textarea
                      id={`action-config-${index}`}
                      value={action.config}
                      onChange={(e) => updateAction(index, 'config', e.target.value)}
                      rows={3}
                      className="w-full rounded border border-gray-300 px-2 py-1.5 font-mono text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      placeholder="{}"
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ── Error message ── */}
        {submitError && (
          <div className="mb-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
            {submitError}
          </div>
        )}

        {/* ── Submit ── */}
        <div className="flex items-center gap-4">
          <button
            type="submit"
            disabled={isSubmitting}
            className="rounded-md bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50"
          >
            {isSubmitting ? 'Creating…' : 'Create Workflow'}
          </button>
          <Link to="/workflows" className="text-sm text-gray-600 hover:text-gray-900">
            Cancel
          </Link>
        </div>
      </form>
    </div>
  )
}
