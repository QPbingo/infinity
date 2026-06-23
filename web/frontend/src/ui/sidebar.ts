import { hierarchyStore, type ProjectNode, type TopicNode } from '../state/hierarchy'
import { sessionsStore } from '../state/sessions'
import { esc, trunc } from '../utils/format'
import { showCreateModal, showPermissionModal, onCreateStory, onEditStory, onDeleteStory } from './modals'

// ─── Inline SVG icons (replace emojis per UI/UX guidelines) ────────────────

const I = {
  folder:   '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M2 4a1 1 0 0 1 1-1h3.5l1.5 2H14a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V4Z"/></svg>',
  folderOpen: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M2 5a1 1 0 0 1 1-1h2.5l1.5 2H14a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5Z"/><path d="M2 5v7a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1H2Z" opacity=".3"/></svg>',
  doc:      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M5 2h4l4 4v8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Z"/><path d="M9 2v4h4"/></svg>',
  users:    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="6" cy="5" r="2"/><path d="M2 13c0-2.2 1.8-4 4-4s4 1.8 4 4"/><circle cx="12" cy="5" r="1.5"/><path d="M10 10c1.1 0 2 .9 2 2v1h2"/></svg>',
  plus:     '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3v10M3 8h10"/></svg>',
  edit:     '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M11 2l3 3-9 9H2v-3l9-9Z"/></svg>',
  close:    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
  dotOn:    '<svg viewBox="0 0 8 8"><circle cx="4" cy="4" r="3" fill="currentColor"/></svg>',
  dotOff:   '<svg viewBox="0 0 8 8"><circle cx="4" cy="4" r="2.5" fill="none" stroke="currentColor" stroke-width="1"/></svg>',
}

function icon(k: keyof typeof I, cls = ''): string {
  return `<span class="tree-icon ${cls}">${I[k]}</span>`
}

// ─── Render ─────────────────────────────────────────────────────────────────

// Render the sidebar tree from hierarchyStore.
export function renderSidebar(): void {
  const tree = hierarchyStore.tree
  const container = document.getElementById('tree')
  if (!container || !tree || !tree.workspaces) return

  const sel = document.getElementById('ws-select') as HTMLSelectElement | null
  if (sel) {
    sel.innerHTML = tree.workspaces
      .map((w) => `<option value="${w.workspace.id}"${w.workspace.id === hierarchyStore.selectedWorkspaceId ? ' selected' : ''}>${esc(w.workspace.name)}</option>`)
      .join('')
  }

  const ws = tree.workspaces.find((w) => w.workspace.id === hierarchyStore.selectedWorkspaceId)
  if (!ws) { container.innerHTML = ''; return }

  const wsId = 'ws_' + ws.workspace.id
  const wsOpen = hierarchyStore.expandedNodes[wsId] !== false
  let html = '<div class="tree-node">'
  html += `<div class="tree-row" data-action="toggle-node" data-id="${wsId}">`
  html += `<span class="tree-arrow${wsOpen ? ' open' : ''}">▶</span>`
  html += icon(wsOpen ? 'folderOpen' : 'folder')
  html += `<span class="tree-name" title="${esc(ws.workspace.name)}">${esc(ws.workspace.name)}</span>`
  html += `<button class="action-btn is-reveal" data-action="show-perm-workspace" data-id="${ws.workspace.id}" title="Permissions">${I.users}</button>`
  html += '</div>'
  html += `<div class="tree-children${wsOpen ? ' open' : ''}" id="${wsId}">`
  if (ws.projects) {
    for (const proj of ws.projects) html += renderProjectNode(proj)
  }
  html += '</div></div>'
  container.innerHTML = html
}

function renderProjectNode(proj: ProjectNode): string {
  const pId = 'proj_' + proj.project.id
  const pOpen = hierarchyStore.expandedNodes[pId]
  let h = '<div class="tree-node">'
  h += `<div class="tree-row" data-action="toggle-proj" data-id="${pId}">`
  h += `<span class="tree-arrow${pOpen ? ' open' : ''}" data-action="toggle-node" data-id="${pId}">▶</span>`
  h += icon(pOpen ? 'folderOpen' : 'folder')
  h += `<span class="tree-name" title="${esc(proj.project.name)}">${esc(proj.project.name)}</span>`
  h += `<button class="action-btn is-reveal" data-action="show-perm-project" data-id="${proj.project.id}" title="Permissions">${I.users}</button>`
  h += `<button class="action-btn is-reveal" data-action="create-topic" data-id="${proj.project.id}" title="New topic">${I.plus}</button>`
  h += '</div>'
  h += `<div class="tree-children${pOpen ? ' open' : ''}" id="${pId}">`
  if (proj.topics) {
    for (const topic of proj.topics) h += renderTopicNode(topic)
  }
  h += '</div></div>'
  return h
}

