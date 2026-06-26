import { useQuery } from '@tanstack/react-query'
import { useSession } from '../../../providers/SessionProvider'
import { queryKeys } from '../../../lib/queryKeys'
import { eventsApi } from '../api/eventsApi'
import type { EventFilters } from '../types/event'

export function useEvents(filters?: EventFilters) {
  const { orgId } = useSession()

  return useQuery({
    queryKey: queryKeys.events.list(orgId ?? '', filters as Record<string, unknown>),
    queryFn: () => eventsApi.list(filters),
    enabled: !!orgId,
    staleTime: 30_000,
  })
}
