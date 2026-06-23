import { describe, it, expect } from 'vitest'
import { esc, trunc, formatTime, formatTimeAbsolute, formatPayload, formatPayloadDisplay } from './format'

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

  it('formatTime converts to relative time', () => {
    // Empty / falsy inputs never crash.
    expect(formatTime(0)).toBe('')
    expect(formatTime(null)).toBe('')
    expect(formatTime(undefined)).toBe('')
    // 10s ago in millis = "just now" (< 60s)
    const tenSecondsAgoMs = Date.now() - 10_000
    expect(formatTime(tenSecondsAgoMs)).toBe('just now')
    // 5 minutes ago → "5m ago"
    const fiveMinAgoMs = Date.now() - 5 * 60_000
    expect(formatTime(fiveMinAgoMs)).toMatch(/^\d+m ago$/)
    // 3 hours ago → "3h ago"
    const threeHoursAgoMs = Date.now() - 3 * 3_600_000
    expect(formatTime(threeHoursAgoMs)).toMatch(/^\d+h ago$/)
    // 5 days ago → "5d ago"
    const fiveDaysAgoMs = Date.now() - 5 * 86_400_000
    expect(formatTime(fiveDaysAgoMs)).toMatch(/^\d+d ago$/)
    // Distant past (> 30 days) → fall back to absolute date (Mon D)
    const old = Date.now() - 100 * 86_400_000
    expect(formatTime(old)).toMatch(/[A-Z][a-z]{2} \d{1,2}/)
    // Future timestamp shouldn't throw; it returns something parseable.
    expect(typeof formatTime(Date.now() + 1000)).toBe('string')
    // formatTimeAbsolute keeps the old absolute HH:MM:SS format regardless.
    expect(formatTimeAbsolute(Date.now())).toMatch(/\d{2}:\d{2}:\d{2}/)
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
