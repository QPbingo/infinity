import { Store } from './store'
import type { SSEEvent } from '../sse/manager'

export interface ToolCall { name: string; input: string; output: string; status: string; start_ts: number; end_ts?: number }
export interface TurnEntry { event: string; ts?: number; start_ts?: number; payload?: unknown; tools?: ToolCall[] }
export interface Turn { turn_idx: number; user_input: string; user_ts: number; entries: TurnEntry[] }

export interface Session {
  session_key: string
  agent_type: string
  agent_session_id: string
  status: string
  last_hook_event?: string
  terminal?: string
  cpu_percent?: number
  memory_mb?: number
  turn_count?: number
  pid?: number
  cwd?: string
  session_title?: string
  source?: string
  last_event_time_ms: number
  turns?: Turn[]
  payload?: unknown
  [key: string]: unknown
}

// All statuses the user can filter on. The header filter bar is generated
// from this list so new statuses never need a code path to add a button.
export const SESSION_STATUSES = ['active', 'idle', 'stopped', 'disappeared', 'unknown', 'error'] as const
export type SessionStatus = (typeof SESSION_STATUSES)[number]

// Per-card UI state keys.
export interface CardStatusBadge { status: string }

export type SessionStatusFilter = 'all' | SessionStatus | 'claude' | 'opencode' | 'codex'

class SessionsStore extends Store {
  sessions: Record<string, Session> = {}
  currentFilter: SessionStatusFilter = 'all'
  agentTypeFilter: string = ''
  selectedSessionKey: string | null = null  // '' = all agent types
  expandedCards: Record<string, boolean> = {}
  expandedTurns: Record<string, boolean> = {}
  expandedToolGroups: Record<string, boolean> = {}
  expandedPayloads: Record<string, boolean> = {}
// User's draft input per session — preserved across SSE-driven repaints
  // so they don't lose what they typed when a delta lands mid-keystroke.
  draftInputs: Record<string, string> = {}
  // Timeline search/filter state per session — keyed by session_key.
  timelineSearch: Record<string, string> = {}
  timelineTurnFilter: Record<string, string> = {}

  applyEvent(event: SSEEvent): void {
    switch (event.type) {
      case 'snapshot': {
        // Replace entirely (SESS-01): clear then populate.
        this.sessions = {}
        const list = (event.sessions as Session[]) ?? []
        for (const s of list) this.sessions[s.session_key] = s
        this.notify()
        break
      }
      case 'session_added': {
        const s = event.session as Session
        if (s) this.sessions[s.session_key] = s
        this.notify()
        break
      }
      case 'delta': {
        this.applyDelta(event)
        break
      }
    }
  }

  // applyDelta treats the server's `turns` value as authoritative. Completeness
  // beats local merge cleverness: if the server repairs, reorders, or restores
  // raw entries, the browser must not keep stale client-side fragments.
  private applyDelta(event: SSEEvent): void {
    const key = event.session_key as string
    const changes = event.changes as Record<string, unknown>
    if (!key || !changes) return
    const target = this.sessions[key]
    if (!target) return
    const next: Session = { ...target }
    for (const k of Object.keys(changes)) {
      if (k === 'turns') {
        const incoming = changes.turns as Turn[]
        next.turns = incoming ? incoming.slice() : []
        continue
      }
      ;(next as Record<string, unknown>)[k] = changes[k]
    }
    this.sessions[key] = next
    this.notify()
  }

  setFilter(f: SessionStatusFilter): void {
    this.currentFilter = f
    this.notify()
  }

  setAgentTypeFilter(t: string): void {
    this.agentTypeFilter = t
    this.notify()
  }

  setDraftInput(key: string, value: string): void {
    this.draftInputs[key] = value
  }

  setTimelineSearch(key: string, value: string): void {
    this.timelineSearch[key] = value
    this.notify()
  }

  setTimelineTurnFilter(key: string, value: string): void {
    this.timelineTurnFilter[key] = value
    this.notify()
  }

