#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
# dev.sh — 同时管理前端 (Vite dev server) + 后端 (agent-monitor-daemon)
#
# 用法：
#   ./dev.sh start     # 启动前后端（后台运行）
#   ./dev.sh stop      # 停止前后端
#   ./dev.sh restart   # 重启前后端（保留数据）
#   ./dev.sh status    # 查看运行状态
#   ./dev.sh logs      # 实时跟踪前后端日志（Ctrl+C 退出）
#   ./dev.sh logs be|fe  # 只跟一条（backend / frontend）
#   ./dev.sh           # 等价 status
#
# 可选参数：
#   --build            start/restart 前先 make build，确保二进制最新
#   --listen=ADDR      后端监听地址（默认 127.0.0.1:9101）
#   --port=N           前端端口（默认 5173）
#
# PID 与日志文件在 /tmp/agent-monitor-dev/。
# 本脚本不重新注册 agent hooks；hooks 一次性 `make start` 即可，
# 之后日常开发迭代只用 ./dev.sh restart 即可，无需重装。
# ═══════════════════════════════════════════════════════════════════
set -euo pipefail

# ─── 配置 ───────────────────────────────────────────────────────────
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_DIR="/tmp/agent-monitor-dev"
BACKEND_PID_FILE="$PID_DIR/backend.pid"
FRONTEND_PID_FILE="$PID_DIR/frontend.pid"
BACKEND_LOG="$PID_DIR/backend.log"
FRONTEND_LOG="$PID_DIR/frontend.log"

LISTEN_ADDR="127.0.0.1:9101"
FRONTEND_PORT="5173"
DO_BUILD=0

# ─── 颜色 ───────────────────────────────────────────────────────────
if [ -t 1 ]; then
  C_RESET=$'\033[0m'; C_BOLD=$'\033[1m'
  C_GREEN=$'\033[32m'; C_RED=$'\033[31m'; C_YELLOW=$'\033[33m'; C_CYAN=$'\033[36m'; C_DIM=$'\033[2m'
else
  C_RESET=""; C_BOLD=""
  C_GREEN=""; C_RED=""; C_YELLOW=""; C_CYAN=""; C_DIM=""
fi

# ─── 工具 ───────────────────────────────────────────────────────────
err()  { echo "${C_RED}✗${C_RESET} $*" >&2; }
ok()   { echo "${C_GREEN}✓${C_RESET} $*"; }
warn() { echo "${C_YELLOW}!${C_RESET} $*"; }
info() { echo "${C_DIM}→${C_RESET} $*"; }

# pid_alive <pid-file>  返回 PID（数字）+ 0/退出
pid_alive() {
  local f="$1"
  [ -f "$f" ] || return 1
  local pid; pid="$(cat "$f" 2>/dev/null || true)"
  [ -n "$pid" ] || return 1
  if kill -0 "$pid" 2>/dev/null; then
    echo "$pid"
    return 0
  fi
  rm -f "$f"
  return 1
}

# kill_pid <pid> <name> 带 SIGTERM → 1s → SIGKILL 的优雅关闭
kill_pid() {
  local pid="$1" name="$2"
  if ! kill -0 "$pid" 2>/dev/null; then return 0; fi
  info "停止 $name (PID $pid) ..."
  kill -TERM "$pid" 2>/dev/null || true
  local i=0
  while [ $i -lt 20 ] && kill -0 "$pid" 2>/dev/null; do
    sleep 0.1
    i=$((i + 1))
  done
  if kill -0 "$pid" 2>/dev/null; then
    warn "$name 未响应 SIGTERM，发送 SIGKILL"
    kill -KILL "$pid" 2>/dev/null || true
    # 杀掉依附在该 PID 下的孤儿（尤其 npm package 的 vite children）
    pkill -KILL -P "$pid" 2>/dev/null || true
  fi
}

# ─── 构建检测 ──────────────────────────────────────────────────────
ensure_binary() {
  local bin="$ROOT/bin/agent-monitor-daemon"
  if [ ! -x "$bin" ] || [ "$DO_BUILD" = "1" ]; then
    info "构建 Go 二进制 ..."
    ( cd "$ROOT" && make build ) || { err "构建失败"; exit 1; }
  fi
}

ensure_frontend_deps() {
  if [ ! -d "$ROOT/web/frontend/node_modules" ]; then
    info "安装前端依赖 ..."
    ( cd "$ROOT/web/frontend" && npm install ) || { err "npm install 失败"; exit 1; }
  fi
}

