import { request, type User } from './client'

interface AuthResponse {
  token: string
  user: User
}

interface MeResponse {
  user: User
}

export async function register(username: string, password: string): Promise<User> {
  const data = await request<AuthResponse>('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  })
  return data.user
}

export async function login(username: string, password: string): Promise<User> {
  const data = await request<AuthResponse>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  })
  return data.user
}

export async function logout(): Promise<void> {
  await request<void>('/api/auth/logout', { method: 'POST' })
}

// me hits GET /api/auth/me — backend reads the cookie and returns the
// authenticated user, including the username. This replaces the old
// `isAuthed()` hack that returned a placeholder "User" on reload.
// Returns null on 401 (cookie expired / never set) so callers can decide
// whether to render the login page.
export async function me(): Promise<User | null> {
  try {
    const res = await request<MeResponse>('/api/auth/me', { method: 'GET' })
    return res?.user ?? null
  } catch {
    return null
  }
}

// whoami is the legacy boolean probe retained for tests that only need to
// know whether the cookie is valid. New code should prefer `me()`.
export async function isAuthed(): Promise<boolean> {
  try {
    await request('/api/auth/me', { method: 'GET' })
    return true
  } catch {
    return false
  }
}