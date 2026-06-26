import { beforeEach, describe, expect, it } from 'vitest'
import { renderSessionDetail } from './sessionCard'
import { sessionsStore } from '../state/sessions'

describe('renderSessionDetail', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="session-detail-panel"><div>stale session</div></div>'
    sessionsStore.sessions = {}
    sessionsStore.selectedSessionKey = null
  })

  it('clears stale detail content when no session is selected', () => {
    renderSessionDetail()

    const panel = document.getElementById('session-detail-panel')!
    expect(panel.textContent).toContain('Select a session')
    expect(panel.textContent).not.toContain('stale session')
  })

  it('does not render agent_output as a separate section', () => {
    sessionsStore.sessions = {
      live: {
        session_key: 'live',
        agent_type: 'claude',
        agent_session_id: 'sdk-live',
        status: 'active',
        last_event_time_ms: 1000,
        turn_count: 0,
        agent_output: 'streamed output',
        turns: [{ turn_idx: 0, user_input: 'prompt', user_ts: 1000, entries: [] }],
      },
    }
    sessionsStore.selectedSessionKey = 'live'
    renderSessionDetail()

    const panel = document.getElementById('session-detail-panel')!
    expect(panel.textContent).not.toContain('Output')
    expect(panel.textContent).not.toContain('streamed output')
  })
})
