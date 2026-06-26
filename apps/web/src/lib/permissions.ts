// Permission definitions and role mappings
// Frontend permission system - mirrors backend RBAC

export type Permission =
  // Organization
  | 'organization:read'
  | 'organization:update'
  | 'organization:deactivate'
  // Users
  | 'user:read'
  | 'user:invite'
  | 'user:update_role'
  // Teams
  | 'team:read'
  | 'team:create'
  | 'team:update'
  | 'team:archive'
  | 'team:manage_members'
  // Events
  | 'event:read'
  | 'event:create'
  | 'event_type:read'
  | 'event_type:create'
  | 'event_type:update'
  | 'event_type:deprecate'
  // Workflows
  | 'workflow:read'
  | 'workflow:create'
  | 'workflow:update'
  | 'workflow:delete'
  | 'workflow:activate'
  | 'workflow:deactivate'
  // Executions
  | 'execution:read'
  | 'execution:retry'
  // Tasks
  | 'task:read'
  | 'task:create'
  | 'task:update'
  | 'task:assign'
  | 'task:delete'
  | 'task:comment'
  // Notifications
  | 'notification:read'
  // Metrics
  | 'metric:read'
  | 'kpi:read'
  | 'kpi:create'
  | 'kpi:update'
  | 'kpi:delete'
  // Audit Logs
  | 'audit_log:read'

export type Role = 'owner' | 'admin' | 'operations_manager' | 'team_lead' | 'member'

// Role to permission mappings (mirrors backend)
export const rolePermissions: Record<Role, Permission[]> = {
  owner: [
    // All permissions
    'organization:read',
    'organization:update',
    'organization:deactivate',
    'user:read',
    'user:invite',
    'user:update_role',
    'team:read',
    'team:create',
    'team:update',
    'team:archive',
    'team:manage_members',
    'event:read',
    'event:create',
    'event_type:read',
    'event_type:create',
    'event_type:update',
    'event_type:deprecate',
    'workflow:read',
    'workflow:create',
    'workflow:update',
    'workflow:delete',
    'workflow:activate',
    'workflow:deactivate',
    'execution:read',
    'execution:retry',
    'task:read',
    'task:create',
    'task:update',
    'task:assign',
    'task:delete',
    'task:comment',
    'notification:read',
    'metric:read',
    'kpi:read',
    'kpi:create',
    'kpi:update',
    'kpi:delete',
    'audit_log:read',
  ],

  admin: [
    // All except organization deactivate
    'organization:read',
    'organization:update',
    'user:read',
    'user:invite',
    'user:update_role',
    'team:read',
    'team:create',
    'team:update',
    'team:archive',
    'team:manage_members',
    'event:read',
    'event:create',
    'event_type:read',
    'event_type:create',
    'event_type:update',
    'event_type:deprecate',
    'workflow:read',
    'workflow:create',
    'workflow:update',
    'workflow:delete',
    'workflow:activate',
    'workflow:deactivate',
    'execution:read',
    'execution:retry',
    'task:read',
    'task:create',
    'task:update',
    'task:assign',
    'task:delete',
    'task:comment',
    'notification:read',
    'metric:read',
    'kpi:read',
    'kpi:create',
    'kpi:update',
    'kpi:delete',
    'audit_log:read',
  ],

  operations_manager: [
    // Events, Workflows, Tasks, Executions, Metrics - full CRUD; Audit logs - read
    'event:read',
    'event:create',
    'event_type:read',
    'event_type:create',
    'event_type:update',
    'event_type:deprecate',
    'workflow:read',
    'workflow:create',
    'workflow:update',
    'workflow:delete',
    'workflow:activate',
    'workflow:deactivate',
    'execution:read',
    'execution:retry',
    'task:read',
    'task:create',
    'task:update',
    'task:assign',
    'task:delete',
    'task:comment',
    'notification:read',
    'metric:read',
    'kpi:read',
    'kpi:create',
    'kpi:update',
    'kpi:delete',
    'audit_log:read',
  ],

  team_lead: [
    // Tasks - full; Events, Executions - read
    'event:read',
    'execution:read',
    'task:read',
    'task:create',
    'task:update',
    'task:assign',
    'task:delete',
    'task:comment',
    'notification:read',
  ],

  member: [
    // Tasks - read/update own; Events - read
    'event:read',
    'task:read',
    'task:update',
    'task:comment',
    'notification:read',
  ],
}

// Permission check helper
export function hasPermission(
  userPermissions: Permission[],
  requiredPermission: Permission
): boolean {
  return userPermissions.includes(requiredPermission)
}

// Get permissions for a role
export function getPermissionsForRole(role: Role): Permission[] {
  return rolePermissions[role]
}
