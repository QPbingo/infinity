// Agent Monitor — OpenCode Plugin
import { spawnSync } from "child_process";
import { readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export const AgentMonitorPlugin = async ({ client, directory }) => {
  const HOOK_BIN = "__HOOK_BIN_PATH__";
  const msgRoles = new Map();
  const startedSessions = new Set();
  let lastAssistantText = "";

  function send(fields) {
    try {
      spawnSync(HOOK_BIN,
        ["--agent-type", "opencode", "--event", fields.event, "--session-id", fields.session_id || ""],
        { input: JSON.stringify(fields), timeout: 5000 }
      );
    } catch {}
  }

  function ensureStarted(sid) {
    if (!startedSessions.has(sid)) {
      startedSessions.add(sid);
      send({ event: "SessionStart", session_id: sid, cwd: directory || "" });
    }
  }

  function readToken() {
    try {
      return readFileSync(join(homedir(), ".agent-monitor", "local-token"), "utf8").trim();
    } catch { return ""; }
  }

  // ── Poll daemon for web inputs ──
  let polling = false;
  async function pollInputs() {
    if (polling) return;
    const token = readToken();
    if (!token) return;
    polling = true;
    try {
      for (const sid of startedSessions) {
        const url = "http://127.0.0.1:9101/api/poll-input?agent_type=opencode&agent_session_id=" + encodeURIComponent(sid);
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 3000);
        let res;
        try {
          res = await fetch(url, { headers: { "X-Daemon-Token": token }, signal: ctrl.signal });
        } catch { clearTimeout(t); continue; }
        clearTimeout(t);
        if (res.status === 200) {
          const data = await res.json();
          if (data.text) {
            client.session.prompt({
              path: { id: sid },
              body: { parts: [{ type: "text", text: data.text }] }
            });
          }
        }
      }
    } catch {}
    polling = false;
  }
  setInterval(pollInputs, 1000);
  pollInputs();

  return {
    "event": async ({ event: ev }) => {
      const t = ev.type;
      const p = ev.properties || {};

      // ── session.created ──
      if (t === "session.created") {
        const id = p?.info?.id;
        if (!id) return;
        startedSessions.add(id);
        send({ event: "SessionStart", session_id: id, cwd: p.info.directory || directory || "" });
        return;
      }

      // ── session.idle → Stop ──
      if (t === "session.idle") {
        const id = p?.sessionID;
        if (id) {
          send({ event: "Stop", session_id: id, status: "idle", model_output: lastAssistantText || "" });
          lastAssistantText = "";
        }
        return;
      }

      // ── session.compacted ──
      if (t === "session.compacted") {
        const id = sid(p); if (id) send({ event: "SessionCompacted", session_id: id, trigger: p?.trigger || "auto", reason: p?.reason || "" }); return;
      }

      // ── session.deleted ──
      if (t === "session.deleted") {
        const id = sid(p); if (id) send({ event: "SessionDeleted", session_id: id }); return;
      }

      // ── session.diff ──
      if (t === "session.diff") {
        const id = sid(p); if (id) send({ event: "SessionDiff", session_id: id }); return;
      }

      // ── session.error ──
      if (t === "session.error") {
        const id = sid(p);
        if (id) send({ event: "SessionError", session_id: id, error: p?.error || "", message: p?.message || "" });
        return;
      }

      // ── session.status ──
      if (t === "session.status") {
        const id = sid(p); if (id) send({ event: "SessionStatus", session_id: id, status: p?.status || "" }); return;
      }

      // ── session.updated ──
      if (t === "session.updated") {
        const id = sid(p); if (id) send({ event: "SessionUpdated", session_id: id }); return;
      }

      // ── experimental.session.compacting ──
      if (t === "experimental.session.compacting") {
        const id = sid(p); if (id) send({ event: "ExperimentalSessionCompacting", session_id: id, trigger: "auto" }); return;
      }

      // ── message.updated → track role ──
      if (t === "message.updated") {
        const info = p?.info;
        if (info?.id && info?.sessionID) {
          msgRoles.set(info.id, { role: info.role, sessionID: info.sessionID });
        }
        send({ event: "MessageUpdated", session_id: info?.sessionID || "", role: info?.role || "", text: p?.text || "" });
        return;
      }

      // ── message.part.updated → text / tool ──
      if (t === "message.part.updated") {
        const part = p?.part;
        if (!part) return;

        if (part.type === "text" && part.messageID) {
          const meta = msgRoles.get(part.messageID);
          const text = part.text || "";
          if (!meta) {
            // Race: message.part.updated fired before message.updated.
            // Fall back to part/payload session detection.
            const fallbackSid = part.sessionID || p?.sessionID || "";
            if (fallbackSid && startedSessions.has(fallbackSid) && text) {
              send({ event: "AssistantText", session_id: fallbackSid, type: "A_result", text });
            }
            return;
          }
          if (meta.role === "user" && text) {
            ensureStarted(meta.sessionID);
            // Web-injected prompts already send UserPromptSubmit via manual send(),
            // but terminal-typed prompts need this path.
            send({ event: "UserPromptSubmit", session_id: meta.sessionID, prompt: text });
          } else if (meta.role === "assistant" && text) {
            ensureStarted(meta.sessionID);
            lastAssistantText = text;
            const isThinking = !!(part.isThinking || part.reasoning);
            send({
              event: "AssistantText",
              session_id: meta.sessionID,
              type: isThinking ? "A_thinking" : "A_result",
              text: text
            });
          }
          return;
        }

        if (part.type === "tool" && part.sessionID) {
          ensureStarted(part.sessionID);
          const st = part.state?.status;
          const tn = part.tool || "";
          if (st === "running" || st === "pending") {
            send({ event: "PreToolUse", session_id: part.sessionID, tool_name: tn, tool_input: part.state?.input || "" });
          } else if (st === "completed" || st === "error") {
            send({ event: "PostToolUse", session_id: part.sessionID, tool_name: tn, tool_output: part.state?.output || "", status: st });
          }
          return;
        }
        return;
      }

      // ── message.part.removed ──
      if (t === "message.part.removed") {
        const id = sid(p);
        if (id) send({ event: "MessagePartRemoved", session_id: id, part_id: p?.partID || "" });
        return;
      }

      // ── message.removed ──
      if (t === "message.removed") {
        const id = sid(p);
        if (id) send({ event: "MessageRemoved", session_id: id, message_id: p?.messageID || "" });
        return;
      }

      // ── tool.execute.before ──
      if (t === "tool.execute.before") {
        const id = sid(p);
        if (id) send({ event: "ToolExecuteBefore", session_id: id, tool: p?.tool || "", args: JSON.stringify(p?.args || {}) });
        return;
      }

      // ── tool.execute.after ──
      if (t === "tool.execute.after") {
        const id = sid(p);
        if (id) send({ event: "ToolExecuteAfter", session_id: id, tool: p?.tool || "", output: typeof p?.output === "string" ? p.output : JSON.stringify(p?.output || "") });
        return;
      }

      // ── command.executed ──
      if (t === "command.executed") {
        const id = sid(p);
        if (id) send({ event: "CommandExecuted", session_id: id, command: p?.command || "", cwd: p?.cwd || "" });
        return;
      }

      // ── permission.asked ──
      if (t === "permission.asked") {
        const id = sid(p);
        if (id) send({ event: "PermissionAsked", session_id: id, tool_name: p?.tool || "", message: p?.message || "" });
        return;
      }

      // ── permission.replied ──
      if (t === "permission.replied") {
        const id = sid(p);
        if (id) send({ event: "PermissionReplied", session_id: id, tool_name: p?.tool || "", decision: p?.decision || "", reason: p?.reason || "" });
        return;
      }

      // ── file.edited ──
      if (t === "file.edited") {
        const id = sid(p);
        if (id) send({ event: "FileEdited", session_id: id, filePath: p?.filePath || "", file_path: p?.filePath || "" });
        return;
      }

      // ── file.watcher.updated ──
      if (t === "file.watcher.updated") {
        const id = sid(p);
        if (id) send({ event: "FileWatcherUpdated", session_id: id, filePath: p?.filePath || "", file_path: p?.filePath || "" });
        return;
      }

      // ── lsp.client.diagnostics ──
      if (t === "lsp.client.diagnostics") {
        const id = sid(p);
        if (id) send({ event: "LspClientDiagnostics", session_id: id, filePath: p?.filePath || "", diagnostics: JSON.stringify(p?.diagnostics || []) });
        return;
      }

      // ── lsp.updated ──
      if (t === "lsp.updated") {
        const id = sid(p);
        if (id) send({ event: "LspUpdated", session_id: id, server: p?.server || "" });
        return;
      }

      // ── server.connected ──
      if (t === "server.connected") {
        const id = sid(p);
        if (id) send({ event: "ServerConnected", session_id: id });
        return;
      }

      // ── installation.updated ──
      if (t === "installation.updated") {
        send({ event: "InstallationUpdated", session_id: "" });
        return;
      }

      // ── shell.env ──
      if (t === "shell.env") {
        const id = sid(p);
        if (id) send({ event: "ShellEnv", session_id: id });
        return;
      }

      // ── todo.updated ──
      if (t === "todo.updated") {
        const id = sid(p);
        if (id) send({ event: "TodoUpdated", session_id: id, text: p?.text || "" });
        return;
      }

      // ── tui.prompt.append ──
      if (t === "tui.prompt.append") {
        const id = sid(p);
        if (id) send({ event: "TuiPromptAppend", session_id: id, text: p?.text || "" });
        return;
      }

      // ── tui.command.execute ──
      if (t === "tui.command.execute") {
        const id = sid(p);
        if (id) send({ event: "TuiCommandExecute", session_id: id, command: p?.command || "" });
        return;
      }

      // ── tui.toast.show ──
      if (t === "tui.toast.show") {
        const id = sid(p);
        if (id) send({ event: "TuiToastShow", session_id: id, text: p?.text || "", type: p?.type || "" });
        return;
      }
    },
  };
};
