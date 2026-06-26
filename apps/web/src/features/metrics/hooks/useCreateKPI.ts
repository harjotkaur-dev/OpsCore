import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useSession } from '../../../providers/SessionProvider'
import { queryKeys } from '../../../lib/queryKeys'
import { metricsApi } from '../api/metricsApi'
import type { CreateKPIPayload } from '../types/metric'

export function useCreateKPI() {
  const { orgId } = useSession()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (payload: CreateKPIPayload) => metricsApi.createKPI(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.kpis.all(orgId ?? ''),
      })
    },
  })
}
