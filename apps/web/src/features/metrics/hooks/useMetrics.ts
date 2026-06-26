import { useQuery } from '@tanstack/react-query'
import { useSession } from '../../../providers/SessionProvider'
import { queryKeys } from '../../../lib/queryKeys'
import { metricsApi } from '../api/metricsApi'

export function useMetrics() {
  const { orgId } = useSession()

  return useQuery({
    queryKey: queryKeys.metrics.list(orgId ?? ''),
    queryFn: () => metricsApi.list(),
    enabled: !!orgId,
    staleTime: 30_000,
  })
}
