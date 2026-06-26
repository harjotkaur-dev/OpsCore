import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { setAccessToken, clearAccessToken, api } from '../lib/api'
import { Permission, Role, getPermissionsForRole } from '../lib/permissions'

interface User {
  id: string
  email: string
  fullName: string
}

interface SessionContextValue {
  user: User | null
  orgId: string | null
  role: Role | null
  permissions: Permission[]
  isAuthenticated: boolean
  isLoading: boolean
  login: (accessToken: string, user: User, orgId: string, role: Role) => void
  logout: () => void
}

const SessionContext = createContext<SessionContextValue | undefined>(undefined)

interface SessionProviderProps {
  children: ReactNode
}

export function SessionProvider({ children }: SessionProviderProps) {
  const [user, setUser] = useState<User | null>(null)
  const [orgId, setOrgId] = useState<string | null>(null)
  const [role, setRole] = useState<Role | null>(null)
  const [permissions, setPermissions] = useState<Permission[]>([])
  const [isLoading, setIsLoading] = useState(true)

  // Check for existing session on mount
  useEffect(() => {
    const initSession = async () => {
      try {
        // Attempt to get current user session
        // This will trigger refresh token flow if access token is expired
        const response = await api.get('/users/me')
        const userData = response.data

        setUser({
          id: userData.data.id,
          email: userData.data.email,
          fullName: userData.data.fullName,
        })
        setOrgId(userData.data.orgId)
        setRole(userData.data.role)
        setPermissions(getPermissionsForRole(userData.data.role))
      } catch (error) {
        // No valid session - user needs to login
        clearAccessToken()
      } finally {
        setIsLoading(false)
      }
    }

    initSession()
  }, [])

  const login = (accessToken: string, userData: User, userOrgId: string, userRole: Role) => {
    setAccessToken(accessToken)
    setUser(userData)
    setOrgId(userOrgId)
    setRole(userRole)
    setPermissions(getPermissionsForRole(userRole))
  }

  const logout = async () => {
    try {
      await api.post('/auth/logout')
    } catch (error) {
      // Ignore logout errors - clear local state anyway
    } finally {
      clearAccessToken()
      setUser(null)
      setOrgId(null)
      setRole(null)
      setPermissions([])
    }
  }

  const value: SessionContextValue = {
    user,
    orgId,
    role,
    permissions,
    isAuthenticated: !!user && !!orgId,
    isLoading,
    login,
    logout,
  }

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession() {
  const context = useContext(SessionContext)
  if (context === undefined) {
    throw new Error('useSession must be used within a SessionProvider')
  }
  return context
}
