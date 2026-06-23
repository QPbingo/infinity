import { restoreSession, showApp, doLogout } from './ui/auth'
import { authStore } from './state/auth'
import { agentStore } from './state/agent'
import { hierarchyStore } from './state/hierarchy'
import { sessionsStore } from './state/sessions'
import { SSEManager, type SSEEvent } from './sse/manager'
import { renderAgentPanel, renderExecHistory } from './ui/agentPanel'
import { renderSidebar, bindTreeHandlers } from './ui/sidebar'
import { renderSessionCards, bindCardHandlers } from './ui/sessionCard'
import { bindTimelineHandlers } from './ui/timeline'
import { closeModal, refreshHierarchy } from './ui/modals'
import './styles/main.css'

// Single SSE manager instance, created after auth is established.
let sse: SSEManager | null = null

function handleSSE(event: SSEEvent): void {
  // Constraint D: if the SSE stream closed due to auth failure, log out.
  if (event.type === 'agent_error' && (event as { __auth?: boolean }).__auth) {
    console.warn('[sse] connection closed (auth?), logging out')
    if (sse) { sse.close(); sse = null }
    authStore.clear()
    import('./ui/auth').then(({ renderAuth }) => renderAuth('login'))
    return
  }
  // Route events to the appropriate state stores.
  hierarchyStore.applyEvent(event)
  sessionsStore.applyEvent(event)
  agentStore.applyEvent(event)
}

function connectSSE(): void {
  if (sse) sse.close()
  sse = new SSEManager()
  sse.on(handleSSE)
  sse.connect()
}

// Build the app shell DOM (sidebar + main + overlays).
function renderShell(): void {
  const root = document.getElementById('app')
  if (!root) return
  root.innerHTML = `
    <div id="sidebar">
      <div class="sidebar-header">
        <h2>Agent Monitor</h2>
        <span id="new-project-btn" style="font-size:0.7em;color:#8b949e;cursor:pointer" title="New project">+</span>
      </div>
      <div class="sidebar-body" id="tree"></div>
      <div class="sidebar-footer">
        <div id="ws-selector">
          <select id="ws-select" style="width:100%;padding:3px 4px;background:#0d1117;border:1px solid #30363d;border-radius:3px;color:#c9d1d9;font-size:0.7em;margin-bottom:4px"></select>
          <button id="new-ws-btn" style="width:100%;padding:2px;background:#21262d;color:#8b949e;border:1px solid #30363d;border-radius:3px;cursor:pointer;font-size:0.68em">+ New Workspace</button>
        </div>
        <span id="sess-count" style="display:block;margin-top:6px">0 sessions</span>
      </div>
    </div>
    <div id="main">
      <div id="topbar">
        <div><h1 id="page-title">All Sessions</h1><span class="meta" id="page-meta"></span></div>
        <div class="user-area">
          <span id="user-name"></span>
          <button id="logout-btn">Logout</button>
        </div>
      </div>
      <div class="filters">
        <button class="filter-btn active" data-filter="all">All</button>
        <button class="filter-btn" data-filter="active">Active</button>
        <button class="filter-btn" data-filter="idle">Idle</button>
        <button class="filter-btn" data-filter="stopped">Stopped</button>
      </div>
      <div id="agent-panel" style="background:#161b22;border:1px solid #21262d;border-radius:8px;margin-bottom:14px;overflow:hidden"></div>
      <div id="cards-container"></div>
    </div>`
  const overlay = document.createElement('div')
  overlay.className = 'modal-overlay'
  overlay.id = 'modal-overlay'
  overlay.style.display = 'none'
  overlay.innerHTML = '<div class="modal-box" id="modal-box"></div>'
  overlay.onclick = (e) => { if (e.target === overlay) closeModal() }
  document.body.appendChild(overlay)
  const authOverlay = document.createElement('div')
  authOverlay.id = 'auth-overlay'
  authOverlay.style.display = 'none'
  document.body.prepend(authOverlay)

  const logoutBtn = document.getElementById('logout-btn')
  if (logoutBtn) logoutBtn.onclick = () => doLogout()
  renderAgentPanel()

  // Bind UI handlers.
  bindTreeHandlers()
  bindCardHandlers()
  bindTimelineHandlers()

  // Workspace selector + new buttons.
  const wsSelect = document.getElementById('ws-select') as HTMLSelectElement | null
  if (wsSelect) wsSelect.onchange = () => hierarchyStore.selectWorkspace(parseInt(wsSelect.value))
  const newWsBtn = document.getElementById('new-ws-btn')
  if (newWsBtn) {
    newWsBtn.onclick = () => {
      import('./ui/modals').then(({ showCreateModal }) => showCreateModal('workspace', 0))
    }
  }
  const newProjBtn = document.getElementById('new-project-btn')
  if (newProjBtn) {
    newProjBtn.onclick = () => {
      const wid = hierarchyStore.selectedWorkspaceId ?? 1
      import('./ui/modals').then(({ showCreateModal }) => showCreateModal('project', wid))
    }
  }

  // Filter buttons.
  document.querySelectorAll('.filter-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach((b) => b.classList.remove('active'))
      btn.classList.add('active')
      sessionsStore.setFilter((btn as HTMLElement).dataset.filter as 'all' | 'active' | 'idle' | 'stopped')
    })
  })

  // Re-render on state changes.
  hierarchyStore.subscribe(() => { renderSidebar(); renderSessionCards() })
  sessionsStore.subscribe(() => renderSessionCards())
  agentStore.subscribe(() => renderExecHistory())
}

// Wire authStore changes: when authed, show app + connect SSE + load hierarchy;
// when cleared, SSE is already closed by handleSSE/doLogout.
authStore.subscribe(() => {
  if (authStore.authed && !sse) {
    connectSSE()
    void refreshHierarchy()
  } else if (!authStore.authed && sse) {
    sse.close()
    sse = null
  }
})

renderShell()

// On load: try to restore the session (valid cookie → straight to app + SSE).
restoreSession(() => {
  if (authStore.authed) {
    showApp()
    connectSSE()
    void refreshHierarchy()
  }
})
