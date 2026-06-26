import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useSession } from '../../../providers/SessionProvider'
import { queryKeys } from '../../../lib/queryKeys'
import { eventsApi } from '../api/eventsApi'

export function useDeprecateEventType() {
  const queryClient = useQueryClient()
  const { orgId } = useSession()

  return useMutation({
    mutationFn: (id: string) => eventsApi.deprecateEventType(id),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.eventTypes.all(orgId ?? ''),
      })
    },
  })
}
