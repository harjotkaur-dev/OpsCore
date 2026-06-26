import { api } from '../../../lib/api'
import type {
  Workflow,
  WorkflowRule,
  WorkflowAction,
  WorkflowListResponse,
  WorkflowRulesResponse,
  WorkflowActionsResponse,
  CreateWorkflowPayload,
  UpdateWorkflowPayload,
  CreateRulePayload,
  CreateActionPayload,
} from '../types/workflow'
import type { EventTypeListResponse } from '../../events/types/event'

export const workflowsApi = {
  /**
   * GET /v1/workflows — list all workflows for the org
   */
  list: async (): Promise<WorkflowListResponse> => {
    const response = await api.get<WorkflowListResponse>('/workflows')
    return response.data
  },

  /**
   * GET /v1/workflows/:id — get a single workflow
   */
  getById: async (id: string): Promise<{ data: Workflow }> => {
    const response = await api.get<{ data: Workflow }>(`/workflows/${id}`)
    return response.data
  },

  /**
   * POST /v1/workflows — create a new workflow
   */
  create: async (payload: CreateWorkflowPayload): Promise<{ data: Workflow }> => {
    const response = await api.post<{ data: Workflow }>('/workflows', payload)
    return response.data
  },

  /**
   * PATCH /v1/workflows/:id — update a workflow
   */
  update: async (id: string, payload: UpdateWorkflowPayload): Promise<{ data: Workflow }> => {
    const response = await api.patch<{ data: Workflow }>(`/workflows/${id}`, payload)
    return response.data
  },

  /**
   * POST /v1/workflows/:id/activate — activate a workflow
   */
  activate: async (id: string): Promise<{ data: Workflow }> => {
    const response = await api.post<{ data: Workflow }>(`/workflows/${id}/activate`)
    return response.data
  },

  /**
   * POST /v1/workflows/:id/deactivate — deactivate a workflow
   */
  deactivate: async (id: string): Promise<{ data: Workflow }> => {
    const response = await api.post<{ data: Workflow }>(`/workflows/${id}/deactivate`)
    return response.data
  },

  /**
   * DELETE /v1/workflows/:id — delete a workflow
   */
  delete: async (id: string): Promise<void> => {
    await api.delete(`/workflows/${id}`)
  },

  // --- Rules ---

  /**
   * GET /v1/workflows/:id/rules — list rules for a workflow
   */
  listRules: async (workflowId: string): Promise<WorkflowRulesResponse> => {
    const response = await api.get<WorkflowRulesResponse>(`/workflows/${workflowId}/rules`)
    return response.data
  },

  /**
   * POST /v1/workflows/:id/rules — add a rule to a workflow
   */
  createRule: async (
    workflowId: string,
    payload: CreateRulePayload
  ): Promise<{ data: WorkflowRule }> => {
    const response = await api.post<{ data: WorkflowRule }>(
      `/workflows/${workflowId}/rules`,
      payload
    )
    return response.data
  },

  /**
   * DELETE /v1/workflows/:id/rules/:ruleId — remove a rule
   */
  deleteRule: async (workflowId: string, ruleId: string): Promise<void> => {
    await api.delete(`/workflows/${workflowId}/rules/${ruleId}`)
  },

  // --- Actions ---

  /**
   * GET /v1/workflows/:id/actions — list actions for a workflow
   */
  listActions: async (workflowId: string): Promise<WorkflowActionsResponse> => {
    const response = await api.get<WorkflowActionsResponse>(`/workflows/${workflowId}/actions`)
    return response.data
  },

  /**
   * POST /v1/workflows/:id/actions — add an action to a workflow
   */
  createAction: async (
    workflowId: string,
    payload: CreateActionPayload
  ): Promise<{ data: WorkflowAction }> => {
    const response = await api.post<{ data: WorkflowAction }>(
      `/workflows/${workflowId}/actions`,
      payload
    )
    return response.data
  },

  /**
   * DELETE /v1/workflows/:id/actions/:actionId — remove an action
   */
  deleteAction: async (workflowId: string, actionId: string): Promise<void> => {
    await api.delete(`/workflows/${workflowId}/actions/${actionId}`)
  },

  /**
   * POST /v1/workflows/:id/actions/reorder — reorder actions
   */
  reorderActions: async (workflowId: string, actionIds: string[]): Promise<void> => {
    await api.post(`/workflows/${workflowId}/actions/reorder`, { actionIds })
  },

  // --- Event Types ---

  /**
   * GET /v1/event-types — list event types for trigger dropdown
   */
  listEventTypes: async (): Promise<EventTypeListResponse> => {
    const response = await api.get<EventTypeListResponse>('/event-types')
    return response.data
  },
}
