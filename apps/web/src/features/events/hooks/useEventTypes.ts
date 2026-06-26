import { useQuery } from '@tanstack/react-query'
import { useSession } from '../../../providers/SessionProvider'
import { queryKeys } from '../../../lib/queryKeys'
import { eventsApi } from '../api/eventsApi'

export function useEventTypes() {
  const { orgId } = useSession()

  return useQuery({
    queryKey: queryKeys.eventTypes.list(orgId ?? ''),
    queryFn: () => eventsApi.listEventTypes(),
    enabled: !!orgId,
  })
}
