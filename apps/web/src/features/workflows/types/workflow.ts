export type WorkflowStatus = 'draft' | 'active' | 'inactive' | 'archived'
export type ActionType = 'create_task' | 'send_notification' | 'update_metric' | 'call_webhook'

export interface WorkflowRule {
  id: string
  workflowId: string
  expression: string
  description?: string
  createdAt: string
}

export interface WorkflowAction {
  id: string
  workflowId: string
  actionType: ActionType
  orderIndex: number
  config: Record<string, unknown>
  createdAt: string
}

export interface Workflow {
  id: string
  organizationId: string
  name: string
  description?: string
  version: number
  status: WorkflowStatus
  triggerEventTypeId: string
  createdAt: string
  updatedAt: string
}

export interface WorkflowListResponse {
  data: Workflow[]
}

export interface WorkflowRulesResponse {
  data: WorkflowRule[]
}

export interface WorkflowActionsResponse {
  data: WorkflowAction[]
}

export interface CreateWorkflowPayload {
  name: string
  description?: string | undefined
  triggerEventTypeId: string
}

export interface UpdateWorkflowPayload {
  name?: string | undefined
  description?: string | undefined
}

export interface CreateRulePayload {
  expression: string
  description?: string | undefined
}

export interface CreateActionPayload {
  actionType: ActionType
  orderIndex: number
  config: Record<string, unknown>
}
