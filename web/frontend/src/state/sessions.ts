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
  last_event_time_ms: number
  turns?: Turn[]
  payload?: unknown
  [key: string]: unknown
}

export type SessionFilter = 'all' | 'active' | 'idle' | 'stopped'

class SessionsStore extends Store {
  sessions: Record<string, Session> = {}
  currentFilter: SessionFilter = 'all'
  expandedCards: Record<string, boolean> = {}
  expandedTurns: Record<string, boolean> = {}
  expandedToolGroups: Record<string, boolean> = {}
  expandedPayloads: Record<string, boolean> = {}

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
        // Merge idempotently (SESS-03): Object.assign per field.
        const key = event.session_key as string
        const changes = event.changes as Record<string, unknown>
        if (this.sessions[key]) {
          Object.assign(this.sessions[key], changes)
        }
        this.notify()
        break
      }
    }
  }

  setFilter(f: SessionFilter): void {
    this.currentFilter = f
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

  togglePayload(key: string): void {
    this.expandedPayloads[key] = !this.expandedPayloads[key]
    this.notify()
  }

  // filteredList applies the current status filter + selected-topic/story
  // filtering (driven by hierarchy store). Sorted newest-first (SESS-06).
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
    if (this.currentFilter !== 'all') {
      list = list.filter((s) => s.status === this.currentFilter)
    }
    list.sort((a, b) => b.last_event_time_ms - a.last_event_time_ms)
    return list
  }
}

export const sessionsStore = new SessionsStore()
