import { sendPrompt, cancelExecution } from '../api/agent'
import { agentStore, type Execution } from '../state/agent'
import { esc } from '../utils/format'

// Render the agent control panel into #agent-panel (created by the shell).
// Replaces dashboard.html's AgentPanel + sendAgentPrompt/cancelAgent.
export function renderAgentPanel(): void {
  const host = document.getElementById('agent-panel')
  if (!host) return
  host.innerHTML = `
    <div id="agent-panel-header" style="padding:8px 12px;cursor:pointer;display:flex;align-items:center;justify-content:space-between;background:#1c2128">
      <span style="font-size:0.8em;color:#58a6ff">Agent Control</span>
      <span style="font-size:0.6em;color:#8b949e" id="agent-panel-arrow">▼</span>
    </div>
    <div id="agent-panel-body" style="display:none;padding:10px 12px">
      <div style="display:flex;gap:6px;margin-bottom:8px">
        <select id="agent-select" style="flex:1;padding:4px;background:#0d1117;border:1px solid #30363d;border-radius:3px;color:#c9d1d9;font-size:0.76em">
          <option value="claude">Claude Code</option>
          <option value="opencode">OpenCode</option>
          <option value="codex">Codex</option>
        </select>
        <input id="agent-session-id" placeholder="Session ID (optional)" style="flex:1;padding:4px;background:#0d1117;border:1px solid #30363d;border-radius:3px;color:#c9d1d9;font-size:0.76em">
        <select id="agent-timeout" style="padding:4px;background:#0d1117;border:1px solid #30363d;border-radius:3px;color:#c9d1d9;font-size:0.7em">
          <option value="5">5m</option>
          <option value="10" selected>10m</option>
          <option value="30">30m</option>
          <option value="60">1h</option>
          <option value="120">2h</option>
        </select>
      </div>
      <div style="display:flex;gap:6px;margin-bottom:8px">
        <textarea id="agent-prompt" rows="2" placeholder="Enter prompt..." style="flex:1;padding:6px 8px;background:#0d1117;border:1px solid #30363d;border-radius:4px;color:#c9d1d9;font-size:0.78em;resize:vertical"></textarea>
      </div>
      <div style="display:flex;gap:6px">
        <button id="agent-send" style="padding:5px 14px;background:#238636;color:white;border:none;border-radius:4px;cursor:pointer;font-size:0.76em">Send</button>
        <button id="agent-cancel" style="padding:5px 10px;background:#21262d;color:#c9d1d9;border:1px solid #30363d;border-radius:4px;cursor:pointer;font-size:0.72em">Cancel</button>
        <span id="agent-status" style="font-size:0.7em;color:#8b949e;align-self:center"></span>
      </div>
      <div id="agent-output" style="margin-top:8px;max-height:200px;overflow-y:auto;background:#0d1117;border:1px solid #21262d;border-radius:4px;padding:8px;font-size:0.72em;font-family:'SF Mono',monospace;white-space:pre-wrap;word-break:break-word;display:none"></div>
    </div>`

  const header = document.getElementById('agent-panel-header')
  const body = document.getElementById('agent-panel-body')
  const arrow = document.getElementById('agent-panel-arrow')
  if (header && body && arrow) {
    header.onclick = () => {
      const open = body.style.display === 'none'
      body.style.display = open ? 'block' : 'none'
      arrow.textContent = open ? '▲' : '▼'
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
  const prompt = (document.getElementById('agent-prompt') as HTMLTextAreaElement)?.value.trim() ?? ''
  const timeoutMin = parseInt((document.getElementById('agent-timeout') as HTMLSelectElement)?.value ?? '10') || 10
  if (!prompt) return
  const status = document.getElementById('agent-status')
  if (status) status.textContent = 'Running...'
  try {
    const res = await sendPrompt(agentType, sessionId, prompt, timeoutMin)
    // Backfill session id if auto-created (AG-14).
    const sidInput = document.getElementById('agent-session-id') as HTMLInputElement | null
    if (sidInput && !sessionId) sidInput.value = res.session_id
    agentStore.setCurrent(res.exec_id)
  } catch (e) {
    if (status) status.textContent = 'Error: ' + (e as Error).message
  }
}

async function onCancel(): Promise<void> {
  const agentType = (document.getElementById('agent-select') as HTMLSelectElement)?.value ?? 'claude'
  const sessionId = (document.getElementById('agent-session-id') as HTMLInputElement)?.value.trim() ?? ''
  const status = document.getElementById('agent-status')
  if (status) status.textContent = 'Cancelling...'
  try {
    await cancelExecution(agentType, sessionId, agentStore.currentExecId ?? undefined)
  } catch (e) {
    if (status) status.textContent = 'Error: ' + (e as Error).message
  }
}

// Render the execution history + current execution's messages. Called when
// agentStore changes. Replaces dashboard.html's renderExecHistory/showExecution.
export function renderExecHistory(): void {
  const output = document.getElementById('agent-output')
  if (!output || agentStore.executions.length === 0) return
  output.style.display = 'block'
  const current = agentStore.executions.find((e) => e.id === agentStore.currentExecId)
  if (current) {
    output.innerHTML = renderExecutionMessages(current)
  } else {
    output.innerHTML = agentStore.executions
      .map((e) => `<div style="padding:4px 0;border-bottom:1px solid #21262d;cursor:pointer" data-exec="${esc(e.id)}">${statusIcon(e.status)} <b>${esc(e.agent_type ?? '')}</b> <span style="color:#8b949e">${esc((e.prompt ?? '').slice(0, 60))}</span></div>`)
      .join('')
    output.querySelectorAll('[data-exec]').forEach((el) => {
      el.addEventListener('click', () => {
        agentStore.setCurrent((el as HTMLElement).dataset.exec ?? null)
      })
    })
  }
}

function renderExecutionMessages(e: Execution): string {
  let html = `<div style="color:#58a6ff;margin-bottom:6px">Prompt: ${esc(e.prompt ?? '')}</div>`
  for (const m of e.messages) {
    if (m.msg_type === 'tool_use' || m.type === 'tool_use') {
      html += `<div style="color:#d2a8ff">[${esc(m.tool_name ?? 'tool')}] ${esc(m.tool_input ?? '')}</div>`
    } else if (m.content) {
      html += `<div style="color:#c9d1d9">${esc(m.content)}</div>`
    }
  }
  if (e.status === 'error' && e.error) {
    html += `<div style="color:#f85149">[ERROR] ${esc(e.error)}</div>`
  }
  return html
}

function statusIcon(s: Execution['status']): string {
  return s === 'running' ? '⏳' : s === 'completed' ? '✅' : s === 'error' ? '❌' : '⏹'
}
