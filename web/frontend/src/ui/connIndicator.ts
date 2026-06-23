// ConnectionIndicator — a small pill in #topbar that reflects the SSE manager's
// lifecycle (disconnected / connecting / connected). The indicator subscribes
// to status callbacks from SSEManager (one-way) so the UI never has to poll.

import { SSEStatus, sseStatusBus } from '../sse/manager'

let el: HTMLElement | null = null
let label: HTMLElement | null = null

const PHRASES: Record<SSEStatus, string> = {
  connected:    'Live',
  connecting:   'Connecting…',
  disconnected: 'Offline',
}

export function mountConnectionIndicator(host: HTMLElement): void {
  el = document.createElement('span')
  el.className = 'conn-indicator is-disconnected'
  el.title = 'Real-time stream status'
  el.innerHTML = '<span class="dot"></span><span class="conn-label">Offline</span>'
  host.appendChild(el)
  label = el.querySelector('.conn-label')
  sseStatusBus.subscribe(() => update(sseStatusBus.current()))
  update(sseStatusBus.current())
}

function update(status: SSEStatus): void {
  if (!el || !label) return
  el.classList.remove('is-connected', 'is-connecting', 'is-disconnected')
  el.classList.add(`is-${status}`)
  label.textContent = PHRASES[status]
  el.title = `Real-time stream: ${PHRASES[status]}`
}