#!/bin/bash

set -euo pipefail

REPOSITORY="${AGENT_WPS_REPOSITORY:-ismailaolveira-crypto/agent-wps-reviewer}"
INSTALL_ROOT="${AGENT_WPS_INSTALL_ROOT:-$HOME/Applications/Agent WPS Reviewer}"
FETCHER_API="https://api.github.com/repos/$REPOSITORY/contents/scripts/download-latest-release.mjs?ref=main"

pause_for_exit() {
  if [ -t 0 ]; then
    read -r -p "按回车退出..." _
  fi
}

fail() {
  echo "安装失败：$1" >&2
  pause_for_exit
  exit 1
}

find_compatible_node() {
  local resolved candidate major
  resolved="$(command -v node 2>/dev/null || true)"
  for candidate in \
    "$resolved" \
    "$HOME/.volta/bin/node" \
    "$HOME/.local/share/mise/shims/node" \
    "$HOME/.asdf/shims/node" \
    "$HOME/.nvm/versions/node/"*/bin/node \
    /opt/homebrew/bin/node \
    /usr/local/bin/node; do
    if [ -z "$candidate" ] || [ ! -x "$candidate" ]; then
      continue
    fi
    major="$("$candidate" -p 'process.versions.node.split(".")[0]' 2>/dev/null || printf '0')"
    case "$major" in ''|*[!0-9]*) continue ;; esac
    if [ "$major" -ge 20 ]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

NODE_BIN="$(find_compatible_node || true)"
[ -n "$NODE_BIN" ] || fail "需要先安装 Node.js 20 或更高版本。"
command -v curl >/dev/null 2>&1 || fail "系统缺少 curl。"
command -v unzip >/dev/null 2>&1 || fail "系统缺少 unzip。"

mkdir -p "$INSTALL_ROOT"
INSTALL_ROOT="$(cd "$INSTALL_ROOT" && pwd)"
FETCHER_TEMP=false
if [ -n "${AGENT_WPS_FETCHER_PATH:-}" ]; then
  FETCHER="$AGENT_WPS_FETCHER_PATH"
else
  FETCHER="$(mktemp /tmp/agent-wps-download.XXXXXX.mjs)"
  FETCHER_TEMP=true
  curl -fsSL \
    -H 'Accept: application/vnd.github.raw+json' \
    -H 'User-Agent: agent-wps-reviewer-bootstrap' \
    "$FETCHER_API" -o "$FETCHER" || fail "无法下载公开安装器。"
fi

cleanup() {
  if [ "$FETCHER_TEMP" = true ]; then
    rm -f "$FETCHER"
  fi
}
trap cleanup EXIT

echo "正在从 GitHub 下载并校验 Agent 白皮书审阅助手……"
RESULT="$("$NODE_BIN" "$FETCHER" --platform macos --dir "$INSTALL_ROOT/downloads" --repo "$REPOSITORY")" || fail "Release 下载或 SHA-256 校验失败。"
ZIP_PATH="$(printf '%s' "$RESULT" | "$NODE_BIN" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).zipPath))')"
TAG="$(printf '%s' "$RESULT" | "$NODE_BIN" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).tag))')"
SHA256="$(printf '%s' "$RESULT" | "$NODE_BIN" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).sha256))')"

case "$ZIP_PATH" in "$INSTALL_ROOT"/*) ;; *) fail "下载文件不在受控安装目录。" ;; esac
RELEASE_DIR="$(dirname "$ZIP_PATH")"
unzip -oq "$ZIP_PATH" -d "$RELEASE_DIR" || fail "无法解压下载包。"
[ -f "$RELEASE_DIR/setup.command" ] || fail "下载包缺少 setup.command。"

SETUP_ARGS=()
if [ -n "${AGENT_WPS_SETUP_DIR:-}" ]; then SETUP_ARGS+=(--dir "$AGENT_WPS_SETUP_DIR"); fi
if [ -n "${AGENT_WPS_SKILL_TARGET:-}" ]; then SETUP_ARGS+=(--skill-target "$AGENT_WPS_SKILL_TARGET"); fi
if [ -n "${AGENT_WPS_PORT:-}" ]; then SETUP_ARGS+=(--port "$AGENT_WPS_PORT"); fi

echo "校验通过：$TAG / $SHA256"
if [ "${#SETUP_ARGS[@]}" -gt 0 ]; then
  bash "$RELEASE_DIR/setup.command" "${SETUP_ARGS[@]}" || fail "统一安装器未通过，请保留上方诊断信息。"
else
  bash "$RELEASE_DIR/setup.command" || fail "统一安装器未通过，请保留上方诊断信息。"
fi
echo "一键安装完成。已配置本机检测到的 Codex、Claude Code 或 WorkBuddy；现在打开 WPS 的“Agent 审阅”。"
pause_for_exit
