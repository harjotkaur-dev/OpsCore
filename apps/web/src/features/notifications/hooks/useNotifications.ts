import { useQuery } from '@tanstack/react-query'
import { useSession } from '../../../providers/SessionProvider'
import { queryKeys } from '../../../lib/queryKeys'
import { notificationsApi } from '../api/notificationsApi'
import type { NotificationFilters } from '../types/notification'

export function useNotifications(filters?: NotificationFilters) {
  const { orgId } = useSession()

  return useQuery({
    queryKey: queryKeys.notifications.list(orgId ?? '', filters as Record<string, unknown>),
    queryFn: () => notificationsApi.list(filters),
    enabled: !!orgId,
    staleTime: 30_000,
    refetchInterval: 30_000,
  })
}
