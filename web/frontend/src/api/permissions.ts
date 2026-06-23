import { request, type User } from './client'

export interface Permission {
  user_id: number
  level: number
}

export async function listPermissions(type: 'workspace' | 'project', id: number): Promise<Permission[]> {
  return request<Permission[]>(`/api/permissions/${type}/${id}`)
}

export async function setPermission(type: 'workspace' | 'project', id: number, userId: number, level: number): Promise<void> {
  await request(`/api/permissions/${type}/${id}`, { method: 'PUT', body: JSON.stringify({ user_id: userId, level }) })
}

export async function removePermission(type: 'workspace' | 'project', id: number, userId: number): Promise<void> {
  await request(`/api/permissions/${type}/${id}/${userId}`, { method: 'DELETE' })
}

export async function listUsers(): Promise<User[]> {
  return request<User[]>('/api/users')
}
