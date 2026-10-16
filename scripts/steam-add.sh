#!/usr/bin/env bash
# ============================================================
# Endfield Cloud Client - 添加到 Steam 库
# ============================================================
# 用法:
#   ./scripts/steam-add.sh /path/to/endfield-cloud-client.AppImage
#
# 作用:
#   - 在 ~/.steam/.../userdata/<user>/config/localconfig.vdf 里
#     注入一个非 Steam 游戏快捷方式
#   - 自动设置启动参数(让 Steam 知道这是什么)
#   - 提供"加完怎么启动"提示
#
# 注意:
#   - 该脚本只是辅助,有时 VDF 解析会因 Steam 版本而失败
#   - 若失败,请改用 Steam UI 手动添加(见 docs/steam-library-add.md)
# ============================================================

set -euo pipefail

SCRIPT_NAME=$(basename "$0")

if [[ -t 1 ]]; then
  GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
else
  GREEN=''; YELLOW=''; RED=''; NC=''
fi

log()  { echo -e "${GREEN}[$SCRIPT_NAME]${NC} $*"; }
warn() { echo -e "${YELLOW}[$SCRIPT_NAME]${NC} $*"; }
error(){ echo -e "${RED}[$SCRIPT_NAME]${NC} $*" >&2; exit 1; }

# ============================================================
# 参数检查
# ============================================================
if [[ $# -lt 1 ]]; then
  echo "用法: $0 <AppImage 路径> [自定义名称]"
  echo ""
  echo "示例:"
  echo "  $0 ~/dist/endfield-cloud-client-1.0.0.AppImage"
  echo "  $0 ~/dist/endfield-cloud-client-1.0.0.AppImage '终末地云'"
  exit 1
fi

APPIMAGE_PATH="$(realpath "$1")"
APP_NAME="${2:-Endfield Cloud}"

[[ -f "$APPIMAGE_PATH" ]] || error "找不到文件: $APPIMAGE_PATH"

# ============================================================
# 定位 Steam 用户配置目录
# ============================================================
find_steam_userdata() {
  local STEAM_ROOT=""
  for candidate in "$HOME/.steam/steam" "$HOME/.local/share/Steam"; do
    if [[ -d "$candidate" ]]; then
      STEAM_ROOT="$candidate"
      break
    fi
  done

  if [[ -z "$STEAM_ROOT" ]]; then
    error "找不到 Steam 安装目录(检查 ~/.steam/steam 或 ~/.local/share/Steam)"
  fi

  # 找 userdata 下数字目录中 config/localconfig.vdf
  local found_config=""
  for userdir in "$STEAM_ROOT/userdata"/*/config; do
    if [[ -f "$userdir/localconfig.vdf" ]]; then
      found_config="$userdir/localconfig.vdf"
      break
    fi
  done

  if [[ -z "$found_config" ]]; then
    error "找不到任何 Steam 用户的 localconfig.vdf(Steam 是否至少登录过一次?)"
  fi

  echo "$found_config"
}

VDF_PATH="$(find_steam_userdata)"
log "Steam 配置:$VDF_PATH"

# ============================================================
# 检查 Steam 是否在运行 — 必须先关
# ============================================================
if pgrep -x "steam" &>/dev/null; then
  warn "检测到 Steam 正在运行,必须先关闭 Steam 才能修改配置。"
  warn "请关闭 Steam 后重新运行此脚本。"
  exit 1
fi

# ============================================================
# 备份
# ============================================================
BACKUP_PATH="${VDF_PATH}.backup.$(date +%Y%m%d-%H%M%S)"
cp "$VDF_PATH" "$BACKUP_PATH"
log "已备份原配置:$BACKUP_PATH"

# ============================================================
# 生成新 shortcut 条目
# ============================================================
# Steam 用 VDF 格式,在 "Shortcuts" 块里追加一条
# 我们需要避开复杂的 VDF 解析,直接用最稳的"找一个最大序号 +1"方法

# 找当前最大序号
LAST_IDX=$(grep -oE '"[0-9]+"\s*\{' "$VDF_PATH" | grep -oE '"[0-9]+"' | tr -d '"' | sort -n | tail -1)
NEW_IDX=$((LAST_IDX + 1))
log "新条目序号:$NEW_IDX"

# 取 AppImage 所在目录作为启动目录(Steam 要求)
APP_DIR="$(dirname "$APPIMAGE_PATH")"

# 构造要插入的 VDF 块
NEW_ENTRY=$(cat <<EOF
		"$NEW_IDX"
		{
			"AppName"		"endfield-cloud-client"
			"AppId"			"$NEW_IDX"
			"ShortcutPath"		"$APPIMAGE_PATH"
			"ShortcutName"		"$APP_NAME"
			"StartInDir"		"$APP_DIR"
			"LaunchOptions"		""
			"IsHidden"		"0"
			"AllowOverlay"		"1"
			"OpenVR"		"0"
			"tags"			{ "0"		"Cloud Gaming" }
		}
EOF
)

# 插入到 Shortcuts 块的开始位置
# VDF 里形如: "Shortcuts" { ... 条目们 ... }
# 我们用 awk 定位 "Shortcuts" 这一行后插入

# 先备份再操作
cp "$VDF_PATH" "${VDF_PATH}.tmp"

python3 <<PYEOF > "$VDF_PATH"
import sys, re

with open("${VDF_PATH}.tmp", "r", encoding="utf-8") as f:
    content = f.read()

new_entry = '''$NEW_ENTRY'''

# 找 "Shortcuts" 块开始位置
m = re.search(r'(\n?\s*"Shortcuts"\s*\{)', content)
if not m:
    print("[ERROR] 找不到 Shortcuts 块,请手动添加。", file=sys.stderr)
    sys.exit(1)

insert_pos = m.end()
# 在 "{ 后面插入新条目
content = content[:insert_pos] + "\n" + new_entry + content[insert_pos:]

with open("$VDF_PATH", "w", encoding="utf-8") as f:
    f.write(content)

print("[OK] 已写入新条目")
PYEOF

rm -f "${VDF_PATH}.tmp"

# ============================================================
# 完成
# ============================================================
echo ""
log "完成!现在打开 Steam,在库视图切到'非 Steam'游戏分类。"
log "你会看到:'$APP_NAME'"
echo ""
log "可选后续步骤:"
log "  1. 右键 → 属性 → 设置 Steam Input → 启用'强制 Steam Input'"
log "  2. 右键 → 属性 → 兼容性 → 强制使用特定工具:Steam Linux Runtime"
log "  3. 详细配置见 docs/steam-input-config.md"
