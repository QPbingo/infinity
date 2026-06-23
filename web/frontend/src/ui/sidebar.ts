import { hierarchyStore, type ProjectNode, type TopicNode } from '../state/hierarchy'
import { sessionsStore } from '../state/sessions'
import { esc, trunc } from '../utils/format'
import { showCreateModal, showPermissionModal, onCreateStory, onEditStory, onDeleteStory } from './modals'

// Render the sidebar tree from hierarchyStore. Replaces dashboard.html's
// renderTree/renderProjectNode. Only the selected workspace is rendered.
export function renderSidebar(): void {
  const tree = hierarchyStore.tree
  const container = document.getElementById('tree')
  if (!container || !tree || !tree.workspaces) return

  // Workspace selector dropdown.
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
  html += `<div class="tree-row" onclick="window.__hier.toggleNode('${wsId}')">`
  html += `<span class="tree-arrow${wsOpen ? ' open' : ''}">▶</span>`
  html += '<span class="tree-icon">📁</span>'
  html += `<span class="tree-name" title="${esc(ws.workspace.name)}">${esc(ws.workspace.name)}</span>`
  html += `<span class="tree-add" onclick="event.stopPropagation();window.__perm('workspace',${ws.workspace.id})" title="Permissions">👥</span>`
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
  h += `<div class="tree-row" onclick="window.__selectProject(${proj.project.id})">`
  h += `<span class="tree-arrow${pOpen ? ' open' : ''}" onclick="event.stopPropagation();window.__hier.toggleNode('${pId}')">▶</span>`
  h += '<span class="tree-icon">📂</span>'
  h += `<span class="tree-name" title="${esc(proj.project.name)}">${esc(proj.project.name)}</span>`
  h += `<span class="tree-add" onclick="event.stopPropagation();window.__perm('project',${proj.project.id})" title="Permissions">👥</span>`
  h += `<span class="tree-add" onclick="event.stopPropagation();window.__createTopic(${proj.project.id})" title="New topic">+</span>`
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
  h += `<div class="tree-row${sel}" onclick="window.__selectTopic(${topic.topic.id},'${esc(topic.topic.name)}')">`
  h += `<span class="tree-arrow${tOpen ? ' open' : ''}" onclick="event.stopPropagation();window.__hier.toggleNode('${tId}')">▶</span>`
  h += '<span class="tree-icon">📝</span>'
  h += `<span class="tree-name" title="${esc(topic.topic.name)}">${esc(topic.topic.name)}</span>`
  h += `<span class="tree-badge">${count}</span>`
  h += `<span class="tree-add" onclick="event.stopPropagation();window.__createStory(${topic.topic.id})" title="New story">+</span>`
  h += '</div>'
  if (topic.stories && topic.stories.length > 0) {
    h += `<div class="tree-children${tOpen ? ' open' : ''}" id="${tId}">`
    for (const story of topic.stories) {
      const storyKey = story.session_key
      const storySel = hierarchyStore.selectedStoryId === story.id ? ' selected' : ''
      const session = storyKey ? sessionsStore.sessions[storyKey] : null
      const storyName = session ? (session.session_title || session.agent_session_id) : story.name
      h += `<div class="tree-row${storySel}" onclick="window.__selectStory(${story.id})">`
      h += '<span style="width:20px"></span>'
      h += `<span class="tree-icon" style="font-size:0.7em">${storyKey ? '●' : '○'}</span>`
      h += `<span class="tree-name" title="${esc(storyName)}" style="font-size:0.72em">${esc(trunc(storyName, 28))}</span>`
      h += `<span class="tree-add" onclick="event.stopPropagation();window.__editStory(${story.id})" title="Rename">✎</span>`
      h += `<span class="tree-add" onclick="event.stopPropagation();window.__deleteStory(${story.id})" title="Delete">✕</span>`
      h += '</div>'
    }
    h += '</div>'
  }
  h += '</div>'
  return h
}

// Expose handlers to inline onclick attributes (the tree uses inline handlers
// to stay close to the original dashboard.html structure).
export function bindTreeHandlers(): void {
  const w = window as unknown as Record<string, unknown>
  w.__hier = hierarchyStore
  w.__perm = showPermissionModal
  w.__createTopic = (pid: number) => showCreateModal('topic', pid)
  w.__createStory = (tid: number) => onCreateStory(tid)
  w.__editStory = (id: number) => onEditStory(id)
  w.__deleteStory = (id: number) => onDeleteStory(id)
  w.__selectProject = (pid: number) => hierarchyStore.toggleNode('proj_' + pid)
  w.__selectTopic = (id: number, name: string) => hierarchyStore.selectTopic(id, name)
  w.__selectStory = (id: number) => hierarchyStore.selectStory(id)
}
