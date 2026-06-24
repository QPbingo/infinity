import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SSEManager } from '../sse/manager'

// Mock EventSource for jsdom (which doesn't provide it).
class MockEventSource {
  static instances: MockEventSource[] = []
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSED = 2
  readyState = 0
  onmessage: ((e: { data: string }) => void) | null = null
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  url: string
  withCredentials: boolean
  constructor(url: string, options?: { withCredentials?: boolean }) {
    this.url = url
    this.withCredentials = options?.withCredentials ?? false
    MockEventSource.instances.push(this)
  }
  close() { this.readyState = 2 }
  // Helper to simulate the server pushing a data event.
  push(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) })
  }
}

describe('SSEManager', () => {
  let savedBC: typeof BroadcastChannel | undefined
  beforeEach(() => {
    MockEventSource.instances = []
    ;(globalThis as { EventSource?: unknown }).EventSource = MockEventSource
    // Force the single-tab (no BroadcastChannel) path so the manager becomes
    // leader immediately and opens an EventSource synchronously enough to test.
    savedBC = (globalThis as { BroadcastChannel?: typeof BroadcastChannel }).BroadcastChannel
    delete (globalThis as { BroadcastChannel?: typeof BroadcastChannel }).BroadcastChannel
  })
  afterEach(() => {
    vi.restoreAllMocks()
    if (savedBC) (globalThis as { BroadcastChannel?: typeof BroadcastChannel }).BroadcastChannel = savedBC
  })

  it('connects and dispatches events to handlers (SSE-F01)', async () => {
    const mgr = new SSEManager()
    const handler = vi.fn()
    mgr.on(handler)
    mgr.connect()
    // No BroadcastChannel in jsdom by default → becomes leader immediately.
    await new Promise((r) => setTimeout(r, 50))
    const es = MockEventSource.instances[0]
    expect(es).toBeDefined()
    es.push({ type: 'snapshot', sessions: [] })
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ type: 'snapshot' }))
    mgr.close()
  })

  it('withCredentials is true (cookie auth)', async () => {
    const mgr = new SSEManager()
    mgr.connect()
    await new Promise((r) => setTimeout(r, 50))
    expect(MockEventSource.instances[0].withCredentials).toBe(true)
    mgr.close()
  })

  it('closes EventSource on close()', async () => {
    const mgr = new SSEManager()
    mgr.connect()
    await new Promise((r) => setTimeout(r, 50))
    const es = MockEventSource.instances[0]
    mgr.close()
    expect(es.readyState).toBe(2)
  })

  it('dispatches auth-failure after 3 CLOSED errors (SSE-F03, constraint D, with retry)', async () => {
    const mgr = new SSEManager()
    const handler = vi.fn()
    mgr.on(handler)
    mgr.connect()
    await new Promise((r) => setTimeout(r, 50))
    const es = MockEventSource.instances[0]
    // First two CLOSED events should trigger retries, not auth failure.
    es.readyState = 2
    es.onerror?.()
    expect(handler).not.toHaveBeenCalled()
    es.onerror?.()
    expect(handler).not.toHaveBeenCalled()
    // Third CLOSED event Should dispatch auth failure.
    es.onerror?.()
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ __auth: true }))
    mgr.close()
  })
})
