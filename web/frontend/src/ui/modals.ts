import { createWorkspace, createProject, createTopic, createStory, updateStory, deleteStory, getHierarchy } from '../api/hierarchy'
import { listPermissions, setPermission, removePermission, listUsers } from '../api/permissions'
import { hierarchyStore } from '../state/hierarchy'
import { esc } from '../utils/format'

// Modals: create (workspace/project/topic) + permission management.
// Replaces dashboard.html's showCreateModal/doCreate/showPermissionModal/etc.

export function showCreateModal(type: 'workspace' | 'project' | 'topic', parentId: number): void {
  const labels: Record<string, [string, string]> = {
    workspace: ['Workspace Name', ''],
    project: ['Project Name', ''],
    topic: ['Topic Name', 'agent_type (optional)'],
  }
  const l = labels[type]
  const box = document.getElementById('modal-box')
  const overlay = document.getElementById('modal-overlay')
  if (!box || !overlay) return
  box.innerHTML = `
    <h3>New ${type}</h3>
    <input type="text" id="modal-name" placeholder="${l[0]}">
    ${type === 'topic' ? '<input type="text" id="modal-agent" placeholder="agent_type (claude/codex/opencode)">' : ''}
    <div class="modal-actions">
      <button class="btn-cancel" id="modal-cancel">Cancel</button>
      <button class="btn-primary" id="modal-create">Create</button>
    </div>`
  overlay.style.display = 'flex'
  document.getElementById('modal-cancel')?.addEventListener('click', closeModal)
  document.getElementById('modal-create')?.addEventListener('click', () => doCreate(type, parentId))
}

export function closeModal(): void {
  const overlay = document.getElementById('modal-overlay')
  if (overlay) overlay.style.display = 'none'
}

async function doCreate(type: 'workspace' | 'project' | 'topic', parentId: number): Promise<void> {
  const name = (document.getElementById('modal-name') as HTMLInputElement)?.value.trim() ?? ''
  if (!name) return
  // HIER-12 fix: use dynamic workspace/project ids, never hardcoded 1.
  const wid = hierarchyStore.selectedWorkspaceId ?? 1
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
}

// createStory uses dynamic wid+pid+tid (HIER-12/HIER-15 fix).
export async function onCreateStory(topicId: number): Promise<void> {
  const name = prompt('Story name:')
  if (!name) return
  const wid = hierarchyStore.selectedWorkspaceId ?? 1
  // Find the project that contains this topic.
  let pid = 0
  for (const ws of hierarchyStore.tree?.workspaces ?? []) {
    for (const proj of ws.projects ?? []) {
      if (proj.topics?.some((t) => t.topic.id === topicId)) { pid = proj.project.id; break }
    }
  }
  await createStory(wid, pid, topicId, name)
  await refreshHierarchy()
}

export async function onEditStory(id: number): Promise<void> {
  const name = prompt('New story name:')
  if (!name) return
  await updateStory(id, name)
  await refreshHierarchy()
}

export async function onDeleteStory(id: number): Promise<void> {
  if (!confirm('Delete this story?')) return
  await deleteStory(id)
  await refreshHierarchy()
}

export async function refreshHierarchy(): Promise<void> {
  try {
    const tree = await getHierarchy()
    hierarchyStore.setTree(tree)
  } catch {
    // ignore — session may have expired
  }
}

export function showPermissionModal(type: 'workspace' | 'project', id: number): void {
  const labels = { workspace: 'Workspace', project: 'Project' }
  const box = document.getElementById('modal-box')
  const overlay = document.getElementById('modal-overlay')
  if (!box || !overlay) return
  box.innerHTML = `
    <h3>${labels[type]} Permissions</h3>
    <div id="perm-list" style="font-size:0.78em;margin-bottom:10px;max-height:150px;overflow-y:auto">Loading...</div>
    <div style="display:flex;gap:4px;margin-bottom:8px">
      <select id="perm-user-select" style="flex:1;padding:4px;background:#0d1117;border:1px solid #30363d;border-radius:3px;color:#c9d1d9;font-size:0.78em"></select>
      <select id="perm-level-select" style="padding:4px;background:#0d1117;border:1px solid #30363d;border-radius:3px;color:#c9d1d9;font-size:0.78em">
        <option value="100">Admin</option>
        <option value="10">Viewer</option>
      </select>
      <button class="btn-primary" id="perm-add" style="padding:4px 8px;font-size:0.72em">Add</button>
    </div>
    <div class="modal-actions"><button class="btn-cancel" id="perm-close">Close</button></div>`
  overlay.style.display = 'flex'
  document.getElementById('perm-close')?.addEventListener('click', closeModal)
  document.getElementById('perm-add')?.addEventListener('click', () => addPermission(type, id))
  loadPermissions(type, id)
  loadUsersForSelect()
}

async function loadPermissions(type: 'workspace' | 'project', id: number): Promise<void> {
  try {
    const perms = await listPermissions(type, id)
    const el = document.getElementById('perm-list')
    if (!el) return
    if (perms.length === 0) { el.innerHTML = '<div style="color:#8b949e">No permissions set</div>'; return }
    el.innerHTML = perms.map((p) => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:2px 0;border-bottom:1px solid #21262d">
        <span>User #${p.user_id} <span style="color:#8b949e">(${p.level >= 100 ? 'Admin' : 'Viewer'})</span></span>
        <button onclick="window.__rmPerm('${type}',${id},${p.user_id})" style="background:none;border:none;color:#f85149;cursor:pointer;font-size:0.8em">✕</button>
      </div>`).join('')
    ;(window as unknown as Record<string, unknown>).__rmPerm = async (t: string, rid: number, uid: number) => {
      await removePermission(t as 'workspace' | 'project', rid, uid)
      loadPermissions(type, id)
    }
  } catch { /* ignore */ }
}

async function loadUsersForSelect(): Promise<void> {
  try {
    const users = await listUsers()
    const sel = document.getElementById('perm-user-select') as HTMLSelectElement | null
    if (!sel) return
    sel.innerHTML = users.map((u) => `<option value="${u.id}">${esc(u.username)}</option>`).join('')
  } catch { /* ignore */ }
}

async function addPermission(type: 'workspace' | 'project', id: number): Promise<void> {
  const uid = parseInt((document.getElementById('perm-user-select') as HTMLSelectElement)?.value ?? '0')
  const level = parseInt((document.getElementById('perm-level-select') as HTMLSelectElement)?.value ?? '0')
  if (!uid) return
  await setPermission(type, id, uid, level)
  loadPermissions(type, id)
}
