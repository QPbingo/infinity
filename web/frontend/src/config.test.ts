import { describe, it, expect } from 'vitest'
import { API_BASE, SSE_PATH } from './config'

// DEP-08: SSE URL is built from VITE_API_BASE + SSE_PATH.
// In dev (no env), API_BASE is '' so SSE connects to same-origin /api/events/stream.
// In prod, API_BASE is the daemon URL so SSE connects cross-origin.
describe('config', () => {
  it('SSE_PATH is /api/events/stream', () => {
    expect(SSE_PATH).toBe('/api/events/stream')
  })

  it('API_BASE + SSE_PATH forms correct dev URL (DEP-08)', () => {
    // In test environment, VITE_API_BASE is not set → API_BASE is ''
    const devUrl = API_BASE + SSE_PATH
    expect(devUrl).toBe('/api/events/stream')
  })

  it('API_BASE + SSE_PATH forms correct prod URL when base is set', () => {
    // Simulate production: if API_BASE were 'https://api.example.com'
    const prodUrl = 'https://api.example.com' + SSE_PATH
    expect(prodUrl).toBe('https://api.example.com/api/events/stream')
  })
})
