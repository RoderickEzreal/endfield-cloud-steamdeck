#!/usr/bin/env bash
# ============================================================
# Endfield Cloud Client - Arch Linux 前置依赖安装
# ============================================================
# 适用平台:
#   - Steam Deck 原生 SteamOS 3.x (Arch 系)
#   - 任意 Arch Linux / Manjaro
#
# 安装内容:
#   - 系统运行时:Chromium 内核、GPU/Vulkan 加速、VA-API 视频解码、声卡
#   - 开发工具:Node.js + npm + electron-builder
#   - 打包工具:librsvg(ImageMagick 可选)
#
# 用法:
#   ./scripts/install-deps-arch.sh            # 安装全部
#   ./scripts/install-deps-arch.sh --runtime  # 仅运行时依赖
#   ./scripts/install-deps-arch.sh --dev      # 仅开发/打包依赖
# ============================================================

set -euo pipefail

SCRIPT_NAME=$(basename "$0")
STEAM_USER="${SUDO_USER:-$(logname 2>/dev/null || echo 'deck')}"

# 颜色输出(只在 TTY 启用)
if [[ -t 1 ]]; then
  RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
else
  RED=''; GREEN=''; YELLOW=''; NC=''
fi

log()   { echo -e "${GREEN}[$SCRIPT_NAME]${NC} $*"; }
warn()  { echo -e "${YELLOW}[$SCRIPT_NAME]${NC} $*"; }
error() { echo -e "${RED}[$SCRIPT_NAME]${NC} $*" >&2; exit 1; }

# ============================================================
# 检测
# ============================================================
detect_distro() {
  if [[ -f /etc/os-release ]]; then
    . /etc/os-release
    echo "$ID"
  else
    echo "unknown"
  fi
}

is_steamdeck() {
  [[ -f /etc/os-release ]] && grep -qi "steamdeck\|steamos" /etc/os-release
}

has_yay()    { command -v yay    &>/dev/null; }
has_paru()   { command -v paru   &>/dev/null; }
has_pacman() { command -v pacman &>/dev/null; }

# ============================================================
# 包安装工具
# ============================================================
PKG_MGR=""
PKG_INSTALL=""

init_pkg_mgr() {
  if has_pacman; then
    PKG_MGR="pacman"
    PKG_INSTALL="sudo pacman -S --needed --noconfirm"
  elif has_paru; then
    PKG_MGR="paru"
    PKG_INSTALL="paru -S --needed --noconfirm"
  elif has_yay; then
    PKG_MGR="yay"
    PKG_INSTALL="yay -S --needed --noconfirm"
  else
    error "找不到 pacman / paru / yay。请先在 Arch 系发行版上安装 pacman。"
  fi
}

# ============================================================
# 安装分组
# ============================================================
install_runtime() {
  log "安装运行时依赖(Chromium 内核 + GPU + 手柄)..."
  $PKG_INSTALL \
    nss \
    gtk3 \
    libxss \
    libasound \
    libnotify \
    libxrandr \
    libxcomposite \
    libxdamage \
    libxfixes \
    libxkbcommon \
    libgbm \
    mesa \
    mesa-vdpau \
    libva \
    libva-utils \
    vulkan-radeon \
    vulkan-icd-loader \
    libvulkan \
    libevdev \
    udev
  log "运行时依赖安装完成。"
}

install_dev() {
  log "安装开发/打包工具(Node.js + electron-builder + 图标工具)..."
  $PKG_INSTALL \
    nodejs \
    npm \
    git \
    base-devel \
    libarchive \
    librsvg \
    imagemagick
  log "开发工具安装完成。"
}

install_npm_deps() {
  log "安装 npm 依赖(Electron + electron-builder)..."
  cd "$(dirname "$0")/.."
  if [[ ! -f package.json ]]; then
    error "找不到 package.json,当前目录 $(pwd) 不是项目根目录。"
  fi
  npm install
  log "npm 依赖安装完成。"
}

# ============================================================
# udev 规则 — 让当前用户能直接访问手柄设备
# ============================================================
setup_udev_rules() {
  log "配置 udev 规则,允许访问手柄设备..."

  local RULE_FILE="/etc/udev/rules.d/99-endfield-cloud-gamepad.rules"
  local RULE_CONTENT='# Endfield Cloud Client - 手柄访问权限
KERNEL=="event*", SUBSYSTEM=="input", GROUP="input", MODE="0660"
KERNEL=="js*",     SUBSYSTEM=="input", GROUP="input", MODE="0660"
KERNELS=="input*",  SUBSYSTEM=="input", GROUP="input", MODE="0660"'

  if [[ -f "$RULE_FILE" ]] && [[ "$(cat "$RULE_FILE")" == "$RULE_CONTENT" ]]; then
    log "udev 规则已存在,跳过。"
    return
  fi

  echo "$RULE_CONTENT" | sudo tee "$RULE_FILE" >/dev/null
  sudo udevadm control --reload-rules
  sudo udevadm trigger
  log "udev 规则已写入 $RULE_FILE"
}

# ============================================================
# Steam Deck 特定:确保用户已加入 input 组
# ============================================================
setup_user_groups() {
  if ! id -nG "$STEAM_USER" 2>/dev/null | grep -qw "input"; then
    warn "用户 $STEAM_USER 不在 input 组中,正在添加..."
    sudo usermod -aG input "$STEAM_USER" || warn "添加失败,请手动: sudo usermod -aG input $STEAM_USER"
    warn "添加后需要重新登录才能生效。"
  else
    log "用户 $STEAM_USER 已在 input 组。"
  fi
}

# ============================================================
# 主流程
# ============================================================
main() {
  local DO_RUNTIME=false
  local DO_DEV=false
  local DO_NPM=false
  local DO_UDEV=false

  if [[ $# -eq 0 ]]; then
    DO_RUNTIME=true; DO_DEV=true; DO_NPM=true; DO_UDEV=true
  fi

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --runtime) DO_RUNTIME=true; shift ;;
      --dev)     DO_DEV=true;     shift ;;
      --npm)     DO_NPM=true;     shift ;;
      --udev)    DO_UDEV=true;    shift ;;
      -h|--help)
        echo "用法: $0 [--runtime] [--dev] [--npm] [--udev]"
        echo "  无参数 = 安装全部"
        echo "  --runtime  运行时依赖(Chromium + GPU + 手柄)"
        echo "  --dev      开发/打包工具"
        echo "  --npm      仅 npm install"
        echo "  --udev     仅配置 udev 规则 + 用户组"
        exit 0
        ;;
      *) error "未知参数: $1";;
    esac
  done

  local distro
  distro=$(detect_distro)
  log "检测到发行版: $distro"

  if ! has_pacman && ! has_paru && ! has_yay; then
    error "未检测到 Arch 系包管理器(pacman/paru/yay)。此脚本仅适用于 Arch Linux。"
  fi

  init_pkg_mgr
  log "包管理器: $PKG_MGR"

  if is_steamdeck; then
    log "检测到 Steam Deck / SteamOS,启用对应配置。"
  fi

  [[ "$DO_RUNTIME" == true ]] && install_runtime
  [[ "$DO_DEV"     == true ]] && install_dev
  [[ "$DO_NPM"     == true ]] && install_npm_deps
  [[ "$DO_UDEV"    == true ]] && setup_udev_rules && setup_user_groups

  echo ""
  log "全部完成。建议重新登录一次(若改了用户组),然后:"
  log "  ./scripts/build-appimage.sh     # 打包"
  log "  npm start                       # 直接以 dev 模式运行"
}

main "$@"
