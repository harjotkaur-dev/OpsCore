import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useSession } from '../../../providers/SessionProvider'
import { queryKeys } from '../../../lib/queryKeys'
import { metricsApi } from '../api/metricsApi'

export function useDeleteKPI() {
  const { orgId } = useSession()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => metricsApi.deleteKPI(id),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.kpis.all(orgId ?? ''),
      })
    },
  })
}
