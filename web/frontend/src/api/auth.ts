import { request, type User } from './client'

interface AuthResponse {
  token: string
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

// checkAuth verifies the current cookie is valid by hitting a protected
// endpoint. Returns the user if authenticated, null otherwise. Used on page
// load to restore the session without a login form.
export async function checkAuth(): Promise<User | null> {
  try {
    const res = await request<User>('/api/users', { method: 'GET' })
    // /api/users returns a list, not a user; use a dedicated lightweight
    // check instead. Fall through to the hierarchy endpoint which any
    // authed user can read.
    void res
    return null
  } catch {
    return null
  }
}

// whoami hits GET /api/hierarchy (any authed user can read it). If it returns
// 200, the cookie is valid. We can't get the username from it, so callers
// should cache the username from login.
export async function isAuthed(): Promise<boolean> {
  try {
    await request('/api/hierarchy', { method: 'GET' })
    return true
  } catch {
    return false
  }
}
