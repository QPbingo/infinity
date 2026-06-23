import { sessionsStore, type Session } from '../state/sessions'
import { hierarchyStore } from '../state/hierarchy'
import { sendInput } from '../api/agent'
import { renderTimeline } from './timeline'
import { esc, trunc, formatPayload } from '../utils/format'
import { toast } from './toast'

// renderSessionCards reconciles the cards container with the latest filtered
// session list. Instead of `container.innerHTML = list.map(...).join('')`
// (which destroys every DOM node, every input caret, and every textarea
// draft on every delta), it does a keyed diff:
//   - Stable cards keep their DOM node (input drafts + caret preserved).
//   - Changed cards get `outerHTML` swapped in place.
//   - Removed cards drop out of the DOM.
//   - New cards appended at the end.
//
// Event handling is delegated via data-* attributes on the container, so the
// module no longer exports `window.__toggleCard` etc. — single bind call
// for the app's lifetime.

let lastOrder: string[] = []  // session_keys in DOM order, last render

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
    container.innerHTML = emptyStateHTML()
    lastOrder = []
    return
  }

  const newOrder = list.map((s) => s.session_key)

  // Diff: walk children by id and patch.
  // Existing children: keyed by data-key.
  const existingByKey = new Map<string, Element>()
  Array.from(container.children).forEach((el) => {
    const k = el.getAttribute('data-key')
    if (k) existingByKey.set(k, el)
  })

  // Build new DOM in order. We append-dedupe so unused nodes are removed.
  const newEls: Element[] = []
  for (const s of list) {
    const existing = existingByKey.get(s.session_key)
    if (existing) {
      patchCard(existing as HTMLElement, s)
      newEls.push(existing)
    } else {
      const tpl = document.createElement('template')
      tpl.innerHTML = renderSessionCard(s).trim()
      newEls.push(tpl.content.firstElementChild as Element)
    }
  }

  // Remove nodes that are no longer in the list.
  for (const el of existingByKey.values()) {
    if (!newEls.includes(el)) el.remove()
  }

  // Append in correct order. If order changed, use replaceWith / append.
  if (lastOrder.join('|') !== newOrder.join('|')) {
    newEls.forEach((el, i) => {
      const ref = container.children[i]
      if (ref !== el) {
        if (ref) container.insertBefore(el, ref)
        else container.appendChild(el)
      }
    })
  }

  lastOrder = newOrder
  container.classList.toggle('is-empty', list.length === 0)
}

function emptyStateHTML(): string {
  const hasWS = hierarchyStore.tree?.workspaces?.length ?? 0
  return `<div class="empty-state">
    <h3>No sessions in this view</h3>
    <p>${hasWS ? 'Pick a topic on the left or change filters to see agent sessions.' : 'Create a workspace with the + button below to get started.'}</p>
    <button class="btn-primary" data-action="goto-first-workspace">${hasWS ? 'Browse hierarchy' : 'Create workspace'}</button>
  </div>`
}

function renderSessionCard(s: Session): string {
  const key = esc(s.session_key)
  const open = sessionsStore.expandedCards[s.session_key] ? ' open' : ''
  const hasTurns = s.turns && s.turns.length > 0
  const hasPayload = s.payload && s.payload !== 'null'
  return `<div class="session-card" data-key="${key}">
    <div class="card-header" data-action="toggle-card" data-key="${key}">
      <span class="card-agent">${esc(s.agent_type)}</span>
      <span class="card-title">${esc(s.session_title || s.agent_session_id)}</span>
      <div class="card-meta">
        <span class="badge badge-${esc(s.status)}">${esc(s.status)}</span>
        ${s.last_hook_event ? `<span class="badge badge-event">${esc(s.last_hook_event)}</span>` : ''}
        <span>${esc(s.terminal || '-')}</span>
        <span>CPU ${s.cpu_percent ? s.cpu_percent.toFixed(1) + '%' : '-'}</span>
        <span>MEM ${s.memory_mb ? s.memory_mb.toFixed(0) + 'MB' : '-'}</span>
        <span>T${s.turn_count || 0}</span>
      </div>
    </div>
    <div class="card-body${open}">
      <div class="info-grid">
        <div class="info-item"><span class="info-key">Session</span><span class="info-val" title="${esc(s.agent_session_id)}">${esc(trunc(s.agent_session_id, 16))}</span></div>
        <div class="info-item"><span class="info-key">PID</span><span class="info-val">${s.pid || '-'}</span></div>
        <div class="info-item"><span class="info-key">Terminal</span><span class="info-val">${esc(s.terminal || '-')}</span></div>
        <div class="info-item"><span class="info-key">CWD</span><span class="info-val" title="${esc(s.cwd ?? '')}">${esc(trunc(s.cwd ?? '', 40))}</span></div>
        <div class="info-item"><span class="info-key">Turns</span><span class="info-val">${s.turn_count || 0}</span></div>
      </div>
      ${hasTurns ? renderTimeline(s.turns!, s.session_key) : ''}
      ${hasPayload ? `<div class="payload-section"><div class="tl-payload-toggle" data-action="toggle-payload" data-key="${key}"><span class="tl-arrow ${sessionsStore.expandedPayloads[s.session_key] ? 'open' : ''}">▶</span> Raw Payload</div><div class="tl-payload-body ${sessionsStore.expandedPayloads[s.session_key] ? 'open' : ''}"><pre>${esc(formatPayload(s.payload))}</pre></div></div>` : ''}
      <div class="web-input-row">
        <input type="text" placeholder="Send prompt to agent..." data-input="${key}" value="${esc(sessionsStore.draftInputs[s.session_key] || '')}">
        <button data-action="send-input" data-key="${key}">Send</button>
      </div>
    </div>
  </div>`
}

