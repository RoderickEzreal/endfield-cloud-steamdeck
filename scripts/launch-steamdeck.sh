#!/bin/sh
# Endfield Cloud Client launcher — Steam Deck / Wayland-only
# 自适应 Wayland socket:
#   - 桌面模式(KWin):wayland-0
#   - 掌机模式(Gamescope):gamescope-0
# 解包模式(AppImage):跳过 FUSE,适合 Gamescope / 受限 cgroup

# 强制注入
export DISPLAY="${DISPLAY:-:0}"
export XDG_SESSION_TYPE=wayland
export XDG_RUNTIME_DIR="/run/user/$(id -u)"

# WAYLAND_DISPLAY 探测:
#   1) 已有 → 用
#   2) 扫 /run/user/<uid>/ 下所有 wayland-* 和 gamescope-* socket
#      优先 gamescope(掌机模式),其次 wayland(桌面)
#   3) 兜底 wayland-0
if [ -z "$WAYLAND_DISPLAY" ]; then
  for sock in /run/user/$(id -u)/gamescope-* /run/user/$(id -u)/wayland-*; do
    [ -S "$sock" ] || continue
    candidate=$(basename "$sock")
    [ "${candidate%.lock}" = "$candidate" ] || continue
    [ "${candidate%-ei}" = "$candidate" ] || continue
    export WAYLAND_DISPLAY="$candidate"
    break
  done
fi
export WAYLAND_DISPLAY="${WAYLAND_DISPLAY:-wayland-0}"

# Gamescope 兼容:有些 Mesa/SDL 应用认 GAMESCOPE_WAYLAND_DISPLAY
export GAMESCOPE_WAYLAND_DISPLAY="${GAMESCOPE_WAYLAND_DISPLAY:-$WAYLAND_DISPLAY}"

exec /home/deck/apps/endfield-cloud-client.AppImage \
  --appimage-extract-and-run \
  --no-sandbox \
  --fullscreen \
  "$@"
