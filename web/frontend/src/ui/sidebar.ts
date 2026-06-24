import { hierarchyStore, type ProjectNode, type TopicNode } from '../state/hierarchy'
import { sessionsStore } from '../state/sessions'
import { esc, trunc } from '../utils/format'
import { showCreateModal, showPermissionModal, onCreateStory, onEditStory, onDeleteStory } from './modals'

export function renderSidebar(): void {
  const tree = hierarchyStore.tree
  const container = document.getElementById('sidebar-tree')
  if (!container || !tree || !tree.workspaces) return

  const ws = tree.workspaces.find((w) => w.workspace.id === hierarchyStore.selectedWorkspaceId)
  if (!ws) { container.innerHTML = ''; return }

  let html = ''
  if (ws.projects) {
    for (const proj of ws.projects) html += renderProjectNode(proj)
  }
  html += '<div class="tree-separator"></div>'

  container.innerHTML = html
}

export function bindTreeHandlers(): void {
  const container = document.getElementById('sidebar-tree')
  if (!container) return
  bindTreeEventDelegation(container)
}

function renderProjectNode(proj: ProjectNode): string {
  const pId = 'proj_' + proj.project.id
  const pOpen = hierarchyStore.expandedNodes[pId] !== false
  const count = (proj.topics || []).length
  let h = `<div class="tree-node tree-project" data-action="toggle-proj" data-id="${pId}">
    <span class="arrow${pOpen ? ' open' : ''}">▸</span>
    <span class="node-icon">&#9632;</span>
    <span class="label">${esc(proj.project.name)}</span>
    ${count > 0 ? `<span class="count">${count}</span>` : ''}
    <span class="add-child" data-action="create-topic" data-id="${proj.project.id}">+</span>
    <span class="add-child" data-action="show-perm-project" data-id="${proj.project.id}">👥</span>
  </div>`
  h += `<div class="tree-children${pOpen ? ' open' : ''}" id="${pId}">`
  if (proj.topics) {
    for (const topic of proj.topics) h += renderTopicNode(topic)
  }
  h += '</div>'
  return h
}

function renderTopicNode(topic: TopicNode): string {
  const tId = 'topic_' + topic.topic.id
  const tOpen = hierarchyStore.expandedNodes[tId] !== false
  const sel = hierarchyStore.selectedTopicId === topic.topic.id ? ' selected' : ''
  const count = topic.stories?.length ?? 0
  let h = `<div class="tree-node tree-topic${sel}" data-action="select-topic" data-id="${topic.topic.id}">
    <span class="arrow${tOpen ? ' open' : ''}" data-action="toggle-node" data-id="${tId}">▸</span>
    <span class="node-icon">&#9679;</span>
    <span class="label">${esc(topic.topic.name)}</span>
    ${count > 0 ? `<span class="count">${count}</span>` : ''}
    <span class="add-child" data-action="create-story" data-id="${topic.topic.id}">+</span>
  </div>`
  if (topic.stories && topic.stories.length > 0) {
    h += `<div class="tree-children${tOpen ? ' open' : ''}" id="${tId}">`
    for (const story of topic.stories) {
      const storyKey = story.session_key
      const storySel = hierarchyStore.selectedStoryId === story.id ? ' selected' : ''
      const session = storyKey ? sessionsStore.sessions[storyKey] : null
      const storyName = story.name
      const sessionInfo = session ? (session.session_title || trunc(session.agent_session_id, 20)) : ''
      h += `<div class="tree-node tree-story${storySel}" data-action="select-story" data-id="${story.id}">
        <span class="node-icon">&#8728;</span>
        <span class="label" title="${esc(sessionInfo)}">${esc(trunc(storyName, 28))}</span>
        <span class="add-child" data-action="edit-story" data-id="${story.id}">✎</span>
        <span class="add-child" data-action="delete-story" data-id="${story.id}">✕</span>
      </div>`
    }
    h += '</div>'
  }
  return h
}

function bindTreeEventDelegation(container: HTMLElement): void {
  container.addEventListener('click', (e) => {
    const target = e.target as HTMLElement
    const btn = target.closest<HTMLElement>('[data-action]')
    if (!btn) return
    const action = btn.dataset.action
    const id = btn.dataset.id ?? ''
    switch (action) {
      case 'toggle-proj':
        hierarchyStore.toggleNode(id)
        break
      case 'toggle-node':
        e.stopPropagation()
        hierarchyStore.toggleNode(id)
        break
      case 'select-topic':
        hierarchyStore.selectTopic(parseInt(id, 10), '')
        break
      case 'select-story':
        hierarchyStore.selectStory(parseInt(id, 10))
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