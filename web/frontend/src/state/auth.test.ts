import { describe, it, expect } from 'vitest'
import { authStore } from '../state/auth'

describe('authStore', () => {
  it('setUser marks authed and notifies (AUTH-F01)', () => {
    let notified = 0
    const unsub = authStore.subscribe(() => { notified++ })
    authStore.setUser({ id: 1, username: 'alice', created_at: 0 })
    expect(authStore.authed).toBe(true)
    expect(authStore.user?.username).toBe('alice')
    expect(notified).toBeGreaterThan(0)
    unsub()
  })

  it('clear resets state and notifies (AUTH-F02)', () => {
    authStore.setUser({ id: 1, username: 'bob', created_at: 0 })
    let notified = 0
    authStore.subscribe(() => { notified++ })
    authStore.clear()
    expect(authStore.authed).toBe(false)
    expect(authStore.user).toBeNull()
    expect(notified).toBeGreaterThan(0)
  })
})
