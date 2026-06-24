// Pure formatting helpers migrated from dashboard.html. These are used across
// UI modules for safe HTML escaping and text truncation.

export function esc(s: unknown): string {
  if (s === null || s === undefined || s === false) return ''
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function trunc(s: string | null | undefined, max: number): string {
  if (!s) return '-'
  return s.length > max ? s.slice(0, max) + '...' : s
}

export function formatTime(ms: number | null | undefined): string {
  if (!ms) return ''
  const now = Date.now()
  const diff = now - ms
  if (diff < 0) {
    // Clock skew / future timestamp — fall back to absolute.
    return new Date(ms).toLocaleTimeString('en-US', { hour12: false })
  }
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  if (diff < 30 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`
  // Older than 30 days: show absolute date.
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// formatTimeAbsolute is the legacy absolute-time variant, used where the
// timeline header wants a verifiable timestamp rather than a fuzzy "5m ago".
export function formatTimeAbsolute(ms: number | null | undefined): string {
  if (!ms) return ''
  return new Date(ms).toLocaleTimeString('en-US', { hour12: false })
}

export function formatPayload(p: unknown): string {
  if (!p || p === 'null') return ''
  try {
    return JSON.stringify(typeof p === 'string' ? JSON.parse(p) : p, null, 2)
  } catch {
    return String(p)
  }
}

// formatPayloadDisplay removes sensitive fields (daemon_token, _role) before
// pretty-printing — TL-04.
export function formatPayloadDisplay(payload: unknown, eventName: string): string {
  if (!payload || payload === 'null') return eventName
  try {
    const data = typeof payload === 'string' ? JSON.parse(payload) : { ...(payload as Record<string, unknown>) }
    const cleaned = { ...data }
    delete cleaned.daemon_token
    delete cleaned._role
    return JSON.stringify(cleaned, null, 2)
  } catch {
    return eventName
  }
}
