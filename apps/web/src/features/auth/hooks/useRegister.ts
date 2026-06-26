import { useMutation } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useSession } from '../../../providers/SessionProvider'
import { authApi } from '../api/authApi'
import type { RegisterPayload } from '../types/auth'
import type { Role } from '../../../lib/permissions'

// Auto-generate a URL-safe slug from an organization name
function toSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 63)
}

export function useRegister() {
  const { login } = useSession()
  const navigate = useNavigate()

  return useMutation({
    mutationFn: (payload: Omit<RegisterPayload, 'organizationSlug'>) =>
      authApi.register({
        ...payload,
        organizationSlug: toSlug(payload.organizationName),
      }),
    onSuccess: (data) => {
      login(data.accessToken, data.user, data.organizationId, data.role as Role)
      navigate('/', { replace: true })
    },
  })
}
