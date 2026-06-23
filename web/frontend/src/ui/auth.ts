import { login, register, logout, isAuthed } from '../api/auth'
import { authStore } from '../state/auth'

// Render the auth overlay (login/register). Replaces dashboard.html's
// renderAuth/doLogin/doRegister.
export function renderAuth(mode: 'login' | 'register' = 'login'): void {
  const overlay = document.getElementById('auth-overlay')
  const app = document.getElementById('app')
  if (!overlay || !app) return
  app.style.display = 'none'
  overlay.style.display = 'flex'
  overlay.innerHTML = authBoxHTML(mode)
  bindAuthForm(mode)
}

function authBoxHTML(mode: 'login' | 'register'): string {
  const isLogin = mode === 'login'
  return `<div class="auth-box">
    <h2>${isLogin ? 'Sign In' : 'Create Account'}</h2>
    <div class="error" id="auth-error" style="display:none"></div>
    <input type="text" id="auth-username" placeholder="Username" autocomplete="username">
    <input type="password" id="auth-password" placeholder="Password" autocomplete="${isLogin ? 'current-password' : 'new-password'}">
    ${!isLogin ? '<input type="password" id="auth-password2" placeholder="Confirm password">' : ''}
    <button id="auth-submit">${isLogin ? 'Sign In' : 'Create Account'}</button>
    <div class="switch">
      ${isLogin ? 'Don\'t have an account? <a id="auth-toggle">Sign up</a>' : 'Already have an account? <a id="auth-toggle">Sign in</a>'}
    </div>
  </div>`
}

function bindAuthForm(mode: 'login' | 'register'): void {
  const toggle = document.getElementById('auth-toggle')
  if (toggle) {
    toggle.onclick = () => renderAuth(mode === 'login' ? 'register' : 'login')
  }
  const submit = document.getElementById('auth-submit')
  if (submit) submit.onclick = () => (mode === 'login' ? doLogin() : doRegister())
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
  } catch (e) {
    showError((e as Error).message || 'Invalid credentials')
  }
}

export async function doLogout(): Promise<void> {
  try {
    await logout()
  } catch {
    // ignore — cookie cleared server-side best-effort
  }
  authStore.clear()
  renderAuth('login')
}

// showApp hides the auth overlay and reveals the main app shell.
export function showApp(): void {
  const overlay = document.getElementById('auth-overlay')
  const app = document.getElementById('app')
  if (overlay) overlay.style.display = 'none'
  if (app) app.style.display = 'flex'
  const name = document.getElementById('user-name')
  if (name && authStore.user) name.textContent = authStore.user.username
}

// restoreSession: on page load, check if the cookie is still valid. If so,
// enter the app directly (AUTH-16). The username isn't recoverable from the
// API alone, so we show "User" until re-login. This avoids forcing a login on
// every refresh while the cookie is valid.
export async function restoreSession(onReady: () => void): Promise<void> {
  const authed = await isAuthed()
  if (authed) {
    authStore.setUser({ id: 0, username: 'User', created_at: 0 })
    showApp()
  } else {
    renderAuth('login')
  }
  onReady()
}
