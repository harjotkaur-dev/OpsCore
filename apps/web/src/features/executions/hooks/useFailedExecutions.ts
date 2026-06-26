import { useQuery } from '@tanstack/react-query'
import { useSession } from '../../../providers/SessionProvider'
import { queryKeys } from '../../../lib/queryKeys'
import { executionsApi } from '../api/executionsApi'

export function useFailedExecutions() {
  const { orgId } = useSession()

  return useQuery({
    queryKey: queryKeys.executions.failed(orgId ?? ''),
    queryFn: () => executionsApi.listFailed(),
    enabled: !!orgId,
    staleTime: 30_000,
  })
}
