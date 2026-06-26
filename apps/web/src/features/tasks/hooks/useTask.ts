import { useQuery } from '@tanstack/react-query'
import { useSession } from '../../../providers/SessionProvider'
import { queryKeys } from '../../../lib/queryKeys'
import { tasksApi } from '../api/tasksApi'

export function useTask(id: string) {
  const { orgId } = useSession()

  return useQuery({
    queryKey: queryKeys.tasks.detail(orgId ?? '', id),
    queryFn: () => tasksApi.getById(id),
    enabled: !!orgId && !!id,
    staleTime: 30_000,
  })
}
