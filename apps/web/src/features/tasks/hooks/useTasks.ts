import { useQuery } from '@tanstack/react-query'
import { useSession } from '../../../providers/SessionProvider'
import { queryKeys } from '../../../lib/queryKeys'
import { tasksApi } from '../api/tasksApi'
import type { TaskFilters } from '../types/task'

export function useTasks(filters?: TaskFilters) {
  const { orgId } = useSession()

  return useQuery({
    queryKey: queryKeys.tasks.list(orgId ?? '', filters as Record<string, unknown>),
    queryFn: () => tasksApi.list(filters),
    enabled: !!orgId,
    staleTime: 30_000,
  })
}
