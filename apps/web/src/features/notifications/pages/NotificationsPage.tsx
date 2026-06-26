import { useState } from 'react'
import { useNotifications } from '../hooks/useNotifications'
import { useMarkRead } from '../hooks/useMarkRead'
import { useMarkAllRead } from '../hooks/useMarkAllRead'
import { usePermissions } from '../../../hooks/usePermissions'
import type { NotificationFilters } from '../types/notification'

export function NotificationsPage() {
  const { can } = usePermissions()
  const [showUnreadOnly, setShowUnreadOnly] = useState(false)

  const filters: NotificationFilters = {}
  if (showUnreadOnly) filters.isRead = false

  const { data, isLoading, isError } = useNotifications(filters)
  const markRead = useMarkRead()
  const markAllRead = useMarkAllRead()

  const notifications = data?.data ?? []
  const hasUnread = notifications.some((n) => !n.isRead)

  if (!can('notification:read')) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <p className="text-sm text-gray-500">You do not have permission to view notifications.</p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold text-gray-900">Notifications</h1>
        <button
          onClick={() => markAllRead.mutate()}
          disabled={!hasUnread || markAllRead.isPending}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Mark all as read
        </button>
      </div>

      {/* Filter toggle */}
      <div className="mb-4 flex gap-2">
        <button
          onClick={() => setShowUnreadOnly(false)}
          className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
            !showUnreadOnly
              ? 'bg-blue-600 text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          All
        </button>
        <button
          onClick={() => setShowUnreadOnly(true)}
          className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
            showUnreadOnly
              ? 'bg-blue-600 text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          Unread
        </button>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="py-12 text-center text-sm text-gray-500">Loading notifications…</div>
      )}

      {/* Error */}
      {isError && (
        <div className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">
          Failed to load notifications. Please try again.
        </div>
      )}

      {/* List */}
      {!isLoading && !isError && (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
          {notifications.length === 0 ? (
            <div className="py-12 text-center text-sm text-gray-500">No notifications</div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {notifications.map((notification) => (
                <li
                  key={notification.id}
                  className={`flex items-start justify-between gap-4 px-6 py-4 ${
                    !notification.isRead ? 'bg-blue-50' : ''
                  }`}
                >
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    {/* Unread dot */}
                    {!notification.isRead && (
                      <span
                        className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full bg-blue-500"
                        aria-label="Unread"
                      />
                    )}
                    <div className={!notification.isRead ? '' : 'ml-5'}>
                      <p
                        className={`text-sm ${
                          !notification.isRead
                            ? 'font-semibold text-gray-900'
                            : 'font-normal text-gray-700'
                        }`}
                      >
                        {notification.message}
                      </p>
                      <p className="mt-0.5 text-xs text-gray-500">
                        {new Date(notification.createdAt).toLocaleString()}
                      </p>
                    </div>
                  </div>
                  {!notification.isRead && (
                    <button
                      onClick={() => markRead.mutate(notification.id)}
                      disabled={markRead.isPending}
                      className="flex-shrink-0 rounded-md border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 disabled:opacity-50"
                    >
                      Mark as read
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
