import { useQuery } from '@tanstack/react-query'
import { useSession } from '../../../providers/SessionProvider'
import { queryKeys } from '../../../lib/queryKeys'
import { workflowsApi } from '../api/workflowsApi'

export function useWorkflows() {
  const { orgId } = useSession()

  return useQuery({
    queryKey: queryKeys.workflows.list(orgId ?? ''),
    queryFn: () => workflowsApi.list(),
    enabled: !!orgId,
    staleTime: 30_000,
  })
}
