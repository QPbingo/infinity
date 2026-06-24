import { createWorkspace, createProject, createTopic, createStory, updateStory, deleteStory, getHierarchy } from '../api/hierarchy'
import { listPermissions, setPermission, removePermission, listUsers } from '../api/permissions'
import { hierarchyStore } from '../state/hierarchy'
import { esc } from '../utils/format'
import { toast } from './toast'

// Modals are mounted into #modal-overlay. The overlay click handler (set in
// main.ts renderShell) closes when the backdrop is clicked. All these
// functions replace the old `prompt()/confirm()` calls with proper UI that
// matches the design system.

export function showCreateModal(type: 'workspace' | 'project' | 'topic', parentId: number): void {
  const box = document.getElementById('modal-box')
  const overlay = document.getElementById('modal-overlay')
  if (!box || !overlay) return
  const labels: Record<string, [string, string]> = {
    workspace: ['Workspace Name', ''],
    project: ['Project Name', ''],
    topic: ['Topic Name', 'agent_type (optional)'],
  }
  const l = labels[type]
  box.innerHTML = `
    <h3>New ${esc(type)}</h3>
    <label class="field-label" for="modal-name">${esc(l[0])}</label>
    <input type="text" id="modal-name" placeholder="${esc(l[0])}" autofocus>
    ${type === 'topic' ? '<label class="field-label" for="modal-agent">Agent type</label><input type="text" id="modal-agent" placeholder="claude / codex / opencode">' : ''}
    <div class="modal-actions">
      <button class="btn-cancel" id="modal-cancel">Cancel</button>
      <button class="btn-primary" id="modal-create">Create</button>
    </div>`
  overlay.style.display = 'flex'
  bindModalCancel('modal-cancel')
  bindEnter('modal-name', () => doCreate(type, parentId))
  const createBtn = document.getElementById('modal-create')
  if (createBtn) createBtn.onclick = () => doCreate(type, parentId)
}

export function showEditStoryModal(storyId: number, currentName: string): void {
  const box = document.getElementById('modal-box')
  const overlay = document.getElementById('modal-overlay')
  if (!box || !overlay) return
  box.innerHTML = `
    <h3>Rename Story</h3>
    <label class="field-label" for="modal-name">New name</label>
    <input type="text" id="modal-name" value="${esc(currentName)}" autofocus>
    <div class="modal-actions">
      <button class="btn-cancel" id="modal-cancel">Cancel</button>
      <button class="btn-primary" id="modal-create">Save</button>
    </div>`
  overlay.style.display = 'flex'
  bindModalCancel('modal-cancel')
  const doSave = async () => {
    const name = (document.getElementById('modal-name') as HTMLInputElement)?.value.trim() ?? ''
    if (!name) { toast.warn('Name is required'); return }
    const btn = document.getElementById('modal-create') as HTMLButtonElement | null
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…' }
    try {
      await updateStory(storyId, name)
      closeModal()
      await refreshHierarchy()
      toast.ok('Story renamed')
    } catch (e) {
      toast.error('Rename failed: ' + ((e as Error).message || 'unknown'))
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Save' }
    }
  }
  bindEnter('modal-name', doSave)
  const saveBtn = document.getElementById('modal-create')
  if (saveBtn) saveBtn.onclick = doSave
}

export function showDeleteStoryModal(storyId: number, name: string): void {
  const box = document.getElementById('modal-box')
  const overlay = document.getElementById('modal-overlay')
  if (!box || !overlay) return
  box.innerHTML = `
    <h3>Delete story?</h3>
    <p>“${esc(name)}” will be removed permanently.</p>
    <div class="modal-actions">
      <button class="btn-cancel" id="modal-cancel">Cancel</button>
      <button class="btn-danger" id="modal-delete">Delete</button>
    </div>`
  overlay.style.display = 'flex'
  bindModalCancel('modal-cancel')
  const delBtn = document.getElementById('modal-delete')
  if (delBtn) delBtn.onclick = () => onDeleteStory(storyId)
}

