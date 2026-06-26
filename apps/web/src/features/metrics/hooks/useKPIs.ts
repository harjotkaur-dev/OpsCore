import { useQuery } from '@tanstack/react-query'
import { useSession } from '../../../providers/SessionProvider'
import { queryKeys } from '../../../lib/queryKeys'
import { metricsApi } from '../api/metricsApi'

export function useKPIs() {
  const { orgId } = useSession()

  return useQuery({
    queryKey: queryKeys.kpis.list(orgId ?? ''),
    queryFn: () => metricsApi.listKPIs(),
    enabled: !!orgId,
    staleTime: 30_000,
  })
}
