import { useQuery } from '@tanstack/react-query'
import { useSession } from '../../../providers/SessionProvider'
import { queryKeys } from '../../../lib/queryKeys'
import { workflowsApi } from '../api/workflowsApi'

export function useWorkflow(id: string) {
  const { orgId } = useSession()

  return useQuery({
    queryKey: queryKeys.workflows.detail(orgId ?? '', id),
    queryFn: () => workflowsApi.getById(id),
    enabled: !!orgId && !!id,
    staleTime: 30_000,
  })
}
