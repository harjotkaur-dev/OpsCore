// Organization and User types

export interface Organization {
  id: string
  name: string
  slug: string
  status: OrganizationStatus
  createdAt: Date
  updatedAt: Date
}

export type OrganizationStatus = 'active' | 'deactivated'

export interface User {
  id: string
  email: string
  fullName: string
  createdAt: Date
  updatedAt: Date
}

export interface OrganizationMember {
  id: string
  organizationId: string
  userId: string
  role: Role
  status: MemberStatus
  invitedAt?: Date | null
  joinedAt?: Date | null
  createdAt: Date
}

export type MemberStatus = 'active' | 'invited' | 'suspended'

// Role enum
export enum Role {
  OWNER = 'owner',
  ADMIN = 'admin',
  OPERATIONS_MANAGER = 'operations_manager',
  TEAM_LEAD = 'team_lead',
  MEMBER = 'member',
}

// Task types
export interface Task {
  id: string
  organizationId: string
  title: string
  description?: string | null
  priority: TaskPriority
  status: TaskStatus
  dueDate?: Date | null
  overdue: boolean
  createdBy?: string | null
  sourceWorkflowId?: string | null
  sourceExecutionId?: string | null
  createdAt: Date
  updatedAt: Date
}

export type TaskPriority = 'low' | 'medium' | 'high' | 'critical'

export enum TaskStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
}

// Execution types
export enum ExecutionStatus {
  QUEUED = 'queued',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

// Queue names
export enum QueueName {
  WORKFLOW_EXEC = 'workflow-exec',
  NOTIFICATIONS = 'notifications',
  METRIC_UPDATES = 'metric-updates',
}

// Event types
export interface EventType {
  id: string
  organizationId: string
  name: string
  description?: string | null
  payloadSchema: Record<string, unknown>
  source: EventSource
  status: EventTypeStatus
  version: number
  createdBy: string
  createdAt: Date
  updatedAt: Date
}

export type EventSource = 'api' | 'webhook' | 'scheduled' | 'manual'
export type EventTypeStatus = 'active' | 'deprecated'

// Workflow types
export interface Workflow {
  id: string
  organizationId: string
  name: string
  description?: string | null
  version: number
  status: WorkflowStatus
  triggerEventTypeId: string
  createdBy: string
  createdAt: Date
  updatedAt: Date
}

export type WorkflowStatus = 'draft' | 'active' | 'inactive' | 'archived'

export type WorkflowActionType =
  | 'create_task'
  | 'send_notification'
  | 'update_metric'
  | 'call_webhook'

// Notification types
export interface Notification {
  id: string
  organizationId: string
  recipientType: RecipientType
  recipientUserId?: string | null
  recipientTeamId?: string | null
  message: string
  sourceEntityType: string
  sourceEntityId: string
  isRead: boolean
  readAt?: Date | null
  createdAt: Date
}

export type RecipientType = 'user' | 'team'

// Audit log types
export interface AuditLog {
  id: string
  organizationId: string
  entityType: AuditEntityType
  entityId: string
  action: AuditAction
  actorType: ActorType
  actorId?: string | null
  beforeState?: Record<string, unknown> | null
  afterState?: Record<string, unknown> | null
  timestamp: Date
  requestId?: string | null
}

export type AuditEntityType =
  | 'organization'
  | 'user'
  | 'event'
  | 'workflow'
  | 'task'
  | 'execution'
  | 'metric'
  | 'kpi'
  | 'notification'

export type AuditAction =
  | 'created'
  | 'updated'
  | 'deleted'
  | 'status_changed'
  | 'login_success'
  | 'login_failed'

export type ActorType = 'user' | 'system'

// API response types
export interface ApiResponse<T> {
  data: T
  meta?: PaginationMeta
}

export interface PaginationMeta {
  total?: number
  page?: number
  pageSize?: number
  nextCursor?: string | null
  prevCursor?: string | null
}

export interface ApiError {
  error: string
  message: string
  requestId?: string
  details?: FieldError[]
}

export interface FieldError {
  field: string
  message: string
}

// JWT payload type
export interface JwtPayload {
  sub: string
  org: string
  role: Role
  permissions: string[]
  iat?: number
  exp?: number
}

// Auth response — canonical contract used by both API routes and frontend
export interface AuthResponse {
  accessToken: string
  user: {
    id: string
    email: string
    fullName: string
  }
  organizationId: string
  role: string
}

// BullMQ job data types
export interface WorkflowJobData {
  workflowVersionId: string  // references workflow_versions.id (immutable snapshot)
  workflowId: string         // parent workflow id (for logging/display)
  eventId: string
  executionId: string
  orgId: string
  requestId?: string | undefined
}

export interface NotificationJobData {
  notificationId: string
  orgId: string
}

export interface MetricUpdateJobData {
  metricName: string
  orgId: string
  triggeredBy: string
}
