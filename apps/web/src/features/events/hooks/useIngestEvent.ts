import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useSession } from '../../../providers/SessionProvider'
import { queryKeys } from '../../../lib/queryKeys'
import { eventsApi } from '../api/eventsApi'
import type { IngestEventPayload } from '../types/event'

export function useIngestEvent() {
  const queryClient = useQueryClient()
  const { orgId } = useSession()

  return useMutation({
    mutationFn: (payload: IngestEventPayload) => eventsApi.ingest(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.events.all(orgId ?? ''),
      })
    },
  })
}
