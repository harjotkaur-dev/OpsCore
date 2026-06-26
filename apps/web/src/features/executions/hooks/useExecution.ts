import { useQuery } from '@tanstack/react-query'
import { useSession } from '../../../providers/SessionProvider'
import { queryKeys } from '../../../lib/queryKeys'
import { executionsApi } from '../api/executionsApi'

export function useExecution(id: string) {
  const { orgId } = useSession()

  return useQuery({
    queryKey: queryKeys.executions.detail(orgId ?? '', id),
    queryFn: () => executionsApi.getById(id),
    enabled: !!orgId && !!id,
  })
}
