import { useQuery } from '@tanstack/react-query'
import { useSession } from '../../../providers/SessionProvider'
import { queryKeys } from '../../../lib/queryKeys'
import { eventsApi } from '../api/eventsApi'

export function useEvent(id: string) {
  const { orgId } = useSession()

  return useQuery({
    queryKey: queryKeys.events.detail(orgId ?? '', id),
    queryFn: () => eventsApi.getById(id),
    enabled: !!orgId && !!id,
  })
}
