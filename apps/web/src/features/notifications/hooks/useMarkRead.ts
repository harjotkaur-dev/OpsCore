import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useSession } from '../../../providers/SessionProvider'
import { queryKeys } from '../../../lib/queryKeys'
import { notificationsApi } from '../api/notificationsApi'
import type { Notification, NotificationListResponse } from '../types/notification'

export function useMarkRead() {
  const { orgId } = useSession()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => notificationsApi.markRead(id),

    onMutate: async (id: string) => {
      // Cancel any in-flight queries for notifications
      await queryClient.cancelQueries({
        queryKey: queryKeys.notifications.all(orgId ?? ''),
      })

      // Snapshot all matching list queries before optimistic update
      const queryCache = queryClient.getQueriesData<NotificationListResponse>({
        queryKey: queryKeys.notifications.all(orgId ?? ''),
      })

      // Optimistically set isRead: true for the target notification in all cached lists
      queryClient.setQueriesData<NotificationListResponse>(
        { queryKey: queryKeys.notifications.all(orgId ?? '') },
        (old) => {
          if (!old) return old
          return {
            ...old,
            data: old.data.map((n: Notification) =>
              n.id === id ? { ...n, isRead: true, readAt: new Date().toISOString() } : n
            ),
          }
        }
      )

      return { queryCache }
    },

    onError: (_err, _id, context) => {
      // Roll back all snapshots
      if (context?.queryCache) {
        for (const [queryKey, data] of context.queryCache) {
          queryClient.setQueryData(queryKey, data)
        }
      }
    },

    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.notifications.all(orgId ?? ''),
      })
    },
  })
}