# ─── 后端 ──────────────────────────────────────────────────────────
start_backend() {
  mkdir -p "$PID_DIR"
  if pid="$(pid_alive "$BACKEND_PID_FILE")"; then
    warn "后端已在运行 (PID $pid)，跳过"
    return 0
  fi
  local backend_port; backend_port="${LISTEN_ADDR##*:}"
  local holder; holder="$(lsof -nP -i tcp:"$backend_port" -sTCP:LISTEN 2>/dev/null | awk 'NR>1 {print $2; exit}')"
  if [ -n "$holder" ]; then
    err "端口 $backend_port 已被 PID $holder 占用（可能不是 dev.sh 启动的 daemon）"
    err "请先释放该端口再启动：kill $holder"
    return 1
  fi
  ensure_binary
  info "启动后端 daemon → $LISTEN_ADDR"
  nohup "$ROOT/bin/agent-monitor-daemon" --listen "$LISTEN_ADDR" \
    --cors-origins="http://localhost:$FRONTEND_PORT" \
    > "$BACKEND_LOG" 2>&1 &
  local pid=$!
  echo "$pid" > "$BACKEND_PID_FILE"
  sleep 0.6
  if kill -0 "$pid" 2>/dev/null; then
    ok "后端已启动 (PID $pid) → http://$LISTEN_ADDR"
  else
    err "后端启动失败；最近日志:"
    tail -20 "$BACKEND_LOG" >&2 || true
    rm -f "$BACKEND_PID_FILE"
    return 1
  fi
}

stop_backend() {
  if pid="$(pid_alive "$BACKEND_PID_FILE")"; then
    kill_pid "$pid" "后端"
    ok "后端已停止"
  else
    info "后端未运行"
  fi
  rm -f "$BACKEND_PID_FILE"
}

# ─── 前端 ──────────────────────────────────────────────────────────
# port_in_use <port> → 0/1，并回显占用 PID（若有）
port_in_use() {
  local port="$1"
  lsof -nP -i tcp:"$port" -sTCP:LISTEN 2>/dev/null | awk 'NR>1 {print $2; exit}'
  [ -n "$(lsof -nP -i tcp:"$port" -sTCP:LISTEN 2>/dev/null | tail -n +2)" ]
}

start_frontend() {
  mkdir -p "$PID_DIR"
  if pid="$(pid_alive "$FRONTEND_PID_FILE")"; then
    warn "前端已在运行 (PID $pid)，跳过"
    return 0
  fi
  # 端口被占但 PID 文件不指向它 → 拒绝启动，避免重复 vite 互抢。
  local holder; holder="$(lsof -nP -i tcp:"$FRONTEND_PORT" -sTCP:LISTEN 2>/dev/null | awk 'NR>1 {print $2; exit}')"
  if [ -n "$holder" ]; then
    err "端口 $FRONTEND_PORT 已被 PID $holder 占用（可能不是 dev.sh 启动的 vite）"
    err "请先释放该端口再启动：kill $holder"
    return 1
  fi
  ensure_frontend_deps
  local vite_bin="$ROOT/web/frontend/node_modules/.bin/vite"
  if [ ! -x "$vite_bin" ]; then
    err "找不到 vite 可执行：$vite_bin"
    return 1
  fi
  info "启动前端 vite → :$FRONTEND_PORT"
  # 用 pushd/popd 替代子 shell，直接拿 $! 写入 PID 文件，避免丢 PID。
  pushd "$ROOT/web/frontend" > /dev/null
  nohup "$vite_bin" dev \
    --port "$FRONTEND_PORT" --host 127.0.0.1 \
    > "$FRONTEND_LOG" 2>&1 &
  local pid=$!
  popd > /dev/null
  echo "$pid" > "$FRONTEND_PID_FILE"
  # 给 vite 1.5s 初始化（首次启动会扫描依赖）
  local i=0
  while [ $i -lt 15 ] && ! kill -0 "$pid" 2>/dev/null; do
    sleep 0.1
    i=$((i + 1))
  done
  if kill -0 "$pid" 2>/dev/null; then
    ok "前端已启动 (PID $pid) → http://localhost:$FRONTEND_PORT"
  else
    err "前端启动失败；最近日志:"
    tail -20 "$FRONTEND_LOG" >&2 || true
    rm -f "$FRONTEND_PID_FILE"
    return 1
  fi
}

