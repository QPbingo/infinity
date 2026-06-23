import { restoreSession, showApp, doLogout, wireUnauthorizedAutoLogout, renderAuth as renderAuthSafely } from './ui/auth'
import { authStore } from './state/auth'
import { agentStore } from './state/agent'
import { hierarchyStore } from './state/hierarchy'
import { sessionsStore, SESSION_STATUSES } from './state/sessions'
import { SSEManager, type SSEEvent } from './sse/manager'
import { renderAgentPanel, renderExecHistory } from './ui/agentPanel'
import { renderSidebar, bindTreeHandlers } from './ui/sidebar'
import { renderSessionCards, bindCardHandlers } from './ui/sessionCard'
import { bindTimelineHandlers } from './ui/timeline'
import { closeModal, refreshHierarchy, showCreateModal } from './ui/modals'
import { mountConnectionIndicator } from './ui/connIndicator'
import { toast } from './ui/toast'
import './styles/main.css'

let sse: SSEManager | null = null

function handleSSE(event: SSEEvent): void {
  if (event.type === 'agent_error' && (event as { __auth?: boolean }).__auth) {
    console.warn('[sse] connection closed (auth?), logging out')
    if (sse) { sse.close(); sse = null }
    authStore.clear()
    renderAuthSafely()
    toast.warn('Connection lost — please sign in again')
    return
  }
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
        <button class="icon-btn" id="new-project-btn" title="New project">+</button>
      </div>
      <div class="sidebar-body" id="tree"></div>
      <div class="sidebar-footer">
        <div class="ws-selector">
          <select id="ws-select" aria-label="Workspace"></select>
          <button id="new-ws-btn">+ New Workspace</button>
        </div>
        <span id="sess-count" style="display:block;margin-top:6px">0 sessions</span>
      </div>
    </div>
    <div id="main">
      <div id="topbar">
        <div class="title-block">
          <button class="menu-toggle" id="menu-toggle" aria-label="Toggle sidebar">☰</button>
          <h1 id="page-title">All Sessions</h1>
          <span class="meta" id="page-meta"></span>
        </div>
        <div class="topbar-actions">
          <span id="conn-indicator-host"></span>
          <button class="theme-toggle" id="theme-toggle" aria-label="Toggle theme" title="Toggle theme">☾</button>
          <div class="user-area">
            <span id="user-name"></span>
            <button id="logout-btn" class="btn-cancel">Logout</button>
          </div>
        </div>
      </div>
      <div class="filters" id="filters"></div>
      <div id="agent-panel"></div>
      <div id="cards-container"></div>
    </div>`
  // Modal overlay (also inserted as a sibling of #app).
  const overlay = document.createElement('div')
  overlay.className = 'modal-overlay'
  overlay.id = 'modal-overlay'
  overlay.style.display = 'none'
  overlay.innerHTML = '<div class="modal-box" id="modal-box"></div>'
  overlay.onclick = (e) => { if (e.target === overlay) closeModal() }
  document.body.appendChild(overlay)
  // Mobile sidebar backdrop.
  const backdrop = document.createElement('div')
  backdrop.className = 'sidebar-backdrop'
  backdrop.id = 'sidebar-backdrop'
  backdrop.onclick = () => {
    document.getElementById('sidebar')?.classList.remove('is-open')
    backdrop.classList.remove('is-open')
  }
  document.body.appendChild(backdrop)
  // Auth overlay.
  const authOverlay = document.createElement('div')
  authOverlay.id = 'auth-overlay'
  authOverlay.style.display = 'none'
  document.body.prepend(authOverlay)

  // Wire handlers.
  const logoutBtn = document.getElementById('logout-btn')
  if (logoutBtn) logoutBtn.onclick = () => doLogout()
  renderAgentPanel()
  bindTreeHandlers()
  bindCardHandlers()
  bindTimelineHandlers()
  renderFilters()

  // Topbar actions.
  const connHost = document.getElementById('conn-indicator-host')
  if (connHost) mountConnectionIndicator(connHost)

  const themeToggle = document.getElementById('theme-toggle')
  if (themeToggle) {
    // Restore persisted theme if any.
    const saved = localStorage.getItem('agent-monitor-theme')
    if (saved === 'light') {
      document.documentElement.setAttribute('data-theme', 'light')
      themeToggle.textContent = '☀'
    }
    themeToggle.onclick = () => {
      const isLight = document.documentElement.getAttribute('data-theme') === 'light'
      if (isLight) {
        document.documentElement.removeAttribute('data-theme')
        themeToggle.textContent = '☾'
        localStorage.setItem('agent-monitor-theme', 'dark')
      } else {
        document.documentElement.setAttribute('data-theme', 'light')
        themeToggle.textContent = '☀'
        localStorage.setItem('agent-monitor-theme', 'light')
      }
    }
  }

  const menuToggle = document.getElementById('menu-toggle')
  if (menuToggle) {
    menuToggle.onclick = () => {
      document.getElementById('sidebar')?.classList.toggle('is-open')
      document.getElementById('sidebar-backdrop')?.classList.toggle('is-open')
    }
  }

  // Workspace selector + new buttons.
  const wsSelect = document.getElementById('ws-select') as HTMLSelectElement | null
  if (wsSelect) wsSelect.onchange = () => hierarchyStore.selectWorkspace(parseInt(wsSelect.value))
  const newWsBtn = document.getElementById('new-ws-btn')
  if (newWsBtn) {
    newWsBtn.onclick = () => showCreateModal('workspace', 0)
  }
  const newProjBtn = document.getElementById('new-project-btn')
  if (newProjBtn) {
    newProjBtn.onclick = () => {
      const wid = hierarchyStore.selectedWorkspaceId ?? 1
      showCreateModal('project', wid)
    }
  }

  // Re-render on state changes. Each subscribe returns an unsubscribe fn so
  // future modular teardown is possible (#17 future-proofing).
  hierarchyStore.subscribe(() => { renderSidebar(); renderSessionCards(); renderFilters() })
  sessionsStore.subscribe(() => { renderSessionCards(); renderFilters() })
  agentStore.subscribe(() => renderExecHistory())
}

// renderFilters builds the filter bar from SESSION_STATUSES + agent type
// dropdown. Each button shows a live count.
function renderFilters(): void {
  const host = document.getElementById('filters')
  if (!host) return
  const counts = sessionsStore.statusCounts()
  const agentCounts = sessionsStore.agentTypeCounts()
  const total = Object.values(sessionsStore.sessions).length

  const allBtn = `<button class="filter-btn ${sessionsStore.currentFilter === 'all' ? 'active' : ''}" data-filter="all">All <span class="filter-count">${total}</span></button>`

  const statusBtns = SESSION_STATUSES.map((s) => {
    const c = counts[s] ?? 0
    if (c === 0 && sessionsStore.currentFilter !== s) return ''  // hide empty categories
    return `<button class="filter-btn ${sessionsStore.currentFilter === s ? 'active' : ''}" data-filter="${s}">${s} <span class="filter-count">${c}</span></button>`
  }).join('')

  const agentTypeOpts = ['', 'claude', 'opencode', 'codex'].map((t) => {
    const label = t === '' ? 'All agents' : t
    const c = t === '' ? total : (agentCounts[t] ?? 0)
    if (t !== '' && c === 0) return ''
    return `<option value="${t}" ${sessionsStore.agentTypeFilter === t ? 'selected' : ''}>${label}${t ? ` (${c})` : ''}</option>`
  }).join('')

  host.innerHTML = `
    ${allBtn}
    ${statusBtns}
    <span class="filter-divider"></span>
    <select class="filter-select" id="agent-type-filter" aria-label="Agent type filter">${agentTypeOpts}</select>`

  host.querySelectorAll('[data-filter]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const f = (btn as HTMLElement).dataset.filter as 'all' | typeof SESSION_STATUSES[number]
      host.querySelectorAll('.filter-btn').forEach((b) => b.classList.remove('active'))
      btn.classList.add('active')
      sessionsStore.setFilter(f)
    })
  })
  const agentFilter = document.getElementById('agent-type-filter') as HTMLSelectElement | null
  if (agentFilter) {
    agentFilter.onchange = () => {
      sessionsStore.setAgentTypeFilter(agentFilter.value)
    }
  }
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
wireUnauthorizedAutoLogout()

// On load: try to restore the session (valid cookie → straight to app + SSE).
restoreSession(() => {
  if (authStore.authed) {
    showApp()
    connectSSE()
    void refreshHierarchy()
  }
})