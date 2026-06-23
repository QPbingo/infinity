import { API_BASE } from '../config'
import { toast } from '../ui/toast'

// fetch wrapper: prepends API_BASE, sends credentials (cookies) cross-origin,
// and throws on non-2xx. Credentials are required because authentication uses
// an HttpOnly cookie (EventSource cannot set headers, so all requests rely on
// cookies being sent automatically).
//
// 401 handling: a single 401 triggers a global "session expired" toast and
// dispatches a `auth:unauthorized` CustomEvent so ui/auth.ts can switch to the
// login overlay without every caller repeating the logic.

export class HTTPError extends Error {
  constructor(public status: number, message: string) {
    super(message)
    this.name = 'HTTPError'
  }
}

const UNAUTHORIZED_EVENT = 'auth:unauthorized'

export function onUnauthorized(handler: () => void): () => void {
  const listener = () => handler()
  window.addEventListener(UNAUTHORIZED_EVENT, listener)
  return () => window.removeEventListener(UNAUTHORIZED_EVENT, listener)
}

function emitUnauthorized(): void {
  window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT))
}

export async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  let res: Response
  try {
    res = await fetch(API_BASE + path, {
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers ?? {}),
      },
      ...options,
    })
  } catch (e) {
    // Network failure / CORS / daemon down. Surface to the user so silent
    // `catch { ignore }` patterns upstream don't hide real outages.
    toast.error('Network error — is the daemon running on :9101?')
    throw e
  }

  if (res.status === 204) return undefined as T
  if (res.status === 401) {
    // Distinguish "scalar 401 on a web route" (real session loss) from
    // machine-only endpoints (those never go through this client).
    emitUnauthorized()
    throw new HTTPError(401, 'Session expired')
  }
  if (!res.ok) {
    let msg = `HTTP ${res.status}`
    try {
      const body = await res.json()
      if (body?.error) msg = body.error
    } catch {
      // non-JSON error
    }
    throw new HTTPError(res.status, msg)
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