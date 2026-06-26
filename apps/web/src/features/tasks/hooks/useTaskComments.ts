import { useQuery } from '@tanstack/react-query'
import { useSession } from '../../../providers/SessionProvider'
import { queryKeys } from '../../../lib/queryKeys'
import { tasksApi } from '../api/tasksApi'

export function useTaskComments(taskId: string) {
  const { orgId } = useSession()

  return useQuery({
    queryKey: queryKeys.tasks.comments(orgId ?? '', taskId),
    queryFn: () => tasksApi.listComments(taskId),
    enabled: !!orgId && !!taskId,
    staleTime: 30_000,
  })
}
