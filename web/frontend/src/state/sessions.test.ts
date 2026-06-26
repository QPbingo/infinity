import { describe, it, expect, beforeEach } from 'vitest'
import { sessionsStore, mergeTurns, type Session } from './sessions'

const mk = (key: string, status = 'active'): Session => ({
  session_key: key,
  agent_type: 'claude',
  agent_session_id: key,
  status,
  last_event_time_ms: 1000,
})

describe('sessionsStore', () => {
  beforeEach(() => {
    sessionsStore.sessions = {}
    sessionsStore.currentFilter = 'all'
  })

  it('snapshot replaces entirely (SESS-01)', () => {
    sessionsStore.sessions['old'] = mk('old')
    sessionsStore.applyEvent({ type: 'snapshot', sessions: [mk('s1'), mk('s2')] } as never)
    expect(Object.keys(sessionsStore.sessions)).toEqual(['s1', 's2'])
    expect(sessionsStore.sessions['old']).toBeUndefined()
  })

  it('session_added adds incrementally (SESS-02)', () => {
    sessionsStore.applyEvent({ type: 'snapshot', sessions: [mk('s1')] } as never)
    sessionsStore.applyEvent({ type: 'session_added', session: mk('s3') } as never)
    expect(sessionsStore.sessions['s3']).toBeDefined()
    expect(sessionsStore.sessions['s1']).toBeDefined()
  })

  it('delta merges idempotently per field (SESS-03)', () => {
    sessionsStore.applyEvent({ type: 'snapshot', sessions: [mk('s1')] } as never)
    sessionsStore.applyEvent({ type: 'delta', session_key: 's1', changes: { cpu_percent: 10 } } as never)
    sessionsStore.applyEvent({ type: 'delta', session_key: 's1', changes: { memory_mb: 256 } } as never)
    expect(sessionsStore.sessions['s1'].cpu_percent).toBe(10)
    expect(sessionsStore.sessions['s1'].memory_mb).toBe(256)
  })

  it('delta on unknown session is ignored (no crash)', () => {
    sessionsStore.applyEvent({ type: 'delta', session_key: 'nope', changes: { cpu_percent: 10 } } as never)
    expect(sessionsStore.sessions['nope']).toBeUndefined()
  })

  it('filter by status (SESS-05)', () => {
    sessionsStore.applyEvent({ type: 'snapshot', sessions: [mk('a1', 'active'), mk('i1', 'idle')] } as never)
    sessionsStore.setFilter('active')
    const list = sessionsStore.filteredList(null, null)
    expect(list).toHaveLength(1)
    expect(list[0].status).toBe('active')
  })

  it('sort newest-first by last_event_time_ms (SESS-06)', () => {
    const s1 = mk('s1'); s1.last_event_time_ms = 100
    const s2 = mk('s2'); s2.last_event_time_ms = 500
    sessionsStore.applyEvent({ type: 'snapshot', sessions: [s1, s2] } as never)
    const list = sessionsStore.filteredList(null, null)
    expect(list[0].session_key).toBe('s2')
    expect(list[1].session_key).toBe('s1')
  })

  it('mergeTurns dedupes by turn_idx and preserves order', () => {
    const prev = [{ turn_idx: 0, user_input: 'hi', user_ts: 1, entries: [] }]
    const incoming = [
      { turn_idx: 1, user_input: 'next', user_ts: 2, entries: [] },
      { turn_idx: 0, user_input: 'hi', user_ts: 1, entries: [{ event: 'PreToolUse' }] },
    ]
    const merged = mergeTurns(prev, incoming)
    expect(merged.map((t) => t.turn_idx)).toEqual([0, 1])
    expect(merged[0].entries[0].event).toBe('PreToolUse')
  })

  it('delta preserves draft inputs and treats turns as server-authoritative', () => {
    sessionsStore.applyEvent({ type: 'snapshot', sessions: [mk('k1')] } as never)
    sessionsStore.setDraftInput('k1', 'typing')
    sessionsStore.applyEvent({ type: 'delta', session_key: 'k1', changes: { turn_count: 1, turns: [{ turn_idx: 0, user_input: 'hi', user_ts: 0, entries: [] }] } } as never)
    // delta should not wipe draft inputs.
    expect(sessionsStore.draftInputs['k1']).toBe('typing')
    expect(sessionsStore.sessions['k1'].turns).toHaveLength(1)
    // a second delta replaces with the server-authoritative turns snapshot
    // rather than keeping stale client-side fragments.
    sessionsStore.applyEvent({ type: 'delta', session_key: 'k1', changes: { turn_count: 2, turns: [{ turn_idx: 1, user_input: 'two', user_ts: 1, entries: [] }] } } as never)
    expect(sessionsStore.sessions['k1'].turns).toHaveLength(1)
    expect(sessionsStore.sessions['k1'].turns?.[0].turn_idx).toBe(1)
  })

  it('statusCounts and agentTypeCounts compute live buckets', () => {
    sessionsStore.applyEvent({ type: 'snapshot', sessions: [
      mk('a', 'active'),
      mk('b', 'idle'),
      mk('c', 'idle'),
    ] } as never)
    const sc = sessionsStore.statusCounts()
    expect(sc.active).toBe(1)
    expect(sc.idle).toBe(2)
    const ac = sessionsStore.agentTypeCounts()
    expect(ac.claude).toBe(3)
  })
})
