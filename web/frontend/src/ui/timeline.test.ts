import { beforeEach, describe, expect, it } from 'vitest'
import { bindTimelineHandlers, renderTimeline } from './timeline'
import { sessionsStore } from '../state/sessions'

describe('renderTimeline', () => {
  beforeEach(() => {
    sessionsStore.expandedTurns = {}
    sessionsStore.expandedToolGroups = {}
    sessionsStore.expandedPayloads = {}
  })

  it('renders non-tool event payloads so model thinking and assistant text are visible', () => {
    const html = renderTimeline([
      {
        turn_idx: 0,
        user_input: 'question',
        user_ts: 1000,
        entries: [
          { event: 'ReasoningPart', ts: 1100, payload: { text: 'thinking content' } },
          { event: 'AssistantText', ts: 1200, payload: { text: 'final answer' } },
        ],
      },
    ], 'session-1')

    expect(html).toContain('ReasoningPart')
    expect(html).toContain('thinking content')
    expect(html).toContain('AssistantText')
    expect(html).toContain('final answer')
  })

  it('marks final model result entries inside the turn', () => {
    const html = renderTimeline([
      {
        turn_idx: 0,
        user_input: 'question',
        user_ts: 1000,
        entries: [
          { event: 'SDKMessage', ts: 1200, payload: { type: 'result', content: 'final result', is_final: true } },
        ],
      },
    ], 'session-1')

    expect(html).toContain('final result')
    expect(html).toContain('Final')
  })

  it('lets non-tool event payloads collapse and expand from their header', () => {
    document.body.innerHTML = `<div id="session-detail-panel">${renderTimeline([
      {
        turn_idx: 0,
        user_input: 'question',
        user_ts: 1000,
        entries: [
          { event: 'AssistantText', ts: 1200, payload: { text: 'answer' } },
        ],
      },
    ], 'session-1')}</div>`

    const header = document.querySelector<HTMLElement>('[data-action="toggle-entry"]')
    expect(header).not.toBeNull()
    expect(sessionsStore.expandedPayloads['session-1_0_0']).toBe(false)

    bindTimelineHandlers()
    header!.click()

    expect(sessionsStore.expandedPayloads['session-1_0_0']).toBe(true)
  })

  it('defaults event payloads and tool details to collapsed', () => {
    const html = renderTimeline([
      {
        turn_idx: 0,
        user_input: 'question',
        user_ts: 1000,
        entries: [
          { event: 'AssistantText', ts: 1200, payload: { text: 'answer' } },
          {
            event: 'PreToolUse',
            start_ts: 1300,
            payload: { tool_name: 'Read' },
            tools: [{ name: 'Read', input: '/tmp/a', output: 'content', status: 'completed', start_ts: 1300, end_ts: 1400 }],
          },
        ],
      },
    ], 'session-1')

    expect(html).toContain('timeline-event-payload')
    expect(html).not.toContain('timeline-event-payload open')
    expect(html).toContain('tool-detail')
    expect(html).not.toContain('tool-detail open')
  })

  it('adds visual category classes for timeline events', () => {
    const html = renderTimeline([
      {
        turn_idx: 0,
        user_input: 'question',
        user_ts: 1000,
        entries: [
          { event: 'ReasoningPart', ts: 1100, payload: { text: 'thinking' } },
          { event: 'AssistantText', ts: 1200, payload: { text: 'answer' } },
          { event: 'Stop', ts: 1300, payload: { last_assistant_message: 'done' } },
        ],
      },
    ], 'session-1')

    expect(html).toContain('event-reasoning')
    expect(html).toContain('event-assistant')
    expect(html).toContain('event-final')
    expect(html).toContain('is-final')
    expect(html).toContain('aria-expanded="false"')
  })
})
