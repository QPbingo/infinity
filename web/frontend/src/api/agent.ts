import { request } from './client'

export interface PromptResponse {
  exec_id: string
  session_id: string
  session_key?: string
}

// sendPrompt POSTs to the agent prompt endpoint and returns exec_id
// (constraint C). The actual message stream arrives via SSE (global
// broadcast), not this response.
export async function sendPrompt(
  agentType: string,
  sessionId: string,
  prompt: string,
  timeoutMinutes = 10,
  workspaceId?: number | null,
): Promise<PromptResponse> {
  return request<PromptResponse>(
    `/api/agent/${agentType}/sessions/${encodeURIComponent(sessionId)}/prompt`,
    {
      method: 'POST',
      body: JSON.stringify({
        prompt,
        session_id: sessionId,
        timeout_minutes: timeoutMinutes,
        workspace_id: workspaceId ?? undefined,
      }),
    },
  )
}

export async function cancelExecution(
  agentType: string,
  sessionId: string,
  execId?: string,
): Promise<void> {
  const q = execId ? `?exec_id=${encodeURIComponent(execId)}` : ''
  await request<void>(
    `/api/agent/${agentType}/sessions/${encodeURIComponent(sessionId)}/cancel${q}`,
    { method: 'POST' },
  )
}

// sendInput POSTs web input for a session (replaces the old WS send_input).
export async function sendInput(sessionKey: string, text: string): Promise<void> {
  await request<void>(`/api/sessions/${encodeURIComponent(sessionKey)}/input`, {
    method: 'POST',
    body: JSON.stringify({ text }),
  })
}