function renderTopicNode(topic: TopicNode): string {
  const tId = 'topic_' + topic.topic.id
  const tOpen = hierarchyStore.expandedNodes[tId]
  const sel = hierarchyStore.selectedTopicId === topic.topic.id ? ' selected' : ''
  const count = topic.stories?.length ?? 0
  let h = '<div class="tree-node">'
  h += `<div class="tree-row${sel}" data-action="select-topic" data-id="${topic.topic.id}" data-name="${esc(topic.topic.name)}">`
  h += `<span class="tree-arrow${tOpen ? ' open' : ''}" data-action="toggle-node" data-id="${tId}">▶</span>`
  h += icon('doc')
  h += `<span class="tree-name" title="${esc(topic.topic.name)}">${esc(topic.topic.name)}</span>`
  h += `<span class="tree-badge">${count}</span>`
  h += `<button class="action-btn is-reveal" data-action="create-story" data-id="${topic.topic.id}" title="New story">${I.plus}</button>`
  h += '</div>'
  if (topic.stories && topic.stories.length > 0) {
    h += `<div class="tree-children${tOpen ? ' open' : ''}" id="${tId}">`
    for (const story of topic.stories) {
      const storyKey = story.session_key
      const storySel = hierarchyStore.selectedStoryId === story.id ? ' selected' : ''
      const session = storyKey ? sessionsStore.sessions[storyKey] : null
      const storyName = session ? (session.session_title || session.agent_session_id) : story.name
      h += `<div class="tree-row${storySel}" data-action="select-story" data-id="${story.id}">`
      h += '<span style="width:20px"></span>'
      h += `<span class="tree-icon" style="font-size:0.7em">${storyKey ? I.dotOn : I.dotOff}</span>`
      h += `<span class="tree-name" title="${esc(storyName)}" style="font-size:0.72em">${esc(trunc(storyName, 28))}</span>`
      h += `<button class="action-btn is-reveal" data-action="edit-story" data-id="${story.id}" title="Rename">${I.edit}</button>`
      h += `<button class="action-btn is-reveal" data-action="delete-story" data-id="${story.id}" title="Delete">${I.close}</button>`
      h += '</div>'
    }
    h += '</div>'
  }
  h += '</div>'
  return h
}

// bindTreeHandlers attaches one delegated click listener on the tree el,
// replacing the old `window.__toggleCard` etc. globals.
export function bindTreeHandlers(): void {
  const container = document.getElementById('tree')
  if (!container) return
  container.addEventListener('click', (e) => {
    const target = e.target as HTMLElement
    const btn = target.closest<HTMLElement>('[data-action]')
    if (!btn) return
    const action = btn.dataset.action
    const id = btn.dataset.id ?? ''
    const name = btn.dataset.name ?? ''
    switch (action) {
      case 'toggle-node':
        e.stopPropagation()
        hierarchyStore.toggleNode(id)
        break
      case 'toggle-proj':
        // Row-level click expands (mirrors legacy behavior).
        hierarchyStore.toggleNode(id)
        break
      case 'select-topic':
        hierarchyStore.selectTopic(parseInt(id, 10), name)
        break
      case 'select-story':
        hierarchyStore.selectStory(parseInt(id, 10))
        break
      case 'show-perm-workspace':
        e.stopPropagation()
        showPermissionModal('workspace', parseInt(id, 10))
        break
      case 'show-perm-project':
        e.stopPropagation()
        showPermissionModal('project', parseInt(id, 10))
        break
      case 'create-topic':
        e.stopPropagation()
        showCreateModal('topic', parseInt(id, 10))
        break
      case 'create-story':
        e.stopPropagation()
        void onCreateStory(parseInt(id, 10))
        break
      case 'edit-story':
        e.stopPropagation()
        void onEditStory(parseInt(id, 10))
        break
      case 'delete-story':
        e.stopPropagation()
        void onDeleteStory(parseInt(id, 10))
        break
    }
  })
}