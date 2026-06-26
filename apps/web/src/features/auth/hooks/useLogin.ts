import { useMutation } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useSession } from '../../../providers/SessionProvider'
import { authApi } from '../api/authApi'
import type { LoginPayload } from '../types/auth'
import type { Role } from '../../../lib/permissions'

export function useLogin() {
  const { login } = useSession()
  const navigate = useNavigate()

  return useMutation({
    mutationFn: (payload: LoginPayload) => authApi.login(payload),
    onSuccess: (data) => {
      login(data.accessToken, data.user, data.organizationId, data.role as Role)
      navigate('/', { replace: true })
    },
  })
}
