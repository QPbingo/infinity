// OpenCode hook registration: installs a JS plugin at ~/.config/opencode/plugins/
// that uses the official "event" handler API to capture session/tool/user events.
package installer

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const opencodePluginFile = "agent-monitor.js"
const opencodeManifestFile = "agent-monitor-opencode-plugin.json"

const opencodePluginCode = `// Agent Monitor — OpenCode Plugin
import { spawnSync } from "child_process";

export const AgentMonitorPlugin = async ({ directory }) => {
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

  return {
    // Unified event handler (official API — see notification example in docs)
    "event": async ({ event: ev }) => {
      const t = ev.type;
      const p = ev.properties || {};

      // ── session.created ──
      if (t === "session.created") {
        const sid = p?.info?.id;
        if (!sid) return;
        startedSessions.add(sid);
        send({ event: "SessionStart", session_id: sid, cwd: p.info.directory || directory || "" });
        return;
      }

      // ── session.idle → Stop ──
      if (t === "session.idle") {
        const sid = p?.sessionID;
        if (sid) {
          send({ event: "Stop", session_id: sid, status: "idle", model_output: lastAssistantText || "" });
          lastAssistantText = "";
        }
        return;
      }

      // ── message.updated → track role ──
      if (t === "message.updated") {
        const info = p?.info;
        if (info?.id && info?.sessionID) {
          msgRoles.set(info.id, { role: info.role, sessionID: info.sessionID });
        }
        return;
      }

      // ── message.part.updated → text / tool ──
      if (t === "message.part.updated") {
        const part = p?.part;
        if (!part) return;

        // Text part: user prompt or assistant output
        if (part.type === "text" && part.messageID) {
          const meta = msgRoles.get(part.messageID);
          if (!meta) return;
          const text = part.text || "";
          if (meta.role === "user" && text) {
            ensureStarted(meta.sessionID);
            send({ event: "UserPromptSubmit", session_id: meta.sessionID, prompt: text });
          } else if (meta.role === "assistant" && text) {
            ensureStarted(meta.sessionID);
            lastAssistantText = text;
          }
          return;
        }

        // Tool part: PreToolUse / PostToolUse
        if (part.type === "tool" && part.sessionID) {
          ensureStarted(part.sessionID);
          const st = part.state?.status;
          const tn = part.tool || "";
          if (st === "running" || st === "pending") {
            send({ event: "PreToolUse", session_id: part.sessionID, tool_name: tn, tool_input: part.state?.input || "" });
          } else if (st === "completed" || st === "error") {
            send({ event: "PostToolUse", session_id: part.sessionID, tool_name: tn, tool_output: part.state?.output || "" });
          }
          return;
        }
        return;
      }
    },
  };
};
`

type OpenCodeInstaller struct{}

func NewOpenCodeInstaller() *OpenCodeInstaller { return &OpenCodeInstaller{} }

func (o *OpenCodeInstaller) Name() string { return "OpenCode" }

func (o *OpenCodeInstaller) Detect() bool {
	dir := o.configDir()
	if _, err := os.Stat(dir); err != nil {
		return false
	}
	_, err := os.Stat(filepath.Join(dir, "config.json"))
	return err == nil
}

func (o *OpenCodeInstaller) IsInstalled() (bool, error) {
	m := readManifest(o.configDir(), opencodeManifestFile)
	return m != nil, nil
}

func (o *OpenCodeInstaller) Install(hookBinPath string) error {
	if hookBinPath == "" {
		hookBinPath = FindHookBin()
	}

	dir := o.configDir()
	pluginsDir := filepath.Join(dir, "plugins")
	pluginPath := filepath.Join(pluginsDir, opencodePluginFile)

	if err := os.MkdirAll(pluginsDir, 0755); err != nil {
		return fmt.Errorf("create plugins dir: %w", err)
	}

	code := strings.ReplaceAll(opencodePluginCode, "__HOOK_BIN_PATH__", hookBinPath)
	if err := os.WriteFile(pluginPath, []byte(code), 0644); err != nil {
		return fmt.Errorf("write plugin: %w", err)
	}

	if err := o.registerPlugin(dir, pluginPath); err != nil {
		return fmt.Errorf("register plugin: %w", err)
	}

	return writeManifest(dir, opencodeManifestFile, &Manifest{
		Agent:       "opencode",
		HookCommand: pluginPath,
		InstalledAt: nowISO(),
	})
}

func (o *OpenCodeInstaller) Uninstall() error {
	dir := o.configDir()

	pluginPath := filepath.Join(dir, "plugins", opencodePluginFile)
	os.Remove(pluginPath)

	if err := o.unregisterPlugin(dir, pluginPath); err != nil {
		return fmt.Errorf("unregister plugin: %w", err)
	}

	removeManifest(dir, opencodeManifestFile)
	return nil
}

func (o *OpenCodeInstaller) Status() string {
	dir := o.configDir()
	m := readManifest(dir, opencodeManifestFile)
	if m == nil {
		return "not installed"
	}
	return fmt.Sprintf("installed (%s)", m.InstalledAt)
}

func (o *OpenCodeInstaller) configDir() string {
	if d := os.Getenv("OPENCODE_CONFIG_DIR"); d != "" {
		return d
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".config", "opencode")
}

func (o *OpenCodeInstaller) registerPlugin(dir, pluginPath string) error {
	configPath := filepath.Join(dir, "config.json")

	if err := backupFile(configPath); err != nil {
		return err
	}

	config := o.readConfig(configPath)
	plugins, _ := config["plugin"].([]interface{})

	pluginURI := "file://" + pluginPath
	for _, p := range plugins {
		if s, ok := p.(string); ok && (s == pluginURI || strings.HasSuffix(s, "/"+opencodePluginFile)) {
			return nil
		}
	}

	config["plugin"] = append(plugins, pluginURI)

	data, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(configPath, data, 0644)
}

func (o *OpenCodeInstaller) unregisterPlugin(dir, pluginPath string) error {
	configPath := filepath.Join(dir, "config.json")

	if err := backupFile(configPath); err != nil {
		return err
	}

	config := o.readConfig(configPath)
	plugins, _ := config["plugin"].([]interface{})

	var kept []interface{}
	for _, p := range plugins {
		s, ok := p.(string)
		if !ok {
			kept = append(kept, p)
			continue
		}
		if strings.HasSuffix(s, "/"+opencodePluginFile) || s == "file://"+pluginPath {
			continue
		}
		kept = append(kept, p)
	}

	if len(kept) == 0 {
		delete(config, "plugin")
	} else {
		config["plugin"] = kept
	}

	data, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(configPath, data, 0644)
}

func (o *OpenCodeInstaller) readConfig(path string) map[string]interface{} {
	data, err := os.ReadFile(path)
	if err != nil {
		return make(map[string]interface{})
	}
	var config map[string]interface{}
	if err := json.Unmarshal(data, &config); err != nil {
		return make(map[string]interface{})
	}
	return config
}
