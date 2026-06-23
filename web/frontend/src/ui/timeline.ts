import { sessionsStore, type Turn, type TurnEntry } from '../state/sessions'
import { esc, trunc, formatTime, formatPayloadDisplay } from '../utils/format'

// renderTimeline lays out turns newest-first (TL-01); the newest turn is
// expanded by default (TL-02); tool groups & payloads are independently
// collapsible (TL-03/TL-07). Sensitive fields are stripped (TL-04).
//
// The toolbar above the timeline (search + filter segment) drives
// `sessionsStore` state which is preserved across renders.
export function renderTimeline(turns: Turn[], key: string): string {
  if (!turns?.length) return ''
  // Apply current tool filter & search if present.
  const search = sessionsStore.timelineSearch[key] ?? ''
  const turnFilter = sessionsStore.timelineTurnFilter[key] ?? 'all'

  let html = '<div class="timeline">'
  html += `<div class="timeline-toolbar">
    <input type="search" placeholder="Search turns (text/agent output)…" data-action="tl-search" data-key="${esc(key)}" value="${esc(search)}">
    <div class="seg">
      <button class="${turnFilter === 'all' ? 'active' : ''}" data-action="tl-filter" data-filter="all" data-key="${esc(key)}">All</button>
      <button class="${turnFilter === 'tool_use' ? 'active' : ''}" data-action="tl-filter" data-filter="tool_use" data-key="${esc(key)}">Tools</button>
      <button class="${turnFilter === 'user' ? 'active' : ''}" data-action="tl-filter" data-filter="user" data-key="${esc(key)}">User</button>
      <button class="${turnFilter === 'error' ? 'active' : ''}" data-action="tl-filter" data-filter="error" data-key="${esc(key)}">Errors</button>
    </div>
  </div>`

  const visible = filterTurns(turns, turnFilter, search)
  if (visible.length === 0) {
    html += `<div class="empty-state" style="padding:24px"><p>No turns match this filter.</p></div>`
    return html + '</div>'
  }

  ;[...visible].reverse().forEach((turn) => {
    const ti = turn.turn_idx
    const turnId = `${key}_turn_${ti}`
    const isNewest = turn === visible[visible.length - 1]
    if (!(turnId in sessionsStore.expandedTurns)) sessionsStore.expandedTurns[turnId] = isNewest
    const isOpen = sessionsStore.expandedTurns[turnId]
    html += '<div class="tl-turn">'
    html += `<div class="tl-turn-header" data-action="toggle-turn" data-key="${esc(key)}" data-ti="${ti}">`
    html += `<span class="tl-arrow${isOpen ? ' open' : ''}">▶</span> `
    html += `<span class="tl-turn-badge">Turn ${(turn.turn_idx ?? 0) + 1}</span>`
    if (turn.user_input) html += `<span class="tl-turn-sep">|</span><span class="tl-turn-preview">${esc(trunc(turn.user_input, 40))}</span>`
    if (turn.user_ts) html += `<span class="tl-time">${esc(formatTime(turn.user_ts))}</span>`
    html += '</div>'
    html += `<div class="tl-turn-body${isOpen ? ' open' : ''}">`
    if (turn.user_input) {
      html += `<div class="tl-entry"><div class="tl-entry-header"><span class="tl-label">User Input</span><span class="tl-time">${esc(formatTime(turn.user_ts))}</span></div><div class="tl-user-text">${esc(turn.user_input)}</div></div>`
    }
    turn.entries?.forEach((entry, ei) => {
      html += renderEntry(entry, key, ti, ei)
    })
    html += '</div></div>'
  })
  html += '</div>'
  return html
}

