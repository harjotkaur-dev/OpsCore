export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled'
export type TaskPriority = 'low' | 'medium' | 'high' | 'critical'

export interface TaskAssignment {
  id: string
  taskId: string
  assigneeType: 'user' | 'team'
  userId?: string
  teamId?: string
  assignedAt: string
}

export interface TaskComment {
  id: string
  taskId: string
  authorId: string
  body: string
  createdAt: string
  author?: { fullName: string; email: string }
}

export interface Task {
  id: string
  organizationId: string
  title: string
  description?: string
  priority: TaskPriority
  status: TaskStatus
  dueDate?: string
  overdue: boolean
  createdBy?: string
  sourceWorkflowId?: string
  sourceExecutionId?: string
  createdAt: string
  updatedAt: string
  assignments?: TaskAssignment[]
}

export interface TaskListResponse {
  data: Task[]
  nextCursor?: string
}

export interface TaskDetailResponse {
  data: Task
}

export interface TaskCommentListResponse {
  data: TaskComment[]
}

export interface CreateTaskPayload {
  title: string
  description?: string
  priority: TaskPriority
  dueDate?: string
}

export interface UpdateTaskPayload {
  title?: string
  description?: string
  priority?: TaskPriority
  dueDate?: string
}

export interface UpdateTaskStatusPayload {
  status: 'in_progress' | 'completed' | 'cancelled'
}

export interface AssignTaskPayload {
  assigneeType: 'user' | 'team'
  userId?: string
  teamId?: string
}

export interface AddCommentPayload {
  body: string
}

export interface TaskFilters {
  status?: TaskStatus
  priority?: TaskPriority
  assigneeUserId?: string
  teamId?: string
  dueDateFrom?: string
  dueDateTo?: string
  cursor?: string
  limit?: number
}
