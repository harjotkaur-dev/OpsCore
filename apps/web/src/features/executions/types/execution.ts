// TypeScript interfaces for the Executions feature

export type ExecutionStatus = 'queued' | 'running' | 'completed' | 'failed'

export interface Execution {
  id: string
  organizationId: string
  workflowId: string
  workflowName?: string
  eventId: string
  status: ExecutionStatus
  startedAt: string | null
  completedAt: string | null
  errorDetail: string | null
  attemptCount: number
  createdAt: string
}

export interface PaginationMeta {
  limit: number
  hasNextPage: boolean
  nextCursor: string | null
}

export interface ExecutionListResponse {
  data: Execution[]
  pagination: PaginationMeta
}

export interface ExecutionFilters {
  status?: ExecutionStatus
  workflowId?: string
}
