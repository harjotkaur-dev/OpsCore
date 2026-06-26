import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useSession } from '../../../providers/SessionProvider'
import { queryKeys } from '../../../lib/queryKeys'
import { workflowsApi } from '../api/workflowsApi'

export function useDeactivateWorkflow() {
  const { orgId } = useSession()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => workflowsApi.deactivate(id),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.workflows.detail(orgId ?? '', id),
      })
      queryClient.invalidateQueries({
        queryKey: queryKeys.workflows.list(orgId ?? ''),
      })
    },
  })
}
