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
})
