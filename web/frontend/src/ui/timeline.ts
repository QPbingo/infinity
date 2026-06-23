import { sessionsStore, type Turn, type TurnEntry } from '../state/sessions'
import { esc, trunc, formatTime, formatPayloadDisplay } from '../utils/format'

// Render the timeline for a session's turns. Replaces dashboard.html's
// renderTimeline. Turns are shown newest-first (TL-01); the newest turn is
// expanded by default (TL-02); tool groups & payloads are independently
// collapsible (TL-03/TL-07). Sensitive fields are stripped (TL-04).
export function renderTimeline(turns: Turn[], key: string): string {
  if (!turns?.length) return ''
  let html = '<div class="timeline">'
  ;[...turns].reverse().forEach((turn, ri) => {
    const ti = turns.length - 1 - ri
    const turnId = `${key}_turn_${ti}`
    const isNewest = ri === 0
    if (!(turnId in sessionsStore.expandedTurns)) sessionsStore.expandedTurns[turnId] = isNewest
    const isOpen = sessionsStore.expandedTurns[turnId]
    html += '<div class="tl-turn">'
    html += `<div class="tl-turn-header" onclick="event.stopPropagation();window.__toggleTurn('${key}',${ti})">`
    html += `<span class="tl-arrow${isOpen ? ' open' : ''}">▶</span> `
    html += `<span class="tl-turn-badge">Turn ${(turn.turn_idx ?? 0) + 1}</span>`
    if (turn.user_input) html += `<span style="color:#8b949e">|</span><span>${esc(trunc(turn.user_input, 40))}</span>`
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
    html += `<div class="tl-tool-group-header" onclick="event.stopPropagation();window.__toggleToolGroup('${key}',${ti},${ei})">`
    html += `<span class="tl-arrow${tgOpen ? ' open' : ''}">▶</span>`
    html += `<span style="font-size:0.75em;color:#c9d1d9">${esc(tools!.map((t) => t.name).join(', '))}</span></div>`
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
    html += `<div class="tl-payload-toggle" onclick="event.stopPropagation();window.__toggleEntryPayload('${key}',${ti},${ei})"><span class="tl-arrow${payloadOpen ? ' open' : ''}">▶</span> Payload</div>`
    html += `<div class="tl-payload-body${payloadOpen ? ' open' : ''}"><pre>${esc(payloadText)}</pre></div>`
  }
  html += '</div>'
  return html
}

export function bindTimelineHandlers(): void {
  const w = window as unknown as Record<string, unknown>
  w.__toggleTurn = (key: string, ti: number) => sessionsStore.toggleTurn(key, ti)
  w.__toggleToolGroup = (key: string, ti: number, ei: number) => sessionsStore.toggleToolGroup(key, ti, ei)
  w.__toggleEntryPayload = (key: string, ti: number, ei: number) => {
    // entry payload uses the same toggle as tool group (same id scheme)
    sessionsStore.toggleToolGroup(key, ti, ei)
  }
}
