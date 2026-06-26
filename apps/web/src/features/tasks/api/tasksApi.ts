import { api } from '../../../lib/api'
import type {
  Task,
  TaskComment,
  TaskListResponse,
  TaskDetailResponse,
  TaskCommentListResponse,
  CreateTaskPayload,
  UpdateTaskPayload,
  UpdateTaskStatusPayload,
  AssignTaskPayload,
  AddCommentPayload,
  TaskFilters,
} from '../types/task'

export const tasksApi = {
  /**
   * GET /v1/tasks?status=&priority=&cursor=&limit=20
   */
  list: async (filters?: TaskFilters): Promise<TaskListResponse> => {
    const params: Record<string, string | number> = {}
    if (filters?.status) params.status = filters.status
    if (filters?.priority) params.priority = filters.priority
    if (filters?.cursor) params.cursor = filters.cursor
    if (filters?.limit) params.limit = filters.limit
    const response = await api.get<TaskListResponse>('/tasks', { params })
    return response.data
  },

  /**
   * GET /v1/tasks/:id
   */
  getById: async (id: string): Promise<TaskDetailResponse> => {
    const response = await api.get<TaskDetailResponse>(`/tasks/${id}`)
    return response.data
  },

  /**
   * POST /v1/tasks
   */
  create: async (payload: CreateTaskPayload): Promise<TaskDetailResponse> => {
    const response = await api.post<TaskDetailResponse>('/tasks', payload)
    return response.data
  },

  /**
   * PATCH /v1/tasks/:id
   */
  update: async (id: string, payload: UpdateTaskPayload): Promise<TaskDetailResponse> => {
    const response = await api.patch<TaskDetailResponse>(`/tasks/${id}`, payload)
    return response.data
  },

  /**
   * POST /v1/tasks/:id/status
   */
  updateStatus: async (id: string, payload: UpdateTaskStatusPayload): Promise<TaskDetailResponse> => {
    const response = await api.post<TaskDetailResponse>(`/tasks/${id}/status`, payload)
    return response.data
  },

  /**
   * POST /v1/tasks/:id/assign
   */
  assign: async (id: string, payload: AssignTaskPayload): Promise<TaskDetailResponse> => {
    const response = await api.post<TaskDetailResponse>(`/tasks/${id}/assign`, payload)
    return response.data
  },

  /**
   * DELETE /v1/tasks/:id
   */
  delete: async (id: string): Promise<void> => {
    await api.delete(`/tasks/${id}`)
  },

  /**
   * GET /v1/tasks/:id/comments
   */
  listComments: async (taskId: string): Promise<TaskCommentListResponse> => {
    const response = await api.get<TaskCommentListResponse>(`/tasks/${taskId}/comments`)
    return response.data
  },

  /**
   * POST /v1/tasks/:id/comments
   */
  addComment: async (taskId: string, payload: AddCommentPayload): Promise<{ data: TaskComment }> => {
    const response = await api.post<{ data: TaskComment }>(`/tasks/${taskId}/comments`, payload)
    return response.data
  },
}
