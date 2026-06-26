// AuthResponse — must stay in sync with the canonical definition in packages/types/src/index.ts
export interface AuthResponse {
  accessToken: string
  user: {
    id: string
    email: string
    fullName: string
  }
  organizationId: string
  role: string
}

export interface LoginPayload {
  email: string
  password: string
}

export interface RegisterPayload {
  organizationName: string
  organizationSlug: string
  email: string
  password: string
  fullName: string
}

export interface AcceptInvitePayload {
  password: string
  fullName: string
}
