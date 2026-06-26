import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useSession } from '../../../providers/SessionProvider'
import { queryKeys } from '../../../lib/queryKeys'
import { notificationsApi } from '../api/notificationsApi'

export function useMarkAllRead() {
  const { orgId } = useSession()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => notificationsApi.markAllRead(),

    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.notifications.all(orgId ?? ''),
      })
    },
  })
}
