import { sessionsStore, type Session } from '../state/sessions'
import { hierarchyStore } from '../state/hierarchy'
import { sendInput } from '../api/agent'
import { renderTimeline } from './timeline'
import { esc, trunc } from '../utils/format'
import { toast } from './toast'

// renderSessionList — session rows in left panel
export function renderSessionList(): void {
  const body = document.getElementById('session-list-body')
  if (!body) return

  let topicKeys: Set<string> | null = null
  let storyKey: string | null = null
  if (hierarchyStore.selectedStoryId && hierarchyStore.tree) {
    storyKey = findStorySessionKey(hierarchyStore.selectedStoryId)
    // If a story is selected but has no linked session, show empty rather
    // than unfiltered list (filteredList with null,null would return ALL).
    if (!storyKey) {
      body.innerHTML = '<div class="empty-state"><h3>No sessions linked</h3><p>This story is not yet linked to a session.</p></div>'
      return
    }
  } else if (hierarchyStore.selectedTopicId && hierarchyStore.tree) {
    topicKeys = collectTopicSessionKeys(hierarchyStore.selectedTopicId)
  }

  const list = sessionsStore.filteredList(topicKeys, storyKey)
  if (list.length === 0) {
    body.innerHTML = '<div class="empty-state"><h3>No sessions</h3><p>Select a topic on the left or wait for agent events.</p></div>'
    return
  }

  body.innerHTML = list.map(s => renderSessionRow(s)).join('')
  body.querySelectorAll('.session-row').forEach(row => {
    row.addEventListener('click', () => {
      body.querySelectorAll('.session-row').forEach(r => r.classList.remove('selected'))
      row.classList.add('selected')
      const key = (row as HTMLElement).dataset.key || ''
      sessionsStore.selectedSessionKey = key
      renderSessionDetail()
    })
  })
}

function renderSessionRow(s: Session): string {
  const key = esc(s.session_key)
  const sel = sessionsStore.selectedSessionKey === s.session_key ? ' selected' : ''
  const title = s.session_title || s.agent_session_id || key
  const sub = [trunc(s.agent_session_id, 20), s.terminal || '-', s.memory_mb ? `${s.memory_mb.toFixed(0)}MB` : ''].filter(Boolean).join(' · ')
  return `<div class="session-row${sel}" data-key="${key}">
    <span class="row-status ${s.status}"></span>
    <span class="agent-badge ${s.agent_type}">${esc(s.agent_type)}</span>
    <span class="row-info">
      <span class="row-title">${esc(title)}</span>
      <span class="row-sub">${esc(sub)}</span>
    </span>
    <span class="row-meta">
      <span>T${s.turn_count || 0}</span>
      <span class="cpu" style="color:${s.cpu_percent ? 'var(--accent)' : 'var(--text-tertiary)'}">${s.cpu_percent ? s.cpu_percent.toFixed(0) + '%' : '—'}</span>
    </span>
  </div>`
}

