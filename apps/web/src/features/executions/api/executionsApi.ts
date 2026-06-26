import { api } from '../../../lib/api'
import type {
  Execution,
  ExecutionListResponse,
  ExecutionFilters,
} from '../types/execution'

export const executionsApi = {
  /**
   * GET /v1/executions — list executions with optional filters and cursor pagination
   */
  list: async (filters?: ExecutionFilters, cursor?: string): Promise<ExecutionListResponse> => {
    const params: Record<string, string> = {}
    if (filters?.status) params.status = filters.status
    if (filters?.workflowId) params.workflowId = filters.workflowId
    if (cursor) params.cursor = cursor

    const response = await api.get<ExecutionListResponse>('/executions', { params })
    return response.data
  },

  /**
   * GET /v1/executions/failed — list failed executions
   */
  listFailed: async (): Promise<ExecutionListResponse> => {
    const response = await api.get<ExecutionListResponse>('/executions/failed')
    return response.data
  },

  /**
   * GET /v1/executions/:id — get a single execution by id
   */
  getById: async (id: string): Promise<{ data: Execution }> => {
    const response = await api.get<{ data: Execution }>(`/executions/${id}`)
    return response.data
  },

  /**
   * POST /v1/executions/:id/retry — retry a failed execution
   */
  retry: async (id: string): Promise<{ data: Execution }> => {
    const response = await api.post<{ data: Execution }>(`/executions/${id}/retry`)
    return response.data
  },
}
