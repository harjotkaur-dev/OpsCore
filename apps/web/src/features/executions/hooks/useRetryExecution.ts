import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useSession } from '../../../providers/SessionProvider'
import { queryKeys } from '../../../lib/queryKeys'
import { executionsApi } from '../api/executionsApi'

export function useRetryExecution() {
  const queryClient = useQueryClient()
  const { orgId } = useSession()

  return useMutation({
    mutationFn: (id: string) => executionsApi.retry(id),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.executions.all(orgId ?? ''),
      })
    },
  })
}
