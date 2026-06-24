import { sessionsStore, type Turn } from '../state/sessions'
import { esc, formatTimeAbsolute } from '../utils/format'

export function renderTimeline(turns: Turn[], key: string): string {
  if (!turns?.length) return ''

  let html = '<div class="timeline">'
  ;[...turns].reverse().forEach((turn, ri) => {
    const ti = turn.turn_idx
    const turnId = `${key}_turn_${ti}`
    const isNewest = ri === 0
    if (!(turnId in sessionsStore.expandedTurns)) sessionsStore.expandedTurns[turnId] = isNewest
    const isOpen = sessionsStore.expandedTurns[turnId]

    html += `<div class="turn-block">
      <div class="turn-header" data-action="toggle-turn" data-key="${esc(key)}" data-ti="${ti}">
        <span>Turn ${(turn.turn_idx ?? 0) + 1} · ${esc(formatTimeAbsolute(turn.user_ts || 0))}</span>
        <span style="font-size:0.7em;color:var(--text-disabled)">${isOpen ? '▼' : '▶'}</span>
      </div>
      <div class="turn-body${isOpen ? ' open' : ''}">`

    if (turn.user_input) {
      html += `<div class="user-input-block">${esc(turn.user_input)}</div>`
    }

    // Group tools into tool-groups, render other entries as-is
    const tools: { name: string; status: string; input: string; output: string; start_ts: number; end_ts?: number }[] = []

    for (const entry of turn.entries || []) {
      if (entry.tools && entry.tools.length > 0) {
        for (const t of entry.tools) tools.push(t)
      }
    }

    let toolIdx = 0
    for (const tc of tools) {
      const toolId = `${key}_${ti}_tc_${toolIdx++}`
      const toolOpen = sessionsStore.expandedToolGroups[toolId]
      html += `<div class="tool-group">
        <div class="tool-header" data-action="toggle-tool" data-id="${toolId}">
          <span class="tool-name">${esc(tc.name)}</span>
          <span class="tool-status ${esc(tc.status)}">${tc.status === 'running' ? '<span class="pulse"></span>' : ''}${esc(tc.status)}</span>
          <span style="margin-left:auto;color:var(--text-disabled);font-size:0.8em">${tc.end_ts ? ((tc.end_ts - tc.start_ts) + 'ms') : '…'}</span>
        </div>
        <div class="tool-detail${toolOpen ? ' open' : ''}">${esc(tc.output || tc.input || '')}</div>
      </div>`
    }

    html += '</div></div>'
  })
  html += '</div>'
  return html
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
    }
  })
}