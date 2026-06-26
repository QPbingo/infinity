import { sendPrompt, cancelExecution } from '../api/agent'
import { agentStore, type Execution } from '../state/agent'
import { hierarchyStore } from '../state/hierarchy'
import { esc, formatPayloadDisplay } from '../utils/format'
import { toast } from './toast'

// renderAgentPanel mounts the agent control panel into #agent-panel (created
// by the shell). Replaces the old inline-style version with the design system.
export function renderAgentPanel(): void {
  const host = document.getElementById('agent-panel')
  if (!host) return
  host.className = 'agent-panel'
  host.innerHTML = `
    <div class="agent-panel-header" id="agent-panel-header">
      <span>Agent Control</span>
      <span class="agent-panel-arrow" id="agent-panel-arrow">▼</span>
    </div>
    <div class="agent-panel-body" id="agent-panel-body">
      <div class="agent-panel-row">
        <select id="agent-select" aria-label="Agent type">
          <option value="claude">Claude Code</option>
          <option value="opencode">OpenCode</option>
          <option value="codex">Codex</option>
        </select>
        <input id="agent-session-id" type="text" placeholder="Session ID (optional)">
        <select id="agent-timeout" aria-label="Timeout">
          <option value="5">5m</option>
          <option value="10" selected>10m</option>
          <option value="30">30m</option>
          <option value="60">1h</option>
          <option value="120">2h</option>
        </select>
      </div>
      <textarea id="agent-prompt" class="agent-prompt" rows="2" placeholder="Enter prompt…"></textarea>
      <div class="agent-actions">
        <button id="agent-send" class="btn-send">Send</button>
        <button id="agent-cancel" class="btn-cancel">Cancel</button>
        <span id="agent-status" class="agent-status"></span>
      </div>
      <div id="agent-output" class="agent-output"></div>
    </div>`

  const header = document.getElementById('agent-panel-header')
  const body = document.getElementById('agent-panel-body')
  const arrow = document.getElementById('agent-panel-arrow')
  if (header && body && arrow) {
    header.onclick = () => {
      const open = body.classList.toggle('open')
      arrow.classList.toggle('open', open)
    }
  }
  const sendBtn = document.getElementById('agent-send')
  if (sendBtn) sendBtn.onclick = onSend
  const cancelBtn = document.getElementById('agent-cancel')
  if (cancelBtn) cancelBtn.onclick = onCancel
}

async function onSend(): Promise<void> {
  const agentType = (document.getElementById('agent-select') as HTMLSelectElement)?.value ?? 'claude'
  const sessionId = (document.getElementById('agent-session-id') as HTMLInputElement)?.value.trim() ?? ''
  const promptEl = document.getElementById('agent-prompt') as HTMLTextAreaElement | null
  const prompt = promptEl?.value.trim() ?? ''
  const timeoutMin = parseInt((document.getElementById('agent-timeout') as HTMLSelectElement)?.value ?? '10') || 10
  if (!prompt) {
    toast.warn('Prompt is empty')
    return
  }
  const status = document.getElementById('agent-status')
  if (status) status.textContent = 'Running…'
  try {
    const res = await sendPrompt(agentType, sessionId, prompt, timeoutMin, hierarchyStore.selectedWorkspaceId)
    if (promptEl) promptEl.value = ''
    const sidInput = document.getElementById('agent-session-id') as HTMLInputElement | null
    if (sidInput && !sessionId) sidInput.value = res.session_id
    agentStore.setCurrent(res.exec_id)
    toast.ok('Execution started')
  } catch (e) {
    if (status) status.textContent = 'Error'
    toast.error('Send failed: ' + ((e as Error).message || 'unknown'))
  }
}

async function onCancel(): Promise<void> {
  const agentType = (document.getElementById('agent-select') as HTMLSelectElement)?.value ?? 'claude'
  const sessionId = (document.getElementById('agent-session-id') as HTMLInputElement)?.value.trim() ?? ''
  const status = document.getElementById('agent-status')
  if (status) status.textContent = 'Cancelling…'
  try {
    await cancelExecution(agentType, sessionId, agentStore.currentExecId ?? undefined)
    toast.info('Cancelled')
  } catch (e) {
    if (status) status.textContent = 'Error'
    toast.error('Cancel failed: ' + ((e as Error).message || 'unknown'))
  }
}

