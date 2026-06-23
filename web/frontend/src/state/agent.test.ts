import { describe, it, expect, beforeEach } from 'vitest'
import { agentStore } from './agent'

describe('agentStore', () => {
  beforeEach(() => {
    agentStore.executions = []
    agentStore.currentExecId = null
  })

  it('agent_exec_started adds an execution (AG-11)', () => {
    agentStore.applyEvent({
      type: 'agent_exec_started',
      exec_id: 'exec_1',
      agent_type: 'claude',
      session_id: 'sid',
      prompt: 'hi',
    })
    expect(agentStore.executions).toHaveLength(1)
    expect(agentStore.executions[0].id).toBe('exec_1')
    expect(agentStore.executions[0].status).toBe('running')
  })

  it('duplicate exec_started does not double-insert (AG-IDEM)', () => {
    agentStore.applyEvent({ type: 'agent_exec_started', exec_id: 'exec_1', agent_type: 'claude', session_id: 'sid', prompt: 'hi' })
    agentStore.applyEvent({ type: 'agent_exec_started', exec_id: 'exec_1', agent_type: 'claude', session_id: 'sid', prompt: 'hi' })
    expect(agentStore.executions).toHaveLength(1)
  })

  it('agent_message appends to the execution (AG-11)', () => {
    agentStore.applyEvent({ type: 'agent_exec_started', exec_id: 'exec_1', agent_type: 'claude', session_id: 'sid', prompt: 'hi' })
    agentStore.applyEvent({ type: 'agent_message', exec_id: 'exec_1', msg_type: 'text', content: 'hello' })
    expect(agentStore.executions[0].messages).toHaveLength(1)
    expect(agentStore.executions[0].messages[0].content).toBe('hello')
  })

  it('is_final marks execution completed (AG-12)', () => {
    agentStore.applyEvent({ type: 'agent_exec_started', exec_id: 'exec_1', agent_type: 'claude', session_id: 'sid', prompt: 'hi' })
    agentStore.applyEvent({ type: 'agent_message', exec_id: 'exec_1', msg_type: 'text', content: 'done', is_final: true })
    expect(agentStore.executions[0].status).toBe('completed')
  })

  it('agent_error marks execution error (AG-04)', () => {
    agentStore.applyEvent({ type: 'agent_exec_started', exec_id: 'exec_1', agent_type: 'claude', session_id: 'sid', prompt: 'hi' })
    agentStore.applyEvent({ type: 'agent_error', exec_id: 'exec_1', error: 'boom' })
    expect(agentStore.executions[0].status).toBe('error')
    expect(agentStore.executions[0].error).toBe('boom')
  })

  it('agent_cancelled marks execution cancelled (AG-07)', () => {
    agentStore.applyEvent({ type: 'agent_exec_started', exec_id: 'exec_1', agent_type: 'claude', session_id: 'sid', prompt: 'hi' })
    agentStore.applyEvent({ type: 'agent_cancelled', exec_id: 'exec_1' })
    expect(agentStore.executions[0].status).toBe('cancelled')
  })

  it('agent_executions replaces history (AG-06 reconnect)', () => {
    agentStore.applyEvent({ type: 'agent_exec_started', exec_id: 'exec_1', agent_type: 'claude', session_id: 'sid', prompt: 'hi' })
    agentStore.applyEvent({
      type: 'agent_executions',
      executions: [{ id: 'exec_2', status: 'completed', messages: [], created_at: '2026-01-01T00:00:00Z' }],
    })
    expect(agentStore.executions).toHaveLength(1)
    expect(agentStore.executions[0].id).toBe('exec_2')
  })
})
