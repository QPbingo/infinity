import { API_BASE, SSE_PATH } from '../config'

// SSE event types pushed by the server. Matches the Go SSEHub message types.
export type SSEEventType =
  | 'snapshot'
  | 'session_added'
  | 'delta'
  | 'hierarchy_snapshot'
  | 'hierarchy_updated'
  | 'agent_executions'
  | 'agent_exec_started'
  | 'agent_session_created'
  | 'agent_message'
  | 'agent_error'
  | 'agent_cancelled'

export interface SSEEvent {
  type: SSEEventType
  [key: string]: unknown
}

export type SSEHandler = (event: SSEEvent) => void

// Heartbeat / timeout tuning. The server sends a `: ping` SSE comment every
// 25s; if we receive nothing (data or comment) for 60s we treat the connection
// as dead and close it so EventSource's auto-reconnect kicks in.
const DEAD_TIMEOUT_MS = 60_000

// SSEManager owns the EventSource connection and dispatches parsed events to
// registered handlers. It also coordinates multi-tab sharing via
// BroadcastChannel: only the "leader" tab holds an actual EventSource; other
// tabs receive events relayed over BroadcastChannel.
//
// Leader election (BC-02/03/04):
//   - The leader broadcasts a `{leader: 1}` heartbeat every 3s.
//   - A follower that does not see a leader heartbeat for 5s becomes leader.
//   - When the leader tab closes (beforeunload), it broadcasts `{leader: -1}`
//     so a follower can immediately take over (no 5s wait).
export class SSEManager {
  private es: EventSource | null = null
  private handlers = new Set<SSEHandler>()
  private deadTimer: ReturnType<typeof setTimeout> | null = null
  private bc: BroadcastChannel | null = null
  private leaderHeartbeat: ReturnType<typeof setInterval> | null = null
  private followerWait: ReturnType<typeof setTimeout> | null = null
  private isLeader = false
  private disposed = false

  constructor() {
    this.initBroadcastChannel()
  }

  // Start the connection. Decides leader/follower role.
  connect(): void {
    if (this.disposed) return
    if (typeof BroadcastChannel !== 'undefined') {
      // Ask if there's already a leader; wait briefly before self-promoting.
      this.bc?.postMessage({ kind: 'whois_leader' })
      this.followerWait = setTimeout(() => this.becomeLeader(), 500)
    } else {
      // No BroadcastChannel support — always leader (single-tab fallback).
      this.becomeLeader()
    }
  }

  private initBroadcastChannel(): void {
    if (typeof BroadcastChannel === 'undefined') return
    this.bc = new BroadcastChannel('agent-monitor-sse')
    this.bc.onmessage = (e) => this.onBCMessage(e.data)
    window.addEventListener('beforeunload', () => {
      if (this.isLeader) this.bc?.postMessage({ kind: 'leader_gone' })
    })
  }

  private onBCMessage(msg: { kind: string; event?: SSEEvent }): void {
    switch (msg.kind) {
      case 'leader_here':
        // A leader exists; cancel self-promotion.
        if (this.followerWait) {
          clearTimeout(this.followerWait)
          this.followerWait = null
        }
        break
      case 'leader_heartbeat':
        // Leader is alive; reset takeover timer.
        if (this.followerWait) clearTimeout(this.followerWait)
        this.followerWait = setTimeout(() => this.becomeLeader(), 5_000)
        break
      case 'leader_gone':
      case 'whois_leader':
        if (this.isLeader) {
          this.bc?.postMessage({ kind: 'leader_here' })
        }
        if (msg.kind === 'leader_gone' && !this.isLeader) {
          // Leader left; try to take over quickly.
          if (this.followerWait) clearTimeout(this.followerWait)
          this.followerWait = setTimeout(() => this.becomeLeader(), 200)
        }
        break
      case 'relay_event':
        if (msg.event) this.dispatch(msg.event)
        break
    }
  }

  private becomeLeader(): void {
    if (this.isLeader) return
    this.isLeader = true
    this.bc?.postMessage({ kind: 'leader_here' })
    // Heartbeat so followers know we're alive (BC-03).
    this.leaderHeartbeat = setInterval(() => {
      this.bc?.postMessage({ kind: 'leader_heartbeat' })
    }, 3_000)
    this.openEventSource()
  }

  private openEventSource(): void {
    if (this.es) this.es.close()
    const url = API_BASE + SSE_PATH
    this.es = new EventSource(url, { withCredentials: true })

    this.es.onmessage = (e) => {
      this.resetDeadTimer()
      try {
        const event = JSON.parse(e.data) as SSEEvent
        this.dispatch(event)
        // Relay to follower tabs.
        this.bc?.postMessage({ kind: 'relay_event', event })
      } catch {
        // ignore malformed
      }
    }

    // `: ping` comments do not trigger onmessage; EventSource fires onmessage
    // only for unnamed data events. The server sends pings as comments which
    // keep the TCP connection alive but are not exposed to JS. We rely on the
    // dead timer + the server's actual data events for liveness. To detect
    // pings, we use onerror/onopen timing as a proxy.
    this.es.onopen = () => this.resetDeadTimer()

    this.es.onerror = () => {
      // EventSource auto-reconnects on transient errors. If the connection is
      // CLOSED (readyState 2, not reconnecting), and it looks like auth
      // failure, close and notify so the UI can show the login page
      // (constraint D). readyState 2 === EventSource.CLOSED; we use the
      // numeric literal to avoid depending on the EventSource constructor
      // being present in the global scope at runtime.
      if (this.es?.readyState === 2) {
        this.clearDeadTimer()
        // A CLOSED state after an error usually means the server returned a
        // non-200 (e.g. 401) and gave up. Treat as auth failure.
        this.dispatch({ type: 'agent_error', error: 'sse_closed', __auth: true } as SSEEvent)
      }
      // Otherwise (readyState 0/CONNECTING), EventSource is retrying; reset
      // the dead timer so we don't fire while it's reconnecting.
      this.resetDeadTimer()
    }
    this.resetDeadTimer()
  }

  private resetDeadTimer(): void {
    if (this.deadTimer) clearTimeout(this.deadTimer)
    this.deadTimer = setTimeout(() => {
      // No traffic for DEAD_TIMEOUT_MS — force reconnect.
      if (this.es) {
        this.es.close()
        this.openEventSource()
      }
    }, DEAD_TIMEOUT_MS)
  }

  private clearDeadTimer(): void {
    if (this.deadTimer) {
      clearTimeout(this.deadTimer)
      this.deadTimer = null
    }
  }

  private dispatch(event: SSEEvent): void {
    for (const h of this.handlers) {
      try {
        h(event)
      } catch {
        // handler errors must not break other handlers
      }
    }
  }

  on(handler: SSEHandler): void {
    this.handlers.add(handler)
  }

  off(handler: SSEHandler): void {
    this.handlers.delete(handler)
  }

  close(): void {
    this.disposed = true
    this.clearDeadTimer()
    if (this.leaderHeartbeat) clearInterval(this.leaderHeartbeat)
    if (this.followerWait) clearTimeout(this.followerWait)
    if (this.es) {
      this.es.close()
      this.es = null
    }
    if (this.isLeader) this.bc?.postMessage({ kind: 'leader_gone' })
    this.bc?.close()
    this.bc = null
  }
}
