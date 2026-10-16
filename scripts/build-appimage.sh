#!/usr/bin/env bash
# ============================================================
# Endfield Cloud Client - AppImage 打包脚本
# ============================================================
# 流程:
#   1. 自动生成图标(SVG → PNG,若未生成)
#   2. 调用 electron-builder 打包 Linux x64 AppImage
#
# 前置:已运行 ./scripts/install-deps-arch.sh
#
# 用法:
#   ./scripts/build-appimage.sh                  # 标准打包
#   ./scripts/build-appimage.sh --no-asar        # 不压缩 asar(便于调试)
#   ./scripts/build-appimage.sh --debug          # 调试模式(只出 unpacked 目录)
# ============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

SCRIPT_NAME=$(basename "$0")

if [[ -t 1 ]]; then
  GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
else
  GREEN=''; YELLOW=''; RED=''; NC=''
fi

log()   { echo -e "${GREEN}[$SCRIPT_NAME]${NC} $*"; }
warn()  { echo -e "${YELLOW}[$SCRIPT_NAME]${NC} $*"; }
error() { echo -e "${RED}[$SCRIPT_NAME]${NC} $*" >&2; exit 1; }

# ============================================================
# 参数解析
# ============================================================
NO_ASAR=false
DEBUG_MODE=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-asar) NO_ASAR=true; shift ;;
    --debug)   DEBUG_MODE=true; shift ;;
    -h|--help)
      echo "用法: $0 [--no-asar] [--debug]"
      exit 0
      ;;
    *) error "未知参数: $1";;
  esac
done

# ============================================================
# 检查前置
# ============================================================
command -v node &>/dev/null || error "找不到 node,请先运行 ./scripts/install-deps-arch.sh --dev"
command -v npm  &>/dev/null || error "找不到 npm,请先运行 ./scripts/install-deps-arch.sh --dev"

if [[ ! -d node_modules ]]; then
  warn "node_modules 不存在,正在安装..."
  npm install
fi

# ============================================================
# 检查 / 生成图标
# ============================================================
ensure_icons() {
  local NEED=false
  for size in 256 512; do
    if [[ ! -f "resources/icons/${size}x${size}.png" ]]; then
      NEED=true
      break
    fi
  done

  if [[ "$NEED" != true ]]; then
    log "图标 PNG 已存在,跳过生成。"
    return
  fi

  if [[ ! -f resources/icon.svg ]]; then
    error "找不到 resources/icon.svg,无法生成图标。"
  fi

  if ! command -v rsvg-convert &>/dev/null && ! command -v convert &>/dev/null; then
    error "找不到 rsvg-convert 或 convert,请安装 librsvg 或 imagemagick。"
  fi

  mkdir -p resources/icons
  log "生成 PNG 图标..."

  if command -v rsvg-convert &>/dev/null; then
    for size in 256 512 1024; do
      rsvg-convert -w "$size" -h "$size" resources/icon.svg \
        -o "resources/icons/${size}x${size}.png"
      log "  ${size}x${size}.png ✓"
    done
  else
    for size in 256 512 1024; do
      convert -background none -resize "${size}x${size}" \
        resources/icon.svg "resources/icons/${size}x${size}.png"
      log "  ${size}x${size}.png ✓"
    done
  fi
}

ensure_icons

# ============================================================
# electron-builder 调用
# ============================================================
BUILDER_ARGS=()

if [[ "$DEBUG_MODE" == true ]]; then
  BUILDER_ARGS+=(--dir)
  log "调试模式:只生成 unpacked 目录,不打包 AppImage。"
else
  BUILDER_ARGS+=(--linux AppImage --x64)
  log "打包目标:Linux x64 AppImage"
fi

if [[ "$NO_ASAR" == true ]]; then
  BUILDER_ARGS+=(--asar=false)
  warn "已禁用 asar 压缩(调试用)"
fi

log "开始打包..."
npx electron-builder "${BUILDER_ARGS[@]}"

# ============================================================
# 完成
# ============================================================
echo ""
log "打包完成!"
if [[ "$DEBUG_MODE" == true ]]; then
  log "产物目录:dist/linux-unpacked/"
  log "直接运行:./dist/linux-unpacked/endfield-cloud-client"
else
  appimage=$(ls -1t dist/*.AppImage 2>/dev/null | head -1 || echo "")
  if [[ -n "$appimage" ]]; then
    log "产物:$appimage"
    log "运行:./$appimage"
    log ""
    log "提示:首次运行前确保已执行 ./scripts/install-deps-arch.sh --runtime"
  else
    warn "未在 dist/ 找到 AppImage,检查上一步输出。"
  fi
fi
