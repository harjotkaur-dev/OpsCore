import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useSession } from '../../../providers/SessionProvider'
import { queryKeys } from '../../../lib/queryKeys'
import { tasksApi } from '../api/tasksApi'
import type { CreateTaskPayload } from '../types/task'

export function useCreateTask() {
  const { orgId } = useSession()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (payload: CreateTaskPayload) => tasksApi.create(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.tasks.all(orgId ?? ''),
      })
    },
  })
}
