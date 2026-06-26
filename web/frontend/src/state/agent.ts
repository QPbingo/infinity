import { Store } from './store'
import type { SSEEvent } from '../sse/manager'

export interface AgentMessage {
  type?: string
  msg_type?: string
  content?: string
  tool_name?: string
  tool_input?: string
  raw_json?: unknown
  error?: string
}

export interface Execution {
  id: string
  agent_type?: string
  session_id?: string
  prompt?: string
  status: 'running' | 'completed' | 'error' | 'cancelled'
  messages: AgentMessage[]
  created_at: string
  error?: string
}

// Agent execution store. Maintains execution history (newest first) and the
// currently-selected execution. Receives SSE events via applyEvent.
//
// Idempotency (AG-IDEM): duplicate agent_exec_started for the same exec_id
// does NOT insert a second entry — mirroring the old dashboard.html logic at
// line 356.
class AgentStore extends Store {
  executions: Execution[] = []
  currentExecId: string | null = null

  applyEvent(event: SSEEvent): void {
    switch (event.type) {
      case 'agent_executions': {
        const list = (event.executions as Execution[]) ?? []
        this.executions = list.map((e) => ({ ...e, messages: e.messages ?? [] }))
        this.notify()
        break
      }
      case 'agent_exec_started': {
        const execId = event.exec_id as string
        // Idempotent: skip if already present (AG-IDEM).
        if (!this.executions.find((e) => e.id === execId)) {
          this.executions.unshift({
            id: execId,
            agent_type: event.agent_type as string,
            session_id: event.session_id as string,
            prompt: event.prompt as string,
            status: 'running',
            messages: [],
            created_at: new Date().toISOString(),
          })
        }
        this.notify()
        break
      }
      case 'agent_session_created': {
        // Notifies the UI to backfill the session id input (AG-14). Handled
        // by the agent panel via a callback rather than state here.
        this.notify()
        break
      }
      case 'agent_message': {
        const execId = (event.exec_id as string) ?? this.currentExecId
        const target = this.executions.find((e) => e.id === execId)
        if (target) {
          target.messages.push({
            type: event.msg_type as string,
            content: event.content as string,
            tool_name: event.tool_name as string,
            tool_input: event.tool_input as string,
            raw_json: event.raw_json,
            error: event.error as string,
          })
          if (event.is_final) target.status = 'completed'
        }
        this.notify()
        break
      }
      case 'agent_error': {
        const execId = (event.exec_id as string) ?? this.currentExecId
        const target = this.executions.find((e) => e.id === execId)
        if (target) {
          target.status = 'error'
          target.error = event.error as string
        }
        this.notify()
        break
      }
      case 'agent_cancelled': {
        const execId = event.exec_id as string
        const target = this.executions.find((e) => e.id === execId)
        if (target) target.status = 'cancelled'
        this.notify()
        break
      }
    }
  }

  setCurrent(id: string | null): void {
    this.currentExecId = id
    this.notify()
  }
}

export const agentStore = new AgentStore()
