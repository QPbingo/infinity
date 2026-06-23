// Centralized configuration. API_BASE is empty in dev (Vite proxy serves
// /api/* from the same origin) and set to the daemon URL in production.
export const API_BASE = import.meta.env.VITE_API_BASE ?? ''
export const SSE_PATH = '/api/events/stream'
