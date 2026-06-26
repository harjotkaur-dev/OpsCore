import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/v1'

// In-memory token storage
let accessToken: string | null = null

// Single refresh-in-flight protection
let refreshPromise: Promise<string> | null = null

export const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true, // Required for refresh token cookie
})

// Request interceptor: Attach access token
api.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    if (accessToken && config.headers) {
      config.headers.Authorization = `Bearer ${accessToken}`
    }
    return config
  },
  (error) => Promise.reject(error)
)

// Response interceptor: Handle 401 and refresh token
api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & {
      _retry?: boolean
    }

    // If 401 and not already retried
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true

      try {
        // Use single-refresh-in-flight protection
        if (!refreshPromise) {
          refreshPromise = refreshAccessToken()
        }

        const newAccessToken = await refreshPromise
        refreshPromise = null

        // Update token and retry original request
        accessToken = newAccessToken
        if (originalRequest.headers) {
          originalRequest.headers.Authorization = `Bearer ${newAccessToken}`
        }

        return api(originalRequest)
      } catch (refreshError) {
        // Refresh failed - clear token and reject
        refreshPromise = null
        accessToken = null
        return Promise.reject(refreshError)
      }
    }

    return Promise.reject(error)
  }
)

// Refresh token helper
async function refreshAccessToken(): Promise<string> {
  const response = await axios.post(
    `${API_BASE_URL}/auth/refresh`,
    {},
    { withCredentials: true }
  )
  return response.data.accessToken
}

// Public API for token management
export function setAccessToken(token: string) {
  accessToken = token
}

export function clearAccessToken() {
  accessToken = null
}

export function getAccessToken(): string | null {
  return accessToken
}
