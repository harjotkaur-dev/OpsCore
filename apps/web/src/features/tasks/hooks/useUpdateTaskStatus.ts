import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useSession } from '../../../providers/SessionProvider'
import { queryKeys } from '../../../lib/queryKeys'
import { tasksApi } from '../api/tasksApi'
import type { Task, UpdateTaskStatusPayload } from '../types/task'

interface UpdateTaskStatusVariables {
  taskId: string
  payload: UpdateTaskStatusPayload
}

export function useUpdateTaskStatus() {
  const { orgId } = useSession()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ taskId, payload }: UpdateTaskStatusVariables) =>
      tasksApi.updateStatus(taskId, payload),

    onMutate: async ({ taskId, payload }) => {
      const detailKey = queryKeys.tasks.detail(orgId ?? '', taskId)

      // Cancel in-flight queries for this task
      await queryClient.cancelQueries({ queryKey: detailKey })

      // Snapshot previous value
      const previousTask = queryClient.getQueryData<{ data: Task }>(detailKey)

      // Optimistically update the status
      if (previousTask) {
        queryClient.setQueryData<{ data: Task }>(detailKey, {
          ...previousTask,
          data: { ...previousTask.data, status: payload.status },
        })
      }

      return { previousTask, detailKey }
    },

    onError: (_err, _vars, context) => {
      // Roll back on error
      if (context?.previousTask) {
        queryClient.setQueryData(context.detailKey, context.previousTask)
      }
    },

    onSettled: (_data, _err, { taskId }) => {
      // Invalidate both detail and list queries
      queryClient.invalidateQueries({
        queryKey: queryKeys.tasks.detail(orgId ?? '', taskId),
      })
      queryClient.invalidateQueries({
        queryKey: queryKeys.tasks.all(orgId ?? ''),
      })
    },
  })
}