// renderExecHistory draws the current execution's messages, or a clickable
// list of past executions. A "back" link returns to the list view (#20).
export function renderExecHistory(): void {
  const output = document.getElementById('agent-output')
  if (!output) return
  if (agentStore.executions.length === 0) {
    output.classList.remove('is-open')
    output.innerHTML = ''
    return
  }
  output.classList.add('is-open')
  const current = agentStore.executions.find((e) => e.id === agentStore.currentExecId)
  // Update the status indicator based on execution state.
  const statusEl = document.getElementById('agent-status')
  if (current && statusEl) {
    const labels: Record<string, string> = { completed: 'Completed', error: 'Error', cancelled: 'Cancelled', running: 'Running…' }
    statusEl.textContent = labels[current.status] || current.status
  }
  if (current) {
    output.innerHTML = renderExecutionMessages(current)
    const back = output.querySelector('[data-action="exec-back"]')
    if (back) {
      ;(back as HTMLElement).onclick = () => {
        agentStore.setCurrent(null)
      }
    }
  } else {
    output.innerHTML = agentStore.executions
      .map((e) => `<div class="exec-row" data-exec="${esc(e.id)}">${statusIcon(e.status)} <b>${esc(e.agent_type ?? '')}</b> <span class="exec-preview">${esc((e.prompt ?? '').slice(0, 60))}</span></div>`)
      .join('')
    output.querySelectorAll('[data-exec]').forEach((el) => {
      ;(el as HTMLElement).onclick = () => {
        agentStore.setCurrent((el as HTMLElement).dataset.exec ?? null)
      }
    })
  }
}

function renderExecutionMessages(e: Execution): string {
  let html = `<div class="exec-back" data-action="exec-back">← Back to history</div>`
  html += `<div class="exec-prompt-label">Prompt: ${esc(e.prompt ?? '')}</div>`
  for (const m of e.messages) {
    if (m.msg_type === 'tool_use' || m.type === 'tool_use') {
      html += `<div class="msg-tool">[${esc(m.tool_name ?? 'tool')}] ${esc(m.tool_input ?? '')}</div>`
    } else if (m.content) {
      html += `<div class="msg-text">${esc(m.content)}</div>`
    } else if (m.error) {
      html += `<div class="msg-error">[ERROR] ${esc(m.error)}</div>`
    }
    if (m.raw_json) {
      html += `<pre class="msg-raw">${esc(formatPayloadDisplay(m.raw_json, String(m.msg_type ?? m.type ?? 'message')))}</pre>`
    }
  }
  if (e.status === 'error' && e.error) {
    html += `<div class="msg-error">[ERROR] ${esc(e.error)}</div>`
  }
  return html
}

function statusIcon(s: Execution['status']): string {
  switch (s) {
    case 'running':
      return '<span class="exec-spin"></span>'
    case 'completed':
      return '<svg viewBox="0 0 16 16" width="14" height="14"><circle cx="8" cy="8" r="7" fill="none" stroke="var(--success-text)" stroke-width="1.5"/><path d="M5 8l2 2 4-4" fill="none" stroke="var(--success-text)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    case 'error':
      return '<svg viewBox="0 0 16 16" width="14" height="14"><circle cx="8" cy="8" r="7" fill="none" stroke="var(--danger-text)" stroke-width="1.5"/><path d="M5.5 5.5l5 5M10.5 5.5l-5 5" fill="none" stroke="var(--danger-text)" stroke-width="1.5" stroke-linecap="round"/></svg>'
    default:
      return '<svg viewBox="0 0 16 16" width="14" height="14"><rect x="3" y="3" width="10" height="10" rx="2" fill="none" stroke="var(--text-muted)" stroke-width="1.5"/></svg>'
  }
}