function bindModalCancel(btnId: string): void {
  const btn = document.getElementById(btnId)
  if (btn) btn.onclick = () => closeModal()
}

// Enter on a text input triggers the primary action.
function bindEnter(inputId: string, onEnter: () => void): void {
  const el = document.getElementById(inputId)
  if (el) {
    el.onkeydown = (e) => {
      if (e.key === 'Enter') onEnter()
    }
  }
}

export function closeModal(): void {
  const overlay = document.getElementById('modal-overlay')
  if (overlay) overlay.style.display = 'none'
}

async function doCreate(type: 'workspace' | 'project' | 'topic', parentId: number): Promise<void> {
  const name = (document.getElementById('modal-name') as HTMLInputElement)?.value.trim() ?? ''
  if (!name) { toast.warn('Name is required'); return }
  const btn = document.getElementById('modal-create') as HTMLButtonElement | null
  if (btn) { btn.disabled = true; btn.textContent = 'Creating…' }
  const wid = hierarchyStore.selectedWorkspaceId ?? 1
  try {
    switch (type) {
      case 'workspace': await createWorkspace(name); break
      case 'project': await createProject(wid, name); break
      case 'topic': {
        const at = (document.getElementById('modal-agent') as HTMLInputElement)?.value.trim() ?? ''
        await createTopic(wid, parentId, name, at)
        break
      }
    }
    closeModal()
    await refreshHierarchy()
    toast.ok(`${type} created`)
  } catch (e) {
    toast.error('Create failed: ' + ((e as Error).message || 'unknown'))
  }
}

export async function onCreateStory(topicId: number): Promise<void> {
  showCreateStoryModal(topicId)
}

function showCreateStoryModal(topicId: number): void {
  const box = document.getElementById('modal-box')
  const overlay = document.getElementById('modal-overlay')
  if (!box || !overlay) return
  box.innerHTML = `
    <h3>New Story under Topic ${topicId}</h3>
    <label class="field-label" for="modal-name">Story name</label>
    <input type="text" id="modal-name" autofocus>
    <div class="modal-actions">
      <button class="btn-cancel" id="modal-cancel">Cancel</button>
      <button class="btn-primary" id="modal-create">Create</button>
    </div>`
  overlay.style.display = 'flex'
  bindModalCancel('modal-cancel')
  bindEnter('modal-name', () => doCreateStory(topicId))
  const createBtn = document.getElementById('modal-create')
  if (createBtn) createBtn.onclick = () => doCreateStory(topicId)
}

async function doCreateStory(topicId: number): Promise<void> {
  const name = (document.getElementById('modal-name') as HTMLInputElement)?.value.trim() ?? ''
  if (!name) { toast.warn('Name is required'); return }
  const wid = hierarchyStore.selectedWorkspaceId ?? 1
  let pid = 0
  for (const ws of hierarchyStore.tree?.workspaces ?? []) {
    for (const proj of ws.projects ?? []) {
      if (proj.topics?.some((t) => t.topic.id === topicId)) { pid = proj.project.id; break }
    }
  }
  if (!pid) {
    toast.error('Topic not found — refresh and try again')
    return
  }
  try {
    await createStory(wid, pid, topicId, name)
    closeModal()
    await refreshHierarchy()
    toast.ok('Story created')
  } catch (e) {
    toast.error('Create story failed: ' + ((e as Error).message || 'unknown'))
  }
}

export async function onEditStory(id: number): Promise<void> {
  let currentName = ''
  for (const ws of hierarchyStore.tree?.workspaces ?? []) {
    for (const proj of ws.projects ?? []) {
      for (const topic of proj.topics ?? []) {
        const found = topic.stories?.find((s) => s.id === id)
        if (found) { currentName = found.name; break }
      }
    }
  }
  showEditStoryModal(id, currentName)
}

