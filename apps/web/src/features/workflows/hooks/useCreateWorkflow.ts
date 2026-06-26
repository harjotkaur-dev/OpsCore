import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useSession } from '../../../providers/SessionProvider'
import { queryKeys } from '../../../lib/queryKeys'
import { workflowsApi } from '../api/workflowsApi'
import type { CreateWorkflowPayload } from '../types/workflow'

export function useCreateWorkflow() {
  const { orgId } = useSession()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (payload: CreateWorkflowPayload) => workflowsApi.create(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.workflows.list(orgId ?? ''),
      })
    },
  })
}