// patchCard mutates an existing card's bits that change frequently (status
// badge, meta numbers, body content) without touching the input row.
function patchCard(el: HTMLElement, s: Session): void {
  const wasOpen = el.querySelector('.card-body')?.classList.contains('open') ?? false
  const nowOpen = !!sessionsStore.expandedCards[s.session_key]
  // Refresh header meta cheaply.
  const header = el.querySelector('.card-header') as HTMLElement | null
  if (header) {
    const metaHTML = `<span class="badge badge-${esc(s.status)}">${esc(s.status)}</span>
      ${s.last_hook_event ? `<span class="badge badge-event">${esc(s.last_hook_event)}</span>` : ''}
      <span>${esc(s.terminal || '-')}</span>
      <span>CPU ${s.cpu_percent ? s.cpu_percent.toFixed(1) + '%' : '-'}</span>
      <span>MEM ${s.memory_mb ? s.memory_mb.toFixed(0) + 'MB' : '-'}</span>
      <span>T${s.turn_count || 0}</span>`
    const meta = header.querySelector('.card-meta') as HTMLElement | null
    if (meta) meta.innerHTML = metaHTML
  }
  // Patch the title in case it changed.
  const titleEl = header?.querySelector('.card-title') as HTMLElement | null
  if (titleEl) titleEl.textContent = s.session_title || s.agent_session_id
  // Rebuild body when toggled open OR turns changed — comparing turn counts.
  const body = el.querySelector('.card-body') as HTMLElement | null
  if (!body) return
  if (nowOpen !== wasOpen) {
    body.classList.toggle('open', nowOpen)
    if (nowOpen) {
      const tpl = document.createElement('template')
      tpl.innerHTML = renderSessionBody(s).trim()
      const newBody = tpl.content.firstElementChild as HTMLElement
      body.innerHTML = newBody.innerHTML
    } else {
      // Closing: keep DOM but hide — preserves draft input.
      return
    }
  } else if (nowOpen) {
    // Already open and still open: refresh turns / payload if turn_count changed
    // OR timeline toggle/search/filter state changed. This avoids overwriting
    // the input row (which would clip the user's draft and caret) on every
    // delta that doesn't touch turns.
    const tracked = patchedTurnCount.get(s.session_key) ?? -1
    const currentTurns = s.turns?.length ?? 0
    const fp = timelineFingerprint(s.session_key)
    const fpChanged = patchedTimelineFingerprint.get(s.session_key) !== fp
    if (tracked !== currentTurns || fpChanged) {
      patchedTurnCount.set(s.session_key, currentTurns)
      patchedTimelineFingerprint.set(s.session_key, fp)
      const body2 = document.createElement('template')
      body2.innerHTML = renderSessionBody(s).trim()
      const newBody = body2.content.firstElementChild as HTMLElement
      // Replace child nodes except the draft input row to preserve caret.
      const inputRowOld = body.querySelector('.web-input-row') as HTMLElement | null
      body.innerHTML = newBody.innerHTML
      const inputRowNew = body.querySelector('.web-input-row') as HTMLElement | null
      if (inputRowOld && inputRowNew) {
        inputRowNew.replaceWith(inputRowOld)
      }
    }
  }
}

// Track which sessions had how many turns last render, so patchCard can skip
// rebuilding the body when there's nothing new to show.
const patchedTurnCount = new Map<string, number>()

// Tracks a fingerprint of per-session timeline UI state (toggle states, search,
// filter) so patchCard detects changes that don't affect turn count.
const patchedTimelineFingerprint = new Map<string, string>()

