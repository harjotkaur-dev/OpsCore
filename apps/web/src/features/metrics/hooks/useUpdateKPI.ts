import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useSession } from '../../../providers/SessionProvider'
import { queryKeys } from '../../../lib/queryKeys'
import { metricsApi } from '../api/metricsApi'
import type { UpdateKPIPayload } from '../types/metric'

export function useUpdateKPI() {
  const { orgId } = useSession()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: UpdateKPIPayload }) =>
      metricsApi.updateKPI(id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.kpis.all(orgId ?? ''),
      })
    },
  })
}
