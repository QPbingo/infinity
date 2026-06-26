import { sessionsStore, type Turn } from '../state/sessions'
import { esc, formatPayloadDisplay, formatTimeAbsolute } from '../utils/format'

export function renderTimeline(turns: Turn[], key: string): string {
  if (!turns?.length) return ''

  let html = '<div class="timeline">'
  ;[...turns].reverse().forEach((turn, ri) => {
    const ti = turn.turn_idx
    const turnId = `${key}_turn_${ti}`
    const isNewest = ri === 0
    if (!(turnId in sessionsStore.expandedTurns)) sessionsStore.expandedTurns[turnId] = isNewest
    const isOpen = sessionsStore.expandedTurns[turnId]

    html += `<div class="turn-block${isOpen ? ' is-open' : ''}">
      <div class="turn-header" role="button" tabindex="0" aria-expanded="${isOpen}" data-action="toggle-turn" data-key="${esc(key)}" data-ti="${ti}">
        <span class="turn-title">Turn ${(turn.turn_idx ?? 0) + 1}</span>
        <span class="turn-time">${esc(formatTimeAbsolute(turn.user_ts || 0))}</span>
        <span class="turn-arrow" aria-hidden="true">${isOpen ? '▼' : '▶'}</span>
      </div>
      <div class="turn-body${isOpen ? ' open' : ''}">`

    if (turn.user_input) {
      html += `<div class="user-input-block">${esc(turn.user_input)}</div>`
    }

    let entryIdx = 0
    for (const entry of turn.entries || []) {
      if (entry.tools && entry.tools.length > 0) {
        for (const tc of entry.tools) {
          const toolId = `${key}_${ti}_tc_${entryIdx++}`
          const toolOpen = sessionsStore.expandedToolGroups[toolId]
          html += `<div class="tool-group status-${esc(tc.status)}${toolOpen ? ' is-open' : ''}">
            <div class="tool-header" role="button" tabindex="0" aria-expanded="${!!toolOpen}" data-action="toggle-tool" data-id="${toolId}">
              <span class="tool-name">${esc(tc.name)}</span>
              <span class="tool-status ${esc(tc.status)}">${tc.status === 'running' ? '<span class="pulse"></span>' : ''}${esc(tc.status)}</span>
              <span class="tool-duration">${tc.end_ts ? ((tc.end_ts - tc.start_ts) + 'ms') : '...'}</span>
              <span class="tool-arrow" aria-hidden="true">${toolOpen ? '▼' : '▶'}</span>
            </div>
            <div class="tool-detail${toolOpen ? ' open' : ''}">${esc(toolDetail(tc, entry))}</div>
          </div>`
        }
      } else {
        html += renderEventEntry(entry, key, ti, entryIdx++)
      }
    }

    html += '</div></div>'
  })
  html += '</div>'
  return html
}

function renderEventEntry(entry: Turn['entries'][number], key: string, turnIdx: number, idx: number): string {
  const payloadId = `${key}_${turnIdx}_${idx}`
  if (!(payloadId in sessionsStore.expandedPayloads)) sessionsStore.expandedPayloads[payloadId] = false
  const isOpen = sessionsStore.expandedPayloads[payloadId]
  const payload = formatPayloadDisplay(entry.payload, entry.event)
  const ts = entry.ts ? ` · ${formatTimeAbsolute(entry.ts)}` : ''
  const finalBadge = isFinalResultEntry(entry) ? '<span class="timeline-final-badge">Final</span>' : ''
  const category = eventCategory(entry)
  const label = eventLabel(entry.event)
  const finalClass = finalBadge ? ' is-final' : ''
  return `<div class="timeline-event event-${category}${isOpen ? ' is-open' : ''}${finalClass}" data-entry="${idx}">
    <div class="timeline-event-header" role="button" tabindex="0" aria-expanded="${isOpen}" data-action="toggle-entry" data-key="${esc(key)}" data-ti="${turnIdx}" data-ei="${idx}">
      <span class="timeline-event-dot" aria-hidden="true"></span>
      <span class="timeline-event-main">
        <span class="timeline-event-name">${esc(label)}</span>
        <span class="timeline-event-meta">${esc(entry.event)}${esc(ts)}</span>
      </span>
      ${finalBadge}
      <span class="timeline-event-arrow" aria-hidden="true">${isOpen ? '▼' : '▶'}</span>
    </div>
    <pre class="timeline-event-payload${isOpen ? ' open' : ''}">${esc(payload)}</pre>
  </div>`
}

function toolDetail(tc: { input: string; output: string }, entry: Turn['entries'][number]): string {
  const parts: string[] = []
  if (tc.input) parts.push(`input:\n${tc.input}`)
  if (tc.output) parts.push(`output:\n${tc.output}`)
  const payload = formatPayloadDisplay(entry.payload, entry.event)
  if (payload) parts.push(`raw:\n${payload}`)
  return parts.join('\n\n')
}

function isFinalResultEntry(entry: Turn['entries'][number]): boolean {
  const payload = normalizePayload(entry.payload)
  if (entry.event === 'Stop' || entry.event === 'SDKComplete') return true
  if (!payload) return false
  if (payload.is_final === true || payload.final === true) return true
  if (payload.last_assistant_message || payload.model_output) return true
  const type = typeof payload.type === 'string' ? payload.type : ''
  return type === 'result' || type === 'done'
}

function eventCategory(entry: Turn['entries'][number]): string {
  const event = entry.event.toLowerCase()
  const payload = normalizePayload(entry.payload)
  const type = typeof payload?.type === 'string' ? payload.type.toLowerCase() : ''
  if (isFinalResultEntry(entry)) return 'final'
  if (event.includes('reason') || type.includes('reason')) return 'reasoning'
  if (event.includes('assist') || event.includes('message') || type.includes('message')) return 'assistant'
  if (event.includes('tool')) return 'tool'
  if (event.includes('error') || event.includes('fail') || event.includes('denied')) return 'error'
  if (event.includes('compact') || event.includes('session') || event.includes('config')) return 'system'
  return 'raw'
}

function eventLabel(event: string): string {
  const spaced = event
    .replace(/SDK/g, 'SDK ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
  return spaced || event
}

function normalizePayload(payload: unknown): Record<string, unknown> | null {
  if (!payload || payload === 'null') return null
  if (typeof payload === 'string') {
    try {
      return JSON.parse(payload) as Record<string, unknown>
    } catch {
      return null
    }
  }
  if (typeof payload === 'object') return payload as Record<string, unknown>
  return null
}

export function bindTimelineHandlers(): void {
  const container = document.getElementById('session-detail-panel')
  if (!container) return
  container.addEventListener('click', (e) => {
    const target = e.target as HTMLElement
    const btn = target.closest<HTMLElement>('[data-action]')
    if (!btn) return
    const action = btn.dataset.action
    const key = btn.dataset.key ?? ''
    const ti = parseInt(btn.dataset.ti ?? '0', 10)
    switch (action) {
      case 'toggle-turn':
        e.stopPropagation()
        sessionsStore.toggleTurn(key, ti)
        break
      case 'toggle-tool':
        e.stopPropagation()
        const toolId = btn.dataset.id ?? ''
        sessionsStore.toggleToolDetail(toolId)
        break
      case 'toggle-entry':
        e.stopPropagation()
        sessionsStore.toggleEntryPayload(key, ti, parseInt(btn.dataset.ei ?? '0', 10))
        break
    }
  })
  container.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return
    const target = e.target as HTMLElement
    const btn = target.closest<HTMLElement>('[data-action]')
    if (!btn) return
    e.preventDefault()
    btn.click()
  })
}
