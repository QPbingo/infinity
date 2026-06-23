import { API_BASE } from '../config'

// Toast module — a single global container in the corner of the viewport.
// Replaces ad-hoc inline `error` spans scattered across UI modules and the
// silent `catch { /* ignore */ }` pattern that swallowed all REST failures.
//
// Usage:
//   toast.error('Failed to send prompt')
//   toast.info('Reconnecting…')
//   toast.ok('Workspace created')

export type ToastKind = 'ok' | 'info' | 'warn' | 'error'

interface ToastEntry { id: number; el: HTMLDivElement; timer: ReturnType<typeof setTimeout> | null }

const container = ensureContainer()
let nextId = 1
const stack: ToastEntry[] = []

function ensureContainer(): HTMLDivElement | null {
  if (typeof document === 'undefined') return null
  let el = document.getElementById('toast-container') as HTMLDivElement | null
  if (el) return el
  el = document.createElement('div')
  el.id = 'toast-container'
  el.setAttribute('role', 'status')
  el.setAttribute('aria-live', 'polite')
  document.body.appendChild(el)
  return el
}

function push(kind: ToastKind, message: string, durationMs = 5000): void {
  if (!container) return
  const id = nextId++
  const el = document.createElement('div')
  el.className = `toast ${kind}`
  el.innerHTML = `<span class="toast-msg"></span><button class="toast-close" aria-label="Dismiss">×</button>`
  ;(el.querySelector('.toast-msg') as HTMLElement).textContent = message
  ;(el.querySelector('.toast-close') as HTMLElement).onclick = () => dismiss(id)
  container.appendChild(el)
  let timer: ReturnType<typeof setTimeout> | null = null
  if (durationMs > 0) timer = setTimeout(() => dismiss(id), durationMs)
  stack.push({ id, el, timer })
  // Cap stack height so toasts never overflow the viewport.
  if (stack.length > 5) {
    const oldest = stack.shift()
    if (oldest) {
      if (oldest.timer) clearTimeout(oldest.timer)
      oldest.el.remove()
    }
  }
}

function dismiss(id: number): void {
  const idx = stack.findIndex((t) => t.id === id)
  if (idx < 0) return
  const entry = stack[idx]
  stack.splice(idx, 1)
  if (entry.timer) clearTimeout(entry.timer)
  entry.el.style.opacity = '0'
  entry.el.style.transform = 'translateX(12px)'
  setTimeout(() => entry.el.remove(), 200)
}

export const toast = {
  ok:    (msg: string) => push('ok', msg,        4000),
  info:  (msg: string) => push('info', msg,     5000),
  warn:  (msg: string) => push('warn', msg,      0),
  error: (msg: string) => push('error', msg,     0),
  dismiss,
}

// Default network-failure hook: used by api/client when fetch throws.
export function notifyNetworkError(err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err)
  toast.error(`Network: ${msg}`)
}

// Re-export config symbol so this module's tree-shake keeps API_BASE reference.
void API_BASE