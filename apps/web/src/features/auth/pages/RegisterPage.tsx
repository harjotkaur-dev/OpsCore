import { useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useSession } from '../../../providers/SessionProvider'
import { useRegister } from '../hooks/useRegister'
import { registerSchema, type RegisterFormData } from '../schemas/authSchemas'

export function RegisterPage() {
  const { isAuthenticated, isLoading: sessionLoading } = useSession()
  const navigate = useNavigate()
  const { mutate: doRegister, isPending, error } = useRegister()

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RegisterFormData>({
    resolver: zodResolver(registerSchema),
  })

  // Redirect away if already authenticated
  useEffect(() => {
    if (!sessionLoading && isAuthenticated) {
      navigate('/', { replace: true })
    }
  }, [isAuthenticated, sessionLoading, navigate])

  const onSubmit = (data: RegisterFormData) => {
    doRegister(data)
  }

  const errorMessage = error
    ? ((error as { response?: { data?: { message?: string } } }).response?.data
        ?.message ?? 'Registration failed. Please try again.')
    : null

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold text-gray-900">OpsCore</h1>
          <p className="mt-2 text-sm text-gray-600">
            Create your organization account
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
                htmlFor="organizationName"
                className="block text-sm font-medium text-gray-700"
              >
                Organization name
              </label>
              <input
                id="organizationName"
                type="text"
                autoComplete="organization"
                {...register('organizationName')}
                className="mt-1.5 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-500"
                placeholder="Acme Corp"
                disabled={isPending}
              />
              {errors.organizationName && (
                <p className="mt-1 text-xs text-red-600" role="alert">
                  {errors.organizationName.message}
                </p>
              )}
            </div>

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
                htmlFor="email"
                className="block text-sm font-medium text-gray-700"
              >
                Email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                {...register('email')}
                className="mt-1.5 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-500"
                placeholder="you@example.com"
                disabled={isPending}
              />
              {errors.email && (
                <p className="mt-1 text-xs text-red-600" role="alert">
                  {errors.email.message}
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

            <button
              type="submit"
              disabled={isPending}
              className="w-full rounded-md bg-blue-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isPending ? 'Creating account…' : 'Create account'}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-gray-600">
            Already have an account?{' '}
            <Link
              to="/login"
              className="font-medium text-blue-600 hover:text-blue-500"
            >
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
