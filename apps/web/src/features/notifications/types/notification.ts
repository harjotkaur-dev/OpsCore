export interface Notification {
  id: string
  organizationId: string
  recipientUserId: string
  message: string
  sourceEntityType: string | null
  sourceEntityId: string | null
  isRead: boolean
  readAt: string | null
  createdAt: string
}

export interface NotificationListResponse {
  data: Notification[]
  nextCursor?: string
}

export interface NotificationFilters {
  isRead?: boolean
  cursor?: string
  limit?: number
}