function timelineFingerprint(key: string): string {
  // Collect all toggle + search/filter state for this session into a stable key.
  const store = sessionsStore
  const parts: string[] = []
  for (const k of Object.keys(store.expandedTurns))    if (k.startsWith(key)) parts.push(`t:${k}=${store.expandedTurns[k] ? 1 : 0}`)
  for (const k of Object.keys(store.expandedToolGroups)) if (k.startsWith(key)) parts.push(`g:${k}=${store.expandedToolGroups[k] ? 1 : 0}`)
  for (const k of Object.keys(store.expandedPayloads)) if (k.startsWith(key)) parts.push(`p:${k}=${store.expandedPayloads[k] ? 1 : 0}`)
  parts.push(`s:${store.timelineSearch[key] ?? ''}`)
  parts.push(`f:${store.timelineTurnFilter[key] ?? 'all'}`)
  return parts.join('|')
}

function renderSessionBody(s: Session): string {
  const key = esc(s.session_key)
  const hasTurns = s.turns && s.turns.length > 0
  const hasPayload = s.payload && s.payload !== 'null'
  return `<div class="card-body open">
      <div class="info-grid">
        <div class="info-item"><span class="info-key">Session</span><span class="info-val" title="${esc(s.agent_session_id)}">${esc(trunc(s.agent_session_id, 16))}</span></div>
        <div class="info-item"><span class="info-key">PID</span><span class="info-val">${s.pid || '-'}</span></div>
        <div class="info-item"><span class="info-key">Terminal</span><span class="info-val">${esc(s.terminal || '-')}</span></div>
        <div class="info-item"><span class="info-key">CWD</span><span class="info-val" title="${esc(s.cwd ?? '')}">${esc(trunc(s.cwd ?? '', 40))}</span></div>
        <div class="info-item"><span class="info-key">Turns</span><span class="info-val">${s.turn_count || 0}</span></div>
      </div>
      ${hasTurns ? renderTimeline(s.turns!, s.session_key) : ''}
      ${hasPayload ? `<div class="payload-section"><div class="tl-payload-toggle" data-action="toggle-payload" data-key="${key}"><span class="tl-arrow ${sessionsStore.expandedPayloads[s.session_key] ? 'open' : ''}">▶</span> Raw Payload</div><div class="tl-payload-body ${sessionsStore.expandedPayloads[s.session_key] ? 'open' : ''}"><pre>${esc(formatPayload(s.payload))}</pre></div></div>` : ''}
      <div class="web-input-row">
        <input type="text" placeholder="Send prompt to agent..." data-input="${key}" value="${esc(sessionsStore.draftInputs[s.session_key] || '')}">
        <button data-action="send-input" data-key="${key}">Send</button>
      </div>
    </div>`
}

// Event delegation: a single listener on the cards-container routes clicks.
export function bindCardHandlers(): void {
  const container = document.getElementById('cards-container')
  if (!container) return
  // Use capture-phase listeners so a stopPropagation in nested elements
  // (timeline toggles) cancels card-header toggles too.
  container.addEventListener('click', (e) => {
    const target = e.target as HTMLElement
    const actionEl = target.closest<HTMLElement>('[data-action]')
    if (!actionEl) return
    const action = actionEl.dataset.action
    const key = actionEl.dataset.key ?? ''
    switch (action) {
      case 'toggle-card': {
        // Ignore if the user clicked inside the card body (input row etc).
        if (actionEl.classList.contains('card-header')) sessionsStore.toggleCard(key)
        break
      }
      case 'toggle-payload':
        e.stopPropagation()
        sessionsStore.togglePayload(key)
        break
      case 'send-input':
        e.stopPropagation()
        void onSendInput(key)
        break
      case 'goto-first-workspace':
        // Trigger the sidebar ws-select to bring user to the first workspace.
        document.getElementById('ws-select')?.dispatchEvent(new Event('change', { bubbles: true }))
        break
    }
  })
  // Enter on input sends prompt; debounced save into draftInputs.
  container.addEventListener('keydown', (e) => {
    const target = e.target as HTMLInputElement
    if (target.matches('[data-input]') && e.key === 'Enter') {
      const key = target.dataset.input ?? ''
      void onSendInput(key)
    }
  })
  container.addEventListener('input', (e) => {
    const target = e.target as HTMLInputElement
    if (target.matches('[data-input]')) {
      const key = target.dataset.input ?? ''
      sessionsStore.setDraftInput(key, target.value)
    }
  })
}

async function onSendInput(key: string): Promise<void> {
  const input = document.querySelector(`[data-input="${key}"]`) as HTMLInputElement | null
  if (!input) return
  const text = input.value.trim()
  if (!text) return
  try {
    await sendInput(key, text)
    sessionsStore.setDraftInput(key, '')
    input.value = ''
    toast.ok('Sent')
  } catch (e) {
    toast.error('Send failed: ' + ((e as Error).message || 'unknown'))
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