import { describe, it, expect } from 'vitest'
import { esc, trunc, formatTime, formatPayload, formatPayloadDisplay } from './format'

describe('utils/format', () => {
  it('esc escapes HTML special chars', () => {
    expect(esc('<script>')).toBe('&lt;script&gt;')
    expect(esc('a&b')).toBe('a&amp;b')
    expect(esc(null)).toBe('')
    expect(esc(undefined)).toBe('')
    expect(esc(0)).toBe('0')
  })

  it('trunc truncates long strings', () => {
    expect(trunc('short', 10)).toBe('short')
    expect(trunc('a very long string', 5)).toBe('a ver...')
    expect(trunc('', 5)).toBe('-')
    expect(trunc(null, 5)).toBe('-')
  })

  it('formatTime formats milliseconds', () => {
    expect(formatTime(0)).toBe('')
    expect(formatTime(null)).toBe('')
    expect(formatTime(1718000000000)).toMatch(/\d{2}:\d{2}:\d{2}/)
  })

  it('formatPayload pretty-prints JSON', () => {
    expect(formatPayload(null)).toBe('')
    expect(formatPayload('null')).toBe('')
    expect(formatPayload('{"a":1}')).toBe('{\n  "a": 1\n}')
    expect(formatPayload({ b: 2 })).toBe('{\n  "b": 2\n}')
  })

  // TL-04: payload display strips sensitive fields (daemon_token, _role)
  it('formatPayloadDisplay strips daemon_token and _role (TL-04)', () => {
    const payload = { daemon_token: 'secret', _role: 'system', event: 'test', data: 'ok' }
    const result = formatPayloadDisplay(payload, 'test')
    expect(result).not.toContain('daemon_token')
    expect(result).not.toContain('secret')
    expect(result).not.toContain('_role')
    expect(result).toContain('data')
    expect(result).toContain('ok')
  })

  it('formatPayloadDisplay returns event name for null payload', () => {
    expect(formatPayloadDisplay(null, 'SomeEvent')).toBe('SomeEvent')
  })

  it('formatPayloadDisplay returns event name for "null" string', () => {
    expect(formatPayloadDisplay('null', 'SomeEvent')).toBe('SomeEvent')
  })

  it('formatPayloadDisplay handles string payload (parses JSON)', () => {
    const result = formatPayloadDisplay('{"daemon_token":"x","keep":"yes"}', 'evt')
    expect(result).not.toContain('daemon_token')
    expect(result).toContain('keep')
  })
})
