import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useSession } from '../../../providers/SessionProvider'
import { queryKeys } from '../../../lib/queryKeys'
import { tasksApi } from '../api/tasksApi'
import type { AddCommentPayload } from '../types/task'

interface AddCommentVariables {
  taskId: string
  payload: AddCommentPayload
}

export function useAddComment() {
  const { orgId } = useSession()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ taskId, payload }: AddCommentVariables) =>
      tasksApi.addComment(taskId, payload),
    onSuccess: (_data, { taskId }) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.tasks.comments(orgId ?? '', taskId),
      })
    },
  })
}
