import { login, register, logout, me } from '../api/auth'
import { authStore } from '../state/auth'
import { toast } from './toast'
import { onUnauthorized } from '../api/client'

// renderAuth draws the login/register overlay over the app shell.
export function renderAuth(mode: 'login' | 'register' = 'login'): void {
  const overlay = document.getElementById('auth-overlay')
  const app = document.getElementById('app')
  if (!overlay || !app) return
  app.classList.remove('is-ready')
  overlay.style.display = 'flex'
  overlay.innerHTML = authBoxHTML(mode)
  bindAuthForm(mode)
}

function authBoxHTML(mode: 'login' | 'register'): string {
  const isLogin = mode === 'login'
  return `<div class="auth-box">
    <h2>${isLogin ? 'Sign In' : 'Create Account'}</h2>
    <div class="error" id="auth-error" style="display:none"></div>
    <input type="text" id="auth-username" placeholder="Username" autocomplete="username" autofocus>
    <input type="password" id="auth-password" placeholder="Password" autocomplete="${isLogin ? 'current-password' : 'new-password'}">
    ${!isLogin ? '<input type="password" id="auth-password2" placeholder="Confirm password" autocomplete="new-password">' : ''}
    <button id="auth-submit">${isLogin ? 'Sign In' : 'Create Account'}</button>
    <div class="switch">
      ${isLogin ? 'Don\'t have an account? <a id="auth-toggle">Sign up</a>' : 'Already have an account? <a id="auth-toggle">Sign in</a>'}
    </div>
  </div>`
}

function bindAuthForm(mode: 'login' | 'register'): void {
  const toggle = document.getElementById('auth-toggle')
  if (toggle) toggle.onclick = () => renderAuth(mode === 'login' ? 'register' : 'login')
  const submit = document.getElementById('auth-submit')
  if (submit) {
    submit.onclick = () => (mode === 'login' ? doLogin() : doRegister())
    submit.onkeydown = (e) => { if (e.key === 'Enter') submit.click() }
  }
  // Enter submits on any input.
  const overlay = document.getElementById('auth-overlay')
  if (overlay) {
    overlay.onkeydown = (e) => {
      if (e.key === 'Enter') (document.getElementById('auth-submit') as HTMLButtonElement)?.click()
    }
  }
}

function showError(msg: string): void {
  const el = document.getElementById('auth-error')
  if (el) {
    el.textContent = msg
    el.style.display = 'block'
  }
}

async function doRegister(): Promise<void> {
  const username = (document.getElementById('auth-username') as HTMLInputElement)?.value.trim() ?? ''
  const password = (document.getElementById('auth-password') as HTMLInputElement)?.value
  const password2 = (document.getElementById('auth-password2') as HTMLInputElement)?.value
  if (!username || !password) { showError('Username and password required'); return }
  if (password !== password2) { showError('Passwords do not match'); return }
  try {
    const user = await register(username, password)
    authStore.setUser(user)
    showApp()
    toast.ok(`Welcome, ${user.username}`)
  } catch (e) {
    showError((e as Error).message || 'Registration failed')
  }
}

async function doLogin(): Promise<void> {
  const username = (document.getElementById('auth-username') as HTMLInputElement)?.value.trim() ?? ''
  const password = (document.getElementById('auth-password') as HTMLInputElement)?.value
  if (!username || !password) { showError('Username and password required'); return }
  try {
    const user = await login(username, password)
    authStore.setUser(user)
    showApp()
    toast.ok(`Welcome back, ${user.username}`)
  } catch (e) {
    showError((e as Error).message || 'Invalid credentials')
  }
}

export async function doLogout(): Promise<void> {
  try { await logout() } catch { /* cookie cleared best-effort */ }
  authStore.clear()
  renderAuth('login')
  toast.info('Signed out')
}

// showApp hides the auth overlay and reveals the main app shell.
export function showApp(): void {
  const overlay = document.getElementById('auth-overlay')
  const app = document.getElementById('app')
  if (overlay) overlay.style.display = 'none'
  if (app) app.classList.add('is-ready')
}

// restoreSession: on page load, ask the backend whether the cookie is still
// valid. If so, fetch the real username via /api/auth/me and enter the app
// directly (replaces the old `username: 'User'` placeholder hack).
export async function restoreSession(onReady: () => void): Promise<void> {
  const user = await me()
  if (user) {
    authStore.setUser(user)
    showApp()
  } else {
    renderAuth('login')
  }
  onReady()
}

// Wire the 401 bus: when api/client emits an unauthorized event (any web
// route returned 401), force logout + surface a toast so the user knows why
// their last action silently failed. Plugins call this once during bootstrap.
export function wireUnauthorizedAutoLogout(): void {
  onUnauthorized(() => {
    authStore.clear()
    renderAuth('login')
    toast.warn('Session expired — please sign in again')
  })
}