import { api } from '../../../lib/api'
import type {
  AuthResponse,
  LoginPayload,
  RegisterPayload,
  AcceptInvitePayload,
} from '../types/auth'

// All auth endpoints return { data: AuthResponse } — unwrap the envelope here
// so callers always receive a plain AuthResponse.

export const authApi = {
  login: async (payload: LoginPayload): Promise<AuthResponse> => {
    const response = await api.post<{ data: AuthResponse }>('/auth/login', payload)
    return response.data.data
  },

  register: async (payload: RegisterPayload): Promise<AuthResponse> => {
    const response = await api.post<{ data: AuthResponse }>('/auth/register', payload)
    return response.data.data
  },

  acceptInvite: async (
    token: string,
    payload: AcceptInvitePayload
  ): Promise<AuthResponse> => {
    const response = await api.post<{ data: AuthResponse }>(
      `/auth/invite/${token}/accept`,
      payload
    )
    return response.data.data
  },
}
