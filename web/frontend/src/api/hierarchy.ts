import { request } from './client'
import type { HierarchyTree } from '../state/hierarchy'

export async function getHierarchy(): Promise<HierarchyTree> {
  return request<HierarchyTree>('/api/hierarchy')
}

export async function createWorkspace(name: string, description = ''): Promise<void> {
  await request('/api/workspaces', { method: 'POST', body: JSON.stringify({ name, description }) })
}

export async function createProject(workspaceId: number, name: string, description = ''): Promise<void> {
  await request(`/api/workspaces/${workspaceId}/projects`, { method: 'POST', body: JSON.stringify({ name, description }) })
}

export async function createTopic(workspaceId: number, projectId: number, name: string, agentType = '', description = ''): Promise<void> {
  await request(`/api/workspaces/${workspaceId}/projects/${projectId}/topics`, {
    method: 'POST',
    body: JSON.stringify({ name, description, agent_type: agentType }),
  })
}

// createStory uses the DYNAMIC topic id (HIER-12/HIER-15 fix — the old code
// hardcoded wid=1, pid=1). The caller passes the current workspace + project.
export async function createStory(workspaceId: number, projectId: number, topicId: number, name: string, description = ''): Promise<void> {
  await request(`/api/workspaces/${workspaceId}/projects/${projectId}/topics/${topicId}/stories`, {
    method: 'POST',
    body: JSON.stringify({ name, description }),
  })
}

export async function updateStory(id: number, name: string, description = ''): Promise<void> {
  await request(`/api/stories/${id}`, { method: 'PUT', body: JSON.stringify({ name, description }) })
}

export async function deleteStory(id: number): Promise<void> {
  await request(`/api/stories/${id}`, { method: 'DELETE' })
}
