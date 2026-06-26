// Centralized query key factory for TanStack Query
// All React Query keys must go through this factory

export const queryKeys = {
  // Auth
  auth: {
    session: ['auth', 'session'] as const,
  },

  // Events
  events: {
    all: (orgId: string) => ['events', orgId] as const,
    list: (orgId: string, filters?: Record<string, unknown>) =>
      ['events', orgId, 'list', filters] as const,
    detail: (orgId: string, eventId: string) =>
      ['events', orgId, 'detail', eventId] as const,
  },

  // Event Types
  eventTypes: {
    all: (orgId: string) => ['eventTypes', orgId] as const,
    list: (orgId: string) => ['eventTypes', orgId, 'list'] as const,
    detail: (orgId: string, eventTypeId: string) =>
      ['eventTypes', orgId, 'detail', eventTypeId] as const,
  },

  // Workflows
  workflows: {
    all: (orgId: string) => ['workflows', orgId] as const,
    list: (orgId: string) => ['workflows', orgId, 'list'] as const,
    detail: (orgId: string, workflowId: string) =>
      ['workflows', orgId, 'detail', workflowId] as const,
  },

  // Executions
  executions: {
    all: (orgId: string) => ['executions', orgId] as const,
    list: (orgId: string, filters?: Record<string, unknown>) =>
      ['executions', orgId, 'list', filters] as const,
    detail: (orgId: string, executionId: string) =>
      ['executions', orgId, 'detail', executionId] as const,
    failed: (orgId: string) => ['executions', orgId, 'failed'] as const,
  },

  // Tasks
  tasks: {
    all: (orgId: string) => ['tasks', orgId] as const,
    list: (orgId: string, filters?: Record<string, unknown>) =>
      ['tasks', orgId, 'list', filters] as const,
    detail: (orgId: string, taskId: string) =>
      ['tasks', orgId, 'detail', taskId] as const,
    comments: (orgId: string, taskId: string) =>
      ['tasks', orgId, taskId, 'comments'] as const,
  },

  // Notifications
  notifications: {
    all: (orgId: string) => ['notifications', orgId] as const,
    list: (orgId: string, filters?: Record<string, unknown>) =>
      ['notifications', orgId, 'list', filters] as const,
    unreadCount: (orgId: string) =>
      ['notifications', orgId, 'unreadCount'] as const,
  },

  // Metrics
  metrics: {
    all: (orgId: string) => ['metrics', orgId] as const,
    list: (orgId: string) => ['metrics', orgId, 'list'] as const,
    history: (orgId: string, metricName: string) =>
      ['metrics', orgId, 'history', metricName] as const,
  },

  // KPIs
  kpis: {
    all: (orgId: string) => ['kpis', orgId] as const,
    list: (orgId: string) => ['kpis', orgId, 'list'] as const,
    detail: (orgId: string, kpiId: string) =>
      ['kpis', orgId, 'detail', kpiId] as const,
  },

  // Organization
  organization: {
    detail: (orgId: string) => ['organization', orgId, 'detail'] as const,
    members: (orgId: string) => ['organization', orgId, 'members'] as const,
    teams: (orgId: string) => ['organization', orgId, 'teams'] as const,
  },

  // Audit Logs
  auditLogs: {
    all: (orgId: string) => ['auditLogs', orgId] as const,
    list: (orgId: string, filters?: Record<string, unknown>) =>
      ['auditLogs', orgId, 'list', filters] as const,
  },
} as const