  toggleCard(key: string): void {
    this.expandedCards[key] = !this.expandedCards[key]
    this.notify()
  }

  toggleTurn(key: string, turnIdx: number): void {
    const id = `${key}_turn_${turnIdx}`
    this.expandedTurns[id] = !this.expandedTurns[id]
    this.notify()
  }

  toggleToolGroup(key: string, turnIdx: number, entryIdx: number): void {
    const id = `${key}_${turnIdx}_${entryIdx}`
    this.expandedToolGroups[id] = !this.expandedToolGroups[id]
    this.notify()
  }

  toggleToolDetail(id: string): void {
    this.expandedToolGroups[id] = !this.expandedToolGroups[id]
    this.notify()
  }

  toggleEntryPayload(key: string, turnIdx: number, entryIdx: number): void {
    const id = `${key}_${turnIdx}_${entryIdx}`
    this.expandedPayloads[id] = !this.expandedPayloads[id]
    this.notify()
  }

  togglePayload(key: string): void {
    this.expandedPayloads[key] = !this.expandedPayloads[key]
    this.notify()
  }

  // filteredList applies the current status filter + selected-topic/story
  // filtering + agent type filter. Sorted newest-first (SESS-06).
  filteredList(topicSessionKeys: Set<string> | null, storySessionKey: string | null): Session[] {
    let list = Object.values(this.sessions)
    if (storySessionKey) {
      list = list.filter((s) => s.session_key === storySessionKey)
    } else if (topicSessionKeys && topicSessionKeys.size > 0) {
      list = list.filter((s) => topicSessionKeys.has(s.session_key))
    } else if (topicSessionKeys) {
      // topic selected but has no stories → empty
      list = []
    }
    if (this.currentFilter !== 'all' && isStatusFilter(this.currentFilter)) {
      list = list.filter((s) => s.status === this.currentFilter)
    } else if (this.currentFilter !== 'all' && isAgentTypeFilter(this.currentFilter)) {
      list = list.filter((s) => s.agent_type === this.currentFilter)
    }
    if (this.agentTypeFilter) {
      list = list.filter((s) => s.agent_type === this.agentTypeFilter)
    }
    list.sort((a, b) => b.last_event_time_ms - a.last_event_time_ms)
    return list
  }

  // Status counts for the filter buttons. Skips "all".
  statusCounts(): Record<string, number> {
    const counts: Record<string, number> = {}
    for (const s of Object.values(this.sessions)) {
      counts[s.status] = (counts[s.status] ?? 0) + 1
    }
    return counts
  }

  agentTypeCounts(): Record<string, number> {
    const counts: Record<string, number> = {}
    for (const s of Object.values(this.sessions)) {
      counts[s.agent_type] = (counts[s.agent_type] ?? 0) + 1
    }
    return counts
  }
}

function isStatusFilter(f: SessionStatusFilter): f is SessionStatus {
  return (SESSION_STATUSES as readonly string[]).includes(f)
}
function isAgentTypeFilter(f: SessionStatusFilter): f is 'claude' | 'opencode' | 'codex' {
  return f === 'claude' || f === 'opencode' || f === 'codex'
}

// mergeTurns blends two turn arrays keyed by turn_idx. Existing turns keep
// their entries (so the UI doesn't lose "is this turn collapsed?");
// incoming turns either overwrite matching idx entries or append.
export function mergeTurns(prev: Turn[], incoming: Turn[]): Turn[] {
  if (!incoming || incoming.length === 0) return prev
  if (prev.length === 0) return incoming.slice()
  const byIdx = new Map<number, Turn>()
  for (const t of prev) byIdx.set(t.turn_idx, t)
  for (const t of incoming) byIdx.set(t.turn_idx, { ...t })  // last-write wins
  const merged = Array.from(byIdx.values())
  merged.sort((a, b) => a.turn_idx - b.turn_idx)
  return merged
}

export const sessionsStore = new SessionsStore()
