import { restoreSession, showApp, doLogout, wireUnauthorizedAutoLogout } from './ui/auth'
import { authStore } from './state/auth'
import { agentStore } from './state/agent'
import { hierarchyStore } from './state/hierarchy'
import { sessionsStore, SESSION_STATUSES } from './state/sessions'
import { SSEManager, sseStatusBus, type SSEStatus, type SSEEvent } from './sse/manager'
import { renderSidebar, bindTreeHandlers } from './ui/sidebar'
import { renderSessionList, renderSessionDetail, bindSessionHandlers } from './ui/sessionCard'
import { bindTimelineHandlers } from './ui/timeline'
import { renderAgentPanel, renderExecHistory } from './ui/agentPanel'
import { closeModal, refreshHierarchy } from './ui/modals'
import { toast } from './ui/toast'
import './styles/main.css'

let sse: SSEManager | null = null

function handleSSE(event: SSEEvent): void {
  if (event.type === 'agent_error' && (event as { __auth?: boolean }).__auth) {
    if (sse) { sse.close(); sse = null }
    authStore.clear()
    import('./ui/auth').then(({ renderAuth }) => renderAuth('login'))
    toast.warn('Session expired — please sign in again')
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

// ── Shell rendering ──
let currentView: 'dashboard' | 'sessions' = 'sessions'

function renderShell(): void {
  const root = document.getElementById('app')
  if (!root) return
  root.innerHTML = `
    <!-- Top Navigation -->
    <nav class="top-nav">
      <div class="logo">
        <span class="dot"></span> Infinity
      </div>

      <div class="ws-switcher" id="ws-switcher">
        <button class="ws-btn" id="ws-btn">
          <span class="ws-icon"></span>
          <span id="ws-name">Workspace</span>
          <span class="ws-chevron">▼</span>
        </button>
        <div class="ws-dropdown" id="ws-dropdown">
          <div class="ws-drop-header">Workspaces</div>
          <div id="ws-options"></div>
          <div class="ws-drop-footer">
            <button id="ws-new-btn">+ New Workspace</button>
          </div>
        </div>
      </div>
      <div class="ws-backdrop" id="ws-backdrop"></div>

      <div style="flex:1"></div>

      <div class="nav-info" id="nav-status">
        <span class="status-dot" id="status-dot"></span>
        <span id="nav-addr">daemon 127.0.0.1:9101</span>
        <span class="sep">·</span>
        <span id="nav-active-count">0 active</span>
      </div>

      <button class="theme-toggle" id="theme-toggle" aria-label="Toggle theme">☾</button>

      <div class="user-menu" id="user-menu">
        <button class="user-btn" id="user-btn">
          <span class="avatar" id="user-avatar">U</span>
          <span id="user-name-display">User</span>
          <span class="user-chevron">▼</span>
        </button>
        <div class="user-dropdown" id="user-dropdown">
          <div class="user-info">
            <span class="avatar-lg" id="user-avatar-lg">U</span>
            <div>
              <div class="user-name" id="user-fullname">User</div>
              <div class="user-role"><span class="dot"></span> Admin</div>
            </div>
          </div>
          <button class="menu-item" id="menu-permissions">Permissions</button>
          <button class="menu-item" id="menu-agent-panel">Agent Panel</button>
          <div class="menu-sep"></div>
          <button class="menu-item danger" id="menu-signout">Sign Out</button>
        </div>
        <div class="user-backdrop" id="user-backdrop"></div>
      </div>
    </nav>

    <!-- Main area -->
    <div class="main-area">
      <aside class="sidebar" id="sidebar">
        <div class="sidebar-body">
          <div class="side-nav-item active" data-view="sessions" id="nav-sessions">
            <span class="side-nav-icon">&#9776;</span>
            <span class="side-nav-label">Sessions</span>
            <span class="side-nav-badge" id="sess-badge">0</span>
          </div>
          <div class="side-nav-item" data-view="dashboard" id="nav-dashboard">
            <span class="side-nav-icon">&#9632;</span>
            <span class="side-nav-label">Dashboard</span>
          </div>

          <div class="tree-separator"></div>

          <div class="sidebar-header">
            Projects
            <button class="add-btn" id="sidebar-add-project" title="Add Project">+</button>
          </div>
          <div id="sidebar-tree"></div>
        </div>
      </aside>

      <!-- Dashboard View -->
      <div class="view-panel" id="view-dashboard">
        <main class="full-main">
          <div>
            <h1 style="font-size:var(--text-xl);font-weight:700;color:var(--text-primary)">Dashboard</h1>
            <div id="dash-ws-subtitle" style="font-size:var(--text-xs);color:var(--text-tertiary);margin-top:4px"></div>
          </div>
          <div class="stats-row" id="stats-row"></div>
          <div class="detail-section-title">Recent Activity</div>
          <div id="recent-activity"></div>
        </main>
      </div>

      <!-- Sessions View -->
      <div class="view-panel active" id="view-sessions">
        <div class="session-list-panel" id="session-list-panel">
          <div class="dash-header">
            <h1>Sessions</h1>
          </div>
          <div class="filter-group" id="filter-group"></div>
          <div class="stats-row" id="session-stats" style="grid-template-columns:repeat(4,1fr);padding:0 var(--space-4)"></div>
          <div class="session-list-header"><span>Session</span><span>T / CPU</span></div>
          <div class="session-list-body" id="session-list-body"></div>
        </div>
        <div class="session-detail-panel" id="session-detail-panel">
          <div class="empty-state" id="detail-empty">
            <h3>Select a session</h3>
            <p>Choose a session from the list to view its timeline and details.</p>
          </div>
        </div>
        <div id="agent-panel" style="display:none"></div>
      </div>
    </div>`

  // Overlays
  const modalOverlay = document.createElement('div')
  modalOverlay.className = 'modal-overlay'
  modalOverlay.id = 'modal-overlay'
  modalOverlay.style.display = 'none'
  modalOverlay.innerHTML = '<div class="modal-box" id="modal-box"></div>'
  modalOverlay.onclick = (e) => { if (e.target === modalOverlay) closeModal() }
  document.body.appendChild(modalOverlay)

  const authOverlay = document.createElement('div')
  authOverlay.id = 'auth-overlay'
  authOverlay.style.display = 'none'
  document.body.prepend(authOverlay)

  // ── Wire UI ──
  wireTopNav()
  wireSidebarNav()
  bindTreeHandlers()
  bindSessionHandlers()
  bindTimelineHandlers()
  renderAgentPanel()

  // ── Theme ──
  const saved = localStorage.getItem('agent-monitor-theme')
  const themeToggle = document.getElementById('theme-toggle')
  if (themeToggle) {
    if (saved === 'light') {
      document.documentElement.setAttribute('data-theme', 'light')
      themeToggle.innerHTML = '&#9788;'
    }
    themeToggle.onclick = () => {
      const isLight = document.documentElement.getAttribute('data-theme') === 'light'
      if (isLight) {
        document.documentElement.removeAttribute('data-theme')
        themeToggle.innerHTML = '&#9790;'
        localStorage.setItem('agent-monitor-theme', 'dark')
      } else {
        document.documentElement.setAttribute('data-theme', 'light')
        themeToggle.innerHTML = '&#9788;'
        localStorage.setItem('agent-monitor-theme', 'light')
      }
    }
  }

  // ── Store subscriptions ──
  let lastWsId = hierarchyStore.selectedWorkspaceId
  let lastTopicId = hierarchyStore.selectedTopicId
  let lastStoryId = hierarchyStore.selectedStoryId
  hierarchyStore.subscribe(() => {
    if (hierarchyStore.selectedWorkspaceId !== lastWsId ||
        hierarchyStore.selectedTopicId !== lastTopicId ||
        hierarchyStore.selectedStoryId !== lastStoryId) {
      lastWsId = hierarchyStore.selectedWorkspaceId
      lastTopicId = hierarchyStore.selectedTopicId
      lastStoryId = hierarchyStore.selectedStoryId
      sessionsStore.selectedSessionKey = null
    }
    renderSidebar(); renderSessionList(); renderTopNav(); renderFilters(); renderDashboard()
  })
  sessionsStore.subscribe(() => { renderSessionList(); renderSessionDetail(); renderTopNav(); renderFilters(); renderDashboard() })
  agentStore.subscribe(() => renderExecHistory())
  sseStatusBus.subscribe(() => updateConnIndicator(sseStatusBus.current()))
  updateConnIndicator('disconnected')
}

// ── Top nav wiring ──
function wireTopNav(): void {
  const wsBtn = document.getElementById('ws-btn')
  const wsDropdown = document.getElementById('ws-dropdown')
  const wsBackdrop = document.getElementById('ws-backdrop')
  if (wsBtn && wsDropdown && wsBackdrop) {
    wsBtn.onclick = () => {
      wsDropdown.classList.toggle('open')
      wsBackdrop.classList.toggle('open')
    }
    wsBackdrop.onclick = () => { wsDropdown.classList.remove('open'); wsBackdrop.classList.remove('open') }
  }

  const userBtn = document.getElementById('user-btn')
  const userDropdown = document.getElementById('user-dropdown')
  const userBackdrop = document.getElementById('user-backdrop')
  if (userBtn && userDropdown && userBackdrop) {
    userBtn.onclick = () => { userDropdown.classList.toggle('open'); userBackdrop.classList.toggle('open') }
    userBackdrop.onclick = () => { userDropdown.classList.remove('open'); userBackdrop.classList.remove('open') }
  }

  const signoutBtn = document.getElementById('menu-signout')
  if (signoutBtn) signoutBtn.onclick = () => { userDropdown?.classList.remove('open'); userBackdrop?.classList.remove('open'); doLogout() }

  const permBtn = document.getElementById('menu-permissions')
  if (permBtn) permBtn.onclick = () => {
    userDropdown?.classList.remove('open'); userBackdrop?.classList.remove('open')
    const wid = hierarchyStore.selectedWorkspaceId ?? 1
    import('./ui/modals').then(({ showPermissionModal }) => showPermissionModal('workspace', wid))
  }

  const agentMenuBtn = document.getElementById('menu-agent-panel')
  if (agentMenuBtn) {
    agentMenuBtn.onclick = () => {
      userDropdown?.classList.remove('open'); userBackdrop?.classList.remove('open')
      const ap = document.getElementById('agent-panel')
      const apb = document.getElementById('agent-panel-body')
      if (ap) {
        const visible = ap.style.display === 'block'
        ap.style.display = visible ? 'none' : 'block'
        if (apb) apb.classList.toggle('open', !visible)
      }
    }
  }

  const wsNewBtn = document.getElementById('ws-new-btn')
  if (wsNewBtn) {
    wsNewBtn.onclick = () => {
      wsDropdown?.classList.remove('open'); wsBackdrop?.classList.remove('open')
      import('./ui/modals').then(({ showCreateModal }) => showCreateModal('workspace', 0))
    }
  }

  const sidebarAddProj = document.getElementById('sidebar-add-project')
  if (sidebarAddProj) {
    sidebarAddProj.onclick = () => {
      import('./ui/modals').then(({ showCreateModal }) => {
        const wid = hierarchyStore.selectedWorkspaceId ?? 1
        showCreateModal('project', wid)
      })
    }
  }
}

// ── Sidebar view switching ──
function wireSidebarNav(): void {
  document.querySelectorAll('.side-nav-item').forEach(el => {
    el.addEventListener('click', () => {
      document.querySelectorAll('.side-nav-item').forEach(b => b.classList.remove('active'))
      el.classList.add('active')
      const view = (el as HTMLElement).dataset.view || 'sessions'
      switchView(view)
    })
  })
}

function switchView(view: string): void {
  currentView = view as 'dashboard' | 'sessions'
  document.querySelectorAll('.view-panel').forEach(p => p.classList.remove('active'))
  const panel = document.getElementById('view-' + view)
  if (panel) panel.classList.add('active')
  if (view === 'dashboard') renderDashboard()
}

// ── Render functions ──
function renderTopNav(): void {
  const wsName = document.getElementById('ws-name')
  if (wsName && hierarchyStore.tree) {
    const ws = hierarchyStore.tree.workspaces?.find(w => w.workspace.id === hierarchyStore.selectedWorkspaceId)
    if (ws) wsName.textContent = ws.workspace.name
  }

  const wsOptions = document.getElementById('ws-options')
  if (wsOptions && hierarchyStore.tree?.workspaces) {
    wsOptions.innerHTML = hierarchyStore.tree.workspaces.map(w => `
      <button class="ws-option${w.workspace.id === hierarchyStore.selectedWorkspaceId ? ' selected' : ''}" data-wid="${w.workspace.id}">
        <span class="ws-dot blue"></span> ${esc(w.workspace.name)}
        <span class="ws-info">${(w.projects || []).length}</span>
      </button>`).join('')
    wsOptions.querySelectorAll('.ws-option').forEach(btn => {
      btn.addEventListener('click', () => {
        const wid = parseInt((btn as HTMLElement).dataset.wid || '0')
        hierarchyStore.selectWorkspace(wid)
        document.getElementById('ws-dropdown')?.classList.remove('open')
        document.getElementById('ws-backdrop')?.classList.remove('open')
      })
    })
  }

  const uname = document.getElementById('user-name-display')
  const ufull = document.getElementById('user-fullname')
  const uav = document.getElementById('user-avatar')
  const uavLg = document.getElementById('user-avatar-lg')
  if (authStore.user) {
    const un = authStore.user.username
    const initial = un.charAt(0).toUpperCase()
    if (uname) uname.textContent = un
    if (ufull) ufull.textContent = un
    if (uav) uav.textContent = initial
    if (uavLg) uavLg.textContent = initial
  }

  // Active count
  const active = Object.values(sessionsStore.sessions).filter(s => s.status === 'active').length
  const countEl = document.getElementById('nav-active-count')
  if (countEl) countEl.textContent = `${active} active`

  // Sessions badge
  const badgeEl = document.getElementById('sess-badge')
  if (badgeEl) badgeEl.textContent = String(Object.keys(sessionsStore.sessions).length)
}

function updateConnIndicator(status: SSEStatus): void {
  const dot = document.getElementById('status-dot')
  const addr = document.getElementById('nav-addr')
  if (dot) {
    dot.classList.remove('offline')
    if (status === 'connected') { dot.style.background = '' }
    else if (status === 'connecting') { dot.style.background = 'var(--warning)' }
    else { dot.classList.add('offline') }
  }
  if (addr) addr.textContent = status === 'connected' ? 'daemon 127.0.0.1:9101' : 'daemon reconnecting…'
}

function renderFilters(): void {
  const host = document.getElementById('filter-group')
  if (!host) return
  const counts = sessionsStore.statusCounts()
  const total = Object.values(sessionsStore.sessions).length

  const pills = ['all', ...SESSION_STATUSES].map(s => {
    const c = s === 'all' ? total : (counts[s] ?? 0)
    if (s !== 'all' && c === 0 && sessionsStore.currentFilter !== s) return ''
    return `<button class="filter-pill ${sessionsStore.currentFilter === s ? 'active' : ''}" data-filter="${s}">
      ${s === 'all' ? 'All' : s}<span class="count">${c}</span>
    </button>`
  }).join('')

  host.innerHTML = pills
  host.querySelectorAll('[data-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      const f = (btn as HTMLElement).dataset.filter as 'all' | typeof SESSION_STATUSES[number]
      host.querySelectorAll('.filter-pill').forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
      sessionsStore.setFilter(f)
    })
  })
}

