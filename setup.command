#!/bin/bash

set -u

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR" || exit 1

echo "Agent 白皮书审阅助手：开始安装"
echo "安装过程不会启动或重启 WPS。"

pause_for_exit() {
  if [ -t 0 ]; then
    read -r -p "按回车退出..." _
  fi
}

# Finder-launched scripts receive a minimal PATH. Look in common per-user and
# system Node installations so an already-installed runtime is not reported
# as missing just because the shell profile was not loaded.
find_executable() {
  local name="$1"
  shift
  local resolved
  resolved="$(command -v "$name" 2>/dev/null || true)"
  if [ -n "$resolved" ] && [ -x "$resolved" ]; then
    printf '%s\n' "$resolved"
    return 0
  fi
  local candidate
  for candidate in "$@"; do
    if [ -x "$candidate" ]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

find_compatible_node() {
  local resolved candidate major
  resolved="$(command -v node 2>/dev/null || true)"
  for candidate in "$resolved" "$@"; do
    if [ -z "$candidate" ] || [ ! -x "$candidate" ]; then
      continue
    fi
    major="$("$candidate" -p 'process.versions.node.split(".")[0]' 2>/dev/null || printf '0')"
    case "$major" in
      ''|*[!0-9]*) continue ;;
    esac
    if [ "$major" -ge 20 ]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

# Keep the double-click entry point testable in an isolated directory/port.
# setup.mjs and doctor.mjs intentionally expose different names for the WPS
# config directory, so translate only the doctor arguments here.
SETUP_ARGS=("$@")
DOCTOR_ARGS=()
while [ "$#" -gt 0 ]; do
  case "$1" in
    --dir)
      if [ "$#" -ge 2 ]; then
        DOCTOR_ARGS+=(--jsaddons-dir "$2")
        shift 2
      else
        shift
      fi
      ;;
    --skill-target|--port)
      if [ "$#" -ge 2 ]; then
        DOCTOR_ARGS+=("$1" "$2")
        shift 2
      else
        shift
      fi
      ;;
    *)
      shift
      ;;
  esac
done

NODE_BIN="$(find_compatible_node \
  "$HOME/.volta/bin/node" \
  "$HOME/.local/share/mise/shims/node" \
  "$HOME/.asdf/shims/node" \
  "$HOME/.nvm/versions/node/"*/bin/node \
  /opt/homebrew/bin/node \
  /usr/local/bin/node || true)"
if [ -z "$NODE_BIN" ]; then
  echo "未找到 Node.js 20 或更高版本。请先安装 Node.js 20+，然后再次双击本文件。"
  pause_for_exit
  exit 1
fi

NODE_DIR="$(dirname "$NODE_BIN")"
if [ -x "$NODE_DIR/npm" ]; then
  NPM_BIN="$NODE_DIR/npm"
else
  NPM_BIN="$(find_executable npm \
    "$HOME/.volta/bin/npm" \
    "$HOME/.local/share/mise/shims/npm" \
    "$HOME/.asdf/shims/npm" \
    "$HOME/.nvm/versions/node/"*/bin/npm \
    /opt/homebrew/bin/npm \
    /usr/local/bin/npm || true)"
fi
if [ -z "$NPM_BIN" ]; then
  echo "未找到 npm。请安装包含 npm 的 Node.js 20+，然后再次双击本文件。"
  pause_for_exit
  exit 1
fi

export PATH="$NODE_DIR:$PATH"

run_setup() {
  if [ "${#SETUP_ARGS[@]}" -gt 0 ]; then
    "$NPM_BIN" run setup -- "${SETUP_ARGS[@]}"
  else
    "$NPM_BIN" run setup
  fi
}

run_doctor() {
  if [ "${#DOCTOR_ARGS[@]}" -gt 0 ]; then
    "$NPM_BIN" run doctor -- "${DOCTOR_ARGS[@]}"
  else
    "$NPM_BIN" run doctor
  fi
}

NODE_MAJOR="$("$NODE_BIN" -p 'process.versions.node.split(".")[0]' 2>/dev/null || printf '0')"
if [ "$NODE_MAJOR" -lt 20 ] 2>/dev/null; then
  echo "当前 Node.js 版本不足 20：$("$NODE_BIN" --version 2>/dev/null || printf 'unknown')"
  echo "请升级 Node.js 20+，然后再次双击本文件。"
  pause_for_exit
  exit 1
fi

if ! run_setup; then
  echo "安装失败。请复制上方错误信息，或运行 npm run doctor 获取诊断。"
  pause_for_exit
  exit 1
fi

echo "安装完成，正在执行健康检查。"
if run_doctor; then
  echo "健康检查通过。现在可以打开 WPS，并让 Agent 调用 whitepaper-chief-editor。"
  echo "如果 WPS 中没有出现 Agent 审阅，请在允许的窗口重启 WPS。"
  pause_for_exit
  exit 0
fi

echo "安装已完成，但健康检查未通过。请根据上方 nextSteps 处理后再次运行 npm run doctor。"
pause_for_exit
exit 1
