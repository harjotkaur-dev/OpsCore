import { api } from '../../lib/api'

export interface DashboardSummary {
  activeWorkflows: number
  runningExecutions: number
  failedExecutions: number
  openTasks: number
  kpiAlerts: number
}

export interface WorkflowHealth {
  active: number
  archived: number
  total: number
}

export interface TaskOverview {
  pending: number
  inProgress: number
  completed: number
  cancelled: number
  overdue: number
  total: number
}

export interface DashboardExecution {
  id: string
  workflowId: string
  workflowName: string
  status: string
  startedAt: string | null
  completedAt: string | null
  errorDetail: string | null
  attemptCount: number
  createdAt: string
}

export interface DashboardNotification {
  id: string
  message: string
  sourceEntityType: string | null
  sourceEntityId: string | null
  isRead: boolean
  createdAt: string
}

export interface DashboardAuditLog {
  id: string
  entityType: string
  entityId: string
  action: string
  actorType: string
  actorId: string | null
  timestamp: string
}

export interface DashboardData {
  summary: DashboardSummary
  workflowHealth: WorkflowHealth
  taskOverview: TaskOverview
  recentExecutions: DashboardExecution[]
  recentNotifications: DashboardNotification[]
  recentAuditLogs: DashboardAuditLog[]
  queueStatus: Record<string, Record<string, number>>
}

export const dashboardApi = {
  getSummary: async (): Promise<DashboardData> => {
    const response = await api.get<DashboardData>('/dashboard/summary')
    return response.data
  },
}
