import { sessionsStore, type Session } from '../state/sessions'
import { hierarchyStore } from '../state/hierarchy'
import { sendInput } from '../api/agent'
import { renderTimeline } from './timeline'
import { esc, trunc, formatPayload } from '../utils/format'

// Render the session cards list. Replaces dashboard.html's render().
export function renderSessionCards(): void {
  const container = document.getElementById('cards-container')
  if (!container) return

  // Determine filter scope from hierarchy selection.
  let topicKeys: Set<string> | null = null
  let storyKey: string | null = null
  if (hierarchyStore.selectedStoryId && hierarchyStore.tree) {
    storyKey = findStorySessionKey(hierarchyStore.selectedStoryId)
  } else if (hierarchyStore.selectedTopicId && hierarchyStore.tree) {
    topicKeys = collectTopicSessionKeys(hierarchyStore.selectedTopicId)
  }

  const list = sessionsStore.filteredList(topicKeys, storyKey)
  const countEl = document.getElementById('sess-count')
  if (countEl) countEl.textContent = `${list.length} sessions`

  if (list.length === 0) {
    container.innerHTML = '<div class="empty-state">No sessions in this view</div>'
    return
  }
  container.innerHTML = list.map(renderSessionCard).join('')
  // Bind web-input send buttons.
  container.querySelectorAll('[data-send]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      const key = (btn as HTMLElement).dataset.send ?? ''
      void onSendInput(key)
    })
  })
}

function renderSessionCard(s: Session): string {
  const key = s.session_key
  const open = sessionsStore.expandedCards[key] ? ' open' : ''
  const hasTurns = s.turns && s.turns.length > 0
  const hasPayload = s.payload && s.payload !== 'null'
  return `<div class="session-card">
    <div class="card-header" onclick="window.__toggleCard('${key}')">
      <span class="card-agent">${esc(s.agent_type)}</span>
      <span class="card-title">${esc(s.session_title || s.agent_session_id)}</span>
      <div class="card-meta">
        <span class="badge badge-${s.status}">${s.status}</span>
        ${s.last_hook_event ? `<span class="badge badge-event">${esc(s.last_hook_event)}</span>` : ''}
        <span>${esc(s.terminal || '-')}</span>
        <span>CPU ${s.cpu_percent ? s.cpu_percent.toFixed(1) + '%' : '-'}</span>
        <span>MEM ${s.memory_mb ? s.memory_mb.toFixed(0) + 'MB' : '-'}</span>
        <span>T${s.turn_count || 0}</span>
      </div>
    </div>
    <div class="card-body${open}">
      <div class="info-grid">
        <div class="info-item"><span class="info-key">Session</span><span class="info-val">${esc(trunc(s.agent_session_id, 12))}</span></div>
        <div class="info-item"><span class="info-key">PID</span><span class="info-val">${s.pid || '-'}</span></div>
        <div class="info-item"><span class="info-key">Terminal</span><span class="info-val">${esc(s.terminal || '-')}</span></div>
        <div class="info-item"><span class="info-key">CWD</span><span class="info-val">${esc(trunc(s.cwd ?? '', 30))}</span></div>
        <div class="info-item"><span class="info-key">Turns</span><span class="info-val">${s.turn_count || 0}</span></div>
      </div>
      ${hasTurns ? renderTimeline(s.turns!, key) : ''}
      ${hasPayload ? `<div class="payload-section"><div class="tl-payload-toggle" onclick="event.stopPropagation();window.__togglePayload('${key}')"><span class="tl-arrow">▶</span> Raw Payload</div><div class="tl-payload-body" data-payload="${key}"><pre>${esc(formatPayload(s.payload))}</pre></div></div>` : ''}
      <div class="web-input-row" onclick="event.stopPropagation()">
        <input type="text" id="input-${key}" placeholder="Send prompt to agent..." onkeydown="if(event.key==='Enter')window.__sendInput('${key}')">
        <button data-send="${key}">Send</button>
      </div>
    </div>
  </div>`
}

async function onSendInput(key: string): Promise<void> {
  const input = document.getElementById('input-' + key) as HTMLInputElement | null
  if (!input) return
  const text = input.value.trim()
  if (!text) return
  try {
    await sendInput(key, text)
    input.value = ''
  } catch {
    // ignore
  }
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

export function bindCardHandlers(): void {
  const w = window as unknown as Record<string, unknown>
  w.__toggleCard = (key: string) => sessionsStore.toggleCard(key)
  w.__togglePayload = (key: string) => sessionsStore.togglePayload(key)
  w.__sendInput = (key: string) => onSendInput(key)
}