function renderEntry(entry: TurnEntry, key: string, ti: number, ei: number): string {
  const tools = entry.tools
  const hasTools = tools && tools.length > 0
  const payloadId = `${key}_${ti}_${ei}`
  const payloadOpen = sessionsStore.expandedPayloads[payloadId]
  const payloadText = formatPayloadDisplay(entry.payload, entry.event)
  let html = '<div class="tl-entry">'
  html += `<div class="tl-entry-header"><span class="tl-label">${esc(entry.event)}</span>`
  if (hasTools) html += `<span class="tl-tool-count">(${tools!.length} tools)</span>`
  html += `<span class="tl-time">${esc(formatTime(entry.start_ts ?? entry.ts))}</span></div>`
  if (hasTools) {
    const tgOpen = sessionsStore.expandedToolGroups[payloadId]
    html += `<div class="tl-tool-group-header" data-action="toggle-tool-group" data-key="${esc(key)}" data-ti="${ti}" data-ei="${ei}">`
    html += `<span class="tl-arrow${tgOpen ? ' open' : ''}">▶</span>`
    html += `<span class="tl-tool-names">${esc(tools!.map((t) => t.name).join(', '))}</span></div>`
    html += `<div class="tl-tools${tgOpen ? ' open' : ''}">`
    for (const tc of tools!) {
      html += `<div class="tl-tool"><div class="tl-tool-head"><span class="tl-tool-name">${esc(tc.name)}</span><span class="tl-tool-status ${esc(tc.status)}">${esc(tc.status)}</span><span class="tl-time">${esc(formatTime(tc.start_ts))}</span></div>`
      if (tc.input) html += `<div class="tl-tool-input">in: ${esc(trunc(tc.input, 120))}</div>`
      if (tc.output) html += `<div class="tl-tool-output">out: ${esc(trunc(tc.output, 200))}</div>`
      html += '</div>'
    }
    html += '</div>'
  }
  if (payloadText && payloadText !== entry.event) {
    html += `<div class="tl-payload-toggle" data-action="toggle-entry-payload" data-key="${esc(key)}" data-ti="${ti}" data-ei="${ei}"><span class="tl-arrow${payloadOpen ? ' open' : ''}">▶</span> Payload</div>`
    html += `<div class="tl-payload-body${payloadOpen ? ' open' : ''}"><pre>${esc(payloadText)}</pre></div>`
  }
  html += '</div>'
  return html
}

function filterTurns(turns: Turn[], filter: string, search: string): Turn[] {
  const q = search.trim().toLowerCase()
  return turns.filter((t) => {
    if (q) {
      const hay = (
        t.user_input + ' ' +
        (t.entries ?? []).map((e) => JSON.stringify(e.payload ?? '')).join(' ')
      ).toLowerCase()
      if (!hay.includes(q)) return false
    }
    if (filter === 'all') return true
    if (filter === 'user') return !!(t.user_input)
    if (filter === 'tool_use') return (t.entries ?? []).some((e) => (e.tools ?? []).length > 0)
    if (filter === 'error') return (t.entries ?? []).some((e) => e.event.includes('Error') || e.event === 'PostToolUseError' || (e.tools ?? []).some((tc) => tc.status === 'error'))
    return true
  })
}

// bindTimelineHandlers attaches delegated listeners at the cards-container
// level (rather than `window.__toggleTurn`). The same handler serves all
// sessions; the data-key attribute disambiguates.
export function bindTimelineHandlers(): void {
  const container = document.getElementById('cards-container')
  if (!container) return
  container.addEventListener('click', (e) => {
    const target = e.target as HTMLElement
    const btn = target.closest<HTMLElement>('[data-action]')
    if (!btn) return
    const action = btn.dataset.action
    const key = btn.dataset.key ?? ''
    const ti = parseInt(btn.dataset.ti ?? '0', 10)
    const ei = parseInt(btn.dataset.ei ?? '0', 10)
    switch (action) {
      case 'toggle-turn':
        e.stopPropagation()
        sessionsStore.toggleTurn(key, ti)
        break
      case 'toggle-tool-group':
        e.stopPropagation()
        sessionsStore.toggleToolGroup(key, ti, ei)
        break
      case 'toggle-entry-payload':
        e.stopPropagation()
        sessionsStore.toggleEntryPayload(key, ti, ei)
        break
      case 'tl-filter':
        e.stopPropagation()
        sessionsStore.setTimelineTurnFilter(key, btn.dataset.filter ?? 'all')
        break
    }
  })
  container.addEventListener('input', (e) => {
    const target = e.target as HTMLInputElement
    if (target.matches('[data-action="tl-search"]')) {
      const key = target.dataset.key ?? ''
      sessionsStore.setTimelineSearch(key, target.value)
    }
  })
}