stop_frontend() {
  if pid="$(pid_alive "$FRONTEND_PID_FILE")"; then
    kill_pid "$pid" "前端"
    ok "前端已停止"
  else
    info "前端未运行"
  fi
  rm -f "$FRONTEND_PID_FILE"
}

# ─── 顶层动作 ──────────────────────────────────────────────────────
do_start() {
  echo "${C_BOLD}启动前后端${C_RESET}"
  start_backend || exit 1
  start_frontend || { stop_backend; exit 1; }
  echo ""
  echo "  看板  : http://localhost:$FRONTEND_PORT"
  echo "  日志  : ./dev.sh logs"
  echo "  停止  : ./dev.sh stop"
}

do_stop() {
  echo "${C_BOLD}停止前后端${C_RESET}"
  stop_frontend
  stop_backend
}

do_restart() {
  echo "${C_BOLD}重启前后端${C_RESET}"
  stop_frontend
  stop_backend
  echo ""
  do_start
}

do_status() {
  echo "${C_BOLD}运行状态${C_RESET}"
  echo ""
  if pid="$(pid_alive "$BACKEND_PID_FILE")"; then
    echo "  ${C_GREEN}●${C_RESET} 后端 daemon  (PID $pid) → http://$LISTEN_ADDR"
  else
    echo "  ${C_RED}○${C_RESET} 后端 daemon  未运行"
  fi
  if pid="$(pid_alive "$FRONTEND_PID_FILE")"; then
    echo "  ${C_GREEN}●${C_RESET} 前端 vite    (PID $pid) → http://localhost:$FRONTEND_PORT"
  else
    echo "  ${C_RED}○${C_RESET} 前端 vite    未运行"
  fi
  # 顺便健康一下
  if pid="$(pid_alive "$BACKEND_PID_FILE")"; then
    local token="$HOME/.agent-monitor/local-token"
    if [ -f "$token" ]; then
      local resp; resp="$(curl --noproxy '*' -s -m 1 \
        -H "X-Daemon-Token: $(cat "$token")" \
        "http://$LISTEN_ADDR/health" 2>/dev/null || true)"
      [ -n "$resp" ] && echo "  ${C_DIM}health:${C_RESET} $resp"
    fi
  fi
}

do_logs() {
  local what="${1:-all}"
  case "$what" in
    be|backend)  exec tail -n 30 -f "$BACKEND_LOG" ;;
    fe|frontend) exec tail -n 30 -f "$FRONTEND_LOG" ;;
    all|"")     exec tail -n 30 -f "$BACKEND_LOG" "$FRONTEND_LOG" ;;
    *)          err "用法: ./dev.sh logs [be|fe|all]"; exit 1 ;;
  esac
}

do_help() {
  cat <<EOF
${C_BOLD}用法：${C_RESET} ./dev.sh <action> [options]

${C_BOLD}Actions：${C_RESET}
  start      启动前后端（后台运行）
  stop       停止前后端
  restart    重启前后端（保留数据）
  status     查看运行状态
  logs [filter]  跟踪日志：be / fe / all（默认 all）
  help       显示本帮助

${C_BOLD}Options（仅 start/restart 生效）：${C_RESET}
  --build            先 make build 再起后端
  --listen=ADDR      后端监听地址（默认 ${LISTEN_ADDR}）
  --port=N           前端端口（默认 ${FRONTEND_PORT}）

${C_BOLD}路径：${C_RESET}
  PID   ${PID_DIR}/{backend,frontend}.pid
  日志   ${BACKEND_LOG} / ${FRONTEND_LOG}
EOF
}

# ─── 参数解析 ──────────────────────────────────────────────────────
ACTION="status"
for arg in "$@"; do
  case "$arg" in
    --build)         DO_BUILD=1 ;;
    --listen=*)      LISTEN_ADDR="${arg#--listen=}" ;;
    --port=*)         FRONTEND_PORT="${arg#--port=}" ;;
    start|stop|restart|status|help)
      ACTION="$arg" ;;
    logs)
      ACTION="logs" ;;
    be|fe|all|backend|frontend)
      # 仅作为 logs 的子参数传入
      if [ "$ACTION" = "logs" ]; then
        LOG_FILTER="$arg"
      fi ;;
    -h|--help)
      ACTION="help" ;;
    *)
      err "未知参数：$arg"
      do_help
      exit 1 ;;
  esac
done

case "$ACTION" in
  start)   do_start ;;
  stop)    do_stop ;;
  restart) do_restart ;;
  status)  do_status ;;
  logs)    do_logs "${LOG_FILTER:-all}" ;;
  help)    do_help ;;
esac