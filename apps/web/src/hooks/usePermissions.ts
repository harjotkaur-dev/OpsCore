import { useSession } from '../providers/SessionProvider'
import { Permission, hasPermission } from '../lib/permissions'

export function usePermissions() {
  const { permissions } = useSession()

  const can = (permission: Permission): boolean => {
    return hasPermission(permissions, permission)
  }

  return { can, permissions }
}