// renderSessionDetail — right detail panel
export function renderSessionDetail(): void {
  const panel = document.getElementById('session-detail-panel')
  if (!panel) return
  if (!sessionsStore.selectedSessionKey) {
    panel.innerHTML = '<div class="empty-state" id="detail-empty"><h3>Select a session</h3><p>Choose a session from the list to view its timeline and details.</p></div>'
    return
  }
  const s = sessionsStore.sessions[sessionsStore.selectedSessionKey]
  if (!s) {
    panel.innerHTML = '<div class="empty-state"><h3>Session not found</h3></div>'
    return
  }

  // Preserve scroll position and input draft across SSE-driven rebuilds.
  const scrollTop = panel.scrollTop
  const draftKey = 'detail-input-' + esc(s.session_key)
  const existingInput = document.getElementById(draftKey) as HTMLInputElement | null
  const draftValue = existingInput ? existingInput.value : (sessionsStore.draftInputs[s.session_key] || '')

  const title = s.session_title || s.agent_session_id
  const hasTurns = s.turns && s.turns.length > 0
  const isError = s.status === 'error' || s.status === 'disappeared' || s.status === 'unknown'
  const actions = ''

  panel.innerHTML = `<div class="session-detail-content">
    <div class="detail-header">
      <span class="agent-badge ${s.agent_type}">${esc(s.agent_type)}</span>
      <span class="detail-title">${esc(title)}</span>
      <span class="status-badge ${s.status}">${s.status}</span>
      <div class="detail-actions">${actions}</div>
    </div>
    ${isError ? renderErrorAlert(s) : ''}
    <div class="info-grid">
      <div class="info-item"><div class="info-label">Session</div><div class="info-value">${esc(trunc(s.agent_session_id, 16))}</div></div>
      <div class="info-item"><div class="info-label">PID</div><div class="info-value">${s.pid || '—'}</div></div>
      <div class="info-item"><div class="info-label">Terminal</div><div class="info-value">${esc(s.terminal || '—')}</div></div>
      <div class="info-item"><div class="info-label">CWD</div><div class="info-value">${esc(trunc(s.cwd || '', 36))}</div></div>
      <div class="info-item"><div class="info-label">Turns</div><div class="info-value">${s.turn_count || 0}</div></div>
      <div class="info-item"><div class="info-label">CPU / Memory</div><div class="info-value">${s.cpu_percent ? s.cpu_percent.toFixed(0) + '%' : '—'} · ${s.memory_mb ? s.memory_mb.toFixed(0) + ' MB' : '—'}</div></div>
    </div>
    ${hasTurns ? '<div class="detail-section-title">Timeline</div>' + renderTimeline(s.turns!, s.session_key) : ''}
    <div class="session-input-row">
      <input type="text" id="detail-input-${esc(s.session_key)}" placeholder="Send input to this session...">
      <button class="btn btn-primary" data-send="${esc(s.session_key)}">Send</button>
    </div>
  </div>`

  const sendBtn = panel.querySelector(`[data-send="${esc(s.session_key)}"]`)
  if (sendBtn) {
    sendBtn.addEventListener('click', () => onSendDetail(s.session_key))
  }
  const inputEl = panel.querySelector('input') as HTMLInputElement | null
  if (inputEl) {
    inputEl.onkeydown = (e) => { if (e.key === 'Enter') onSendDetail(s.session_key) }
  }
  // Restore draft input value and scroll position after rebuilding innerHTML.
  const restoredInput = document.getElementById(draftKey) as HTMLInputElement | null
  if (restoredInput && draftValue) restoredInput.value = draftValue
  panel.scrollTop = scrollTop
}

function renderErrorAlert(s: Session): string {
  return `<div class="error-alert">
    <div class="error-alert-title">${s.status === 'error' ? 'Error' : 'Process disconnected'}</div>
    <div class="error-alert-detail">${esc(s.agent_output || 'No additional details.')}</div>
  </div>`
}

async function onSendDetail(key: string): Promise<void> {
  const input = document.getElementById('detail-input-' + key) as HTMLInputElement | null
  if (!input) return
  const text = input.value.trim()
  if (!text) return
  try {
    await sendInput(key, text)
    input.value = ''
    toast.ok('Sent')
  } catch (e) {
    toast.error('Send failed')
  }
}

export function bindSessionHandlers(): void {
  // Delegated handlers are set up by renderSessionList / renderSessionDetail.
}

function findStorySessionKey(storyId: number): string | null {
  for (const ws of hierarchyStore.tree?.workspaces ?? []) {
    for (const proj of ws.projects ?? []) {
      for (const topic of proj.topics ?? []) {
        for (const story of topic.stories ?? []) {
          if (story.id === storyId) return story.session_key || null
        }
      }
    }
  }
  return null
}

function collectTopicSessionKeys(topicId: number): Set<string> {
  const keys = new Set<string>()
  for (const ws of hierarchyStore.tree?.workspaces ?? []) {
    for (const proj of ws.projects ?? []) {
      for (const topic of proj.topics ?? []) {
        if (topic.topic.id === topicId) {
          for (const story of topic.stories ?? []) {
            if (story.session_key) keys.add(story.session_key)
          }
        }
      }
    }
  }
  return keys
}
