import { useParams, Navigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useAcceptInvite } from '../hooks/useAcceptInvite'
import {
  acceptInviteSchema,
  type AcceptInviteFormData,
} from '../schemas/authSchemas'

export function InviteAcceptPage() {
  const { token } = useParams<{ token: string }>()

  // Guard: token must be present in the URL
  if (!token) {
    return <Navigate to="/login" replace />
  }

  return <InviteAcceptForm token={token} />
}

function InviteAcceptForm({ token }: { token: string }) {
  const { mutate: doAccept, isPending, error } = useAcceptInvite(token)

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<AcceptInviteFormData>({
    resolver: zodResolver(acceptInviteSchema),
  })

  const onSubmit = (data: AcceptInviteFormData) => {
    doAccept({ fullName: data.fullName, password: data.password })
  }

  const errorMessage = error
    ? ((error as { response?: { data?: { message?: string } } }).response?.data
        ?.message ?? 'Failed to accept invite. The link may have expired.')
    : null

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold text-gray-900">OpsCore</h1>
          <p className="mt-2 text-sm text-gray-600">
            Accept your invitation and set up your account
          </p>
        </div>

        <div className="rounded-lg bg-white px-8 py-10 shadow-sm ring-1 ring-gray-200">
          <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-5">
            {errorMessage && (
              <div
                role="alert"
                className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-200"
              >
                {errorMessage}
              </div>
            )}

            <div>
              <label
                htmlFor="fullName"
                className="block text-sm font-medium text-gray-700"
              >
                Full name
              </label>
              <input
                id="fullName"
                type="text"
                autoComplete="name"
                {...register('fullName')}
                className="mt-1.5 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-500"
                placeholder="Jane Smith"
                disabled={isPending}
              />
              {errors.fullName && (
                <p className="mt-1 text-xs text-red-600" role="alert">
                  {errors.fullName.message}
                </p>
              )}
            </div>

            <div>
              <label
                htmlFor="password"
                className="block text-sm font-medium text-gray-700"
              >
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="new-password"
                {...register('password')}
                className="mt-1.5 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-500"
                placeholder="At least 8 characters"
                disabled={isPending}
              />
              {errors.password && (
                <p className="mt-1 text-xs text-red-600" role="alert">
                  {errors.password.message}
                </p>
              )}
            </div>

            <div>
              <label
                htmlFor="confirmPassword"
                className="block text-sm font-medium text-gray-700"
              >
                Confirm password
              </label>
              <input
                id="confirmPassword"
                type="password"
                autoComplete="new-password"
                {...register('confirmPassword')}
                className="mt-1.5 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-500"
                placeholder="Re-enter your password"
                disabled={isPending}
              />
              {errors.confirmPassword && (
                <p className="mt-1 text-xs text-red-600" role="alert">
                  {errors.confirmPassword.message}
                </p>
              )}
            </div>

            <button
              type="submit"
              disabled={isPending}
              className="w-full rounded-md bg-blue-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isPending ? 'Accepting invite…' : 'Accept invite'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
