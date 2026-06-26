import { useMutation } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useSession } from '../../../providers/SessionProvider'
import { authApi } from '../api/authApi'
import type { AcceptInvitePayload } from '../types/auth'
import type { Role } from '../../../lib/permissions'

export function useAcceptInvite(token: string) {
  const { login } = useSession()
  const navigate = useNavigate()

  return useMutation({
    mutationFn: (payload: AcceptInvitePayload) =>
      authApi.acceptInvite(token, payload),
    onSuccess: (data) => {
      login(data.accessToken, data.user, data.organizationId, data.role as Role)
      navigate('/', { replace: true })
    },
  })
}
