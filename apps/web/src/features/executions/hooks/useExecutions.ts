import { useQuery } from '@tanstack/react-query'
import { useSession } from '../../../providers/SessionProvider'
import { queryKeys } from '../../../lib/queryKeys'
import { executionsApi } from '../api/executionsApi'
import type { ExecutionFilters } from '../types/execution'

export function useExecutions(filters?: ExecutionFilters, cursor?: string) {
  const { orgId } = useSession()

  return useQuery({
    queryKey: queryKeys.executions.list(orgId ?? '', filters as Record<string, unknown>),
    queryFn: () => executionsApi.list(filters, cursor),
    enabled: !!orgId,
    staleTime: 30_000,
  })
}