export async function onDeleteStory(id: number): Promise<void> {
  let name = ''
  for (const ws of hierarchyStore.tree?.workspaces ?? []) {
    for (const proj of ws.projects ?? []) {
      for (const topic of proj.topics ?? []) {
        const found = topic.stories?.find((s) => s.id === id)
        if (found) { name = found.name; break }
      }
    }
  }
  showDeleteStoryModal(id, name)
  const delBtn = document.getElementById('modal-delete')
  if (delBtn) {
    delBtn.onclick = async () => {
      try {
        await deleteStory(id)
        closeModal()
        await refreshHierarchy()
        toast.ok('Story deleted')
      } catch (e) {
        toast.error('Delete failed: ' + ((e as Error).message || 'unknown'))
      }
    }
  }
}

export async function refreshHierarchy(): Promise<void> {
  try {
    const tree = await getHierarchy()
    hierarchyStore.setTree(tree)
  } catch (e) {
    toast.error('Hierarchy refresh failed: ' + ((e as Error).message || 'unknown'))
  }
}

export function showPermissionModal(type: 'workspace' | 'project', id: number): void {
  const labels = { workspace: 'Workspace', project: 'Project' }
  const box = document.getElementById('modal-box')
  const overlay = document.getElementById('modal-overlay')
  if (!box || !overlay) return
  box.innerHTML = `
    <h3>${labels[type]} Permissions</h3>
    <div id="perm-list" class="perm-list">Loading…</div>
    <div class="perm-add-row">
      <select id="perm-user-select" aria-label="User"></select>
      <select id="perm-level-select" aria-label="Level">
        <option value="100">Admin</option>
        <option value="10">Viewer</option>
      </select>
      <button class="btn-primary" id="perm-add">Add</button>
    </div>
    <div class="modal-actions"><button class="btn-cancel" id="perm-close">Close</button></div>`
  overlay.style.display = 'flex'
  bindModalCancel('perm-close')
  const addBtn = document.getElementById('perm-add')
  if (addBtn) addBtn.onclick = () => addPermission(type, id)
  void loadPermissions(type, id)
  void loadUsersForSelect()
}

async function loadPermissions(type: 'workspace' | 'project', id: number): Promise<void> {
  const el = document.getElementById('perm-list')
  if (!el) return
  try {
    const perms = await listPermissions(type, id)
    if (perms.length === 0) {
      el.innerHTML = '<div class="perm-empty">No permissions set</div>'
      return
    }
    el.innerHTML = perms.map((p) => `
      <div class="perm-row" data-perm-uid="${p.user_id}">
        <span class="perm-user">User #${p.user_id}<span class="perm-level"> (${p.level >= 100 ? 'Admin' : 'Viewer'})</span></span>
        <button class="perm-remove" data-uid="${p.user_id}" aria-label="Revoke">✕</button>
      </div>`).join('')
    el.querySelectorAll('[data-uid]').forEach((btn) => {
      ;(btn as HTMLElement).onclick = async () => {
        const uid = parseInt((btn as HTMLElement).dataset.uid ?? '0', 10)
        try {
          await removePermission(type, id, uid)
          toast.ok('Permission revoked')
          void loadPermissions(type, id)
        } catch (e) {
          toast.error('Revoke failed: ' + ((e as Error).message || 'unknown'))
        }
      }
    })
  } catch (e) {
    el.innerHTML = '<div class="perm-empty">Failed to load</div>'
  }
}

async function loadUsersForSelect(): Promise<void> {
  try {
    const users = await listUsers()
    const sel = document.getElementById('perm-user-select') as HTMLSelectElement | null
    if (!sel) return
    sel.innerHTML = users.map((u) => `<option value="${u.id}">${esc(u.username)}</option>`).join('')
  } catch {
    // ignore — user list is best-effort
  }
}

async function addPermission(type: 'workspace' | 'project', id: number): Promise<void> {
  const uid = parseInt((document.getElementById('perm-user-select') as HTMLSelectElement)?.value ?? '0')
  const level = parseInt((document.getElementById('perm-level-select') as HTMLSelectElement)?.value ?? '0')
  if (!uid) return
  try {
    await setPermission(type, id, uid, level)
    toast.ok('Permission added')
    void loadPermissions(type, id)
  } catch (e) {
    toast.error('Add permission failed: ' + ((e as Error).message || 'unknown'))
  }
}
