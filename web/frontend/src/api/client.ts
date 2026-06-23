import { API_BASE } from '../config'

// fetch wrapper: prepends API_BASE, sends credentials (cookies) cross-origin,
// and throws on non-2xx. Credentials are required because authentication uses
// an HttpOnly cookie (EventSource cannot set headers, so all requests rely on
// cookies being sent automatically).
export async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const res = await fetch(API_BASE + path, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
    ...options,
  })
  if (res.status === 204) return undefined as T
  if (!res.ok) {
    let msg = `HTTP ${res.status}`
    try {
      const body = await res.json()
      if (body?.error) msg = body.error
    } catch {
      // non-JSON error
    }
    throw new Error(msg)
  }
  if (res.headers.get('content-type')?.includes('application/json')) {
    return (await res.json()) as T
  }
  return undefined as T
}

export interface User {
  id: number
  username: string
  created_at: number
}
