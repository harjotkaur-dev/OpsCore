import { api } from '../../../lib/api'
import type { NotificationFilters, NotificationListResponse } from '../types/notification'

export const notificationsApi = {
  /**
   * GET /v1/notifications?isRead=&cursor=&limit=
   */
  list: async (filters?: NotificationFilters): Promise<NotificationListResponse> => {
    const params: Record<string, string | number | boolean> = {}
    if (filters?.isRead !== undefined) params.isRead = filters.isRead
    if (filters?.cursor) params.cursor = filters.cursor
    if (filters?.limit) params.limit = filters.limit
    const response = await api.get<NotificationListResponse>('/notifications', { params })
    return response.data
  },

  /**
   * POST /v1/notifications/:id/read
   */
  markRead: async (id: string): Promise<void> => {
    await api.post(`/notifications/${id}/read`)
  },

  /**
   * POST /v1/notifications/read-all
   */
  markAllRead: async (): Promise<void> => {
    await api.post('/notifications/read-all')
  },
}