function renderDashboard(): void {
  if (currentView !== 'dashboard') return
  const statsRow = document.getElementById('stats-row')
  if (!statsRow) return
  const sessions = Object.values(sessionsStore.sessions)
  const active = sessions.filter(s => s.status === 'active').length
  const totalTurns = sessions.reduce((sum, s) => sum + (s.turn_count || 0), 0)
  const totalProj = hierarchyStore.tree?.workspaces?.reduce((s, w) => s + (w.projects?.length || 0), 0) ?? 0
  const avgCpu = sessions.filter(s => s.cpu_percent).reduce((s, x) => s + (x.cpu_percent || 0), 0) / Math.max(1, sessions.filter(s => s.cpu_percent).length)

  statsRow.innerHTML = `
    <div class="stat-card"><div class="stat-label">Active Sessions</div><div class="stat-value">${active}</div></div>
    <div class="stat-card"><div class="stat-label">Total Turns</div><div class="stat-value">${totalTurns}</div></div>
    <div class="stat-card"><div class="stat-label">Projects</div><div class="stat-value">${totalProj}</div></div>
    <div class="stat-card"><div class="stat-label">Avg CPU</div><div class="stat-value">${avgCpu.toFixed(1)}%</div></div>`

  // Recent activity
  const recent = document.getElementById('recent-activity')
  if (!recent) return
  const sorted = [...sessions].sort((a, b) => b.last_event_time_ms - a.last_event_time_ms).slice(0, 6)
  if (sorted.length === 0) {
    recent.innerHTML = '<div class="empty-state"><p>No recent activity</p></div>'
    return
  }
  recent.innerHTML = sorted.map(s => {
    const statusColor = s.status === 'active' ? 'var(--success)' : s.status === 'idle' ? 'var(--warning)' : s.status === 'stopped' ? 'var(--text-disabled)' : 'var(--danger)'
    const glow = s.status === 'active' ? 'box-shadow:0 0 6px var(--success-glow)' : ''
    return `<div style="display:flex;align-items:center;gap:var(--space-3);padding:var(--space-3);background:var(--bg-raised);border:1px solid var(--border-hairline);border-radius:var(--radius-md);margin-bottom:var(--space-2)">
      <span style="width:8px;height:8px;border-radius:50%;background:${statusColor};flex-shrink:0;${glow}"></span>
      <span style="font-size:var(--text-sm);color:var(--text-primary);flex:1"><strong>${esc(s.agent_type)}</strong> · ${esc(s.session_title || s.agent_session_id)}${s.turn_count ? ' — Turn ' + s.turn_count : ''}</span>
      <span style="font-size:var(--text-xs);color:var(--text-tertiary);font-family:var(--font-mono)">${formatTime(s.last_event_time_ms)}</span>
    </div>`
  }).join('')
}

function esc(s: string): string {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
}
function formatTime(ms: number | null | undefined): string {
  if (!ms) return ''
  const diff = Date.now() - ms
  if (diff < 0) return ''
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}

// ── Auth store wiring ──
authStore.subscribe(() => {
  if (authStore.authed && !sse) {
    connectSSE()
    void refreshHierarchy()
  } else if (!authStore.authed && sse) {
    sse.close(); sse = null
  }
})

renderShell()
wireUnauthorizedAutoLogout()

restoreSession(() => {
  if (authStore.authed) {
    showApp()
    connectSSE()
    void refreshHierarchy()
  }
})