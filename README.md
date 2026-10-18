# Endfield Cloud Client

> 专为 **Steam Deck** 设计的轻量级 Chromium 封装壳,用来游玩鹰角《云·明日方舟:终末地》网页云游戏。

[![Latest Release](https://img.shields.io/github/v/release/RoderickEzreal/endfield-cloud-steamdeck?style=flat-square&color=blue)](https://github.com/RoderickEzreal/endfield-cloud-steamdeck/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Platform: Linux](https://img.shields.io/badge/Platform-Linux-1793d1.svg)](https://wiki.archlinux.org/)
[![Steam Deck Ready](https://img.shields.io/badge/Steam_Deck-ready-success.svg)](https://www.steamdeck.com/)
[![Engine: Electron](https://img.shields.io/badge/Engine-Electron-47848F.svg)](https://www.electronjs.org/)
[![Wayland First](https://img.shields.io/badge/Wayland-first-blueviolet.svg)](https://wayland.freedesktop.org/)

[English](#english) · [中文](#中文)

---

## 中文

### 这是什么

一个**极简桌面客户端**,只做一件事:把官方云游戏网页 [`endfield.hypergryph.com/cloud`](https://endfield.hypergryph.com/cloud) 包成原生窗口,在 Steam Deck 上像玩原生游戏一样点开即玩。

**它不做什么** —— 本项目明确不包含、也不会加入以下内容:

- ❌ 不抓包、不解析、不篡改游戏数据流
- ❌ 不逆向、不修改、不绕过鹰角登录 / 滑块 / 协议校验
- ❌ 不模拟、不伪造输入源
- ❌ 不外挂、不加速、不修改云游戏串流协议

它只是壳。Chromium 内核 + 系统原生手柄 + 持久化 Cookie。**所有游戏数据、所有登录校验、所有协议交互均经官方云游戏网页处理**。

### 核心特性

| 特性 | 说明 |
|---|---|
| **Chromium 内核** | Electron 33,加载鹰角官方云游戏网页 |
| **Steam Deck 原生分辨率** | 默认 1280×800(无窗口状态时取主显示器 75%),外接显示器自动适配 |
| **无边框全屏** | `F11` 切换 / `ESC` 退出,全屏时窗口不黑边 |
| **原生 Web Gamepad API 透传** | Steam Deck / Xbox / DS4 / DualSense 全支持,**不**做键鼠模拟映射 |
| **持久 Cookie 会话** | 记住鹰角账号登录状态,**不存储任何明文凭据** |
| **F12 临时禁手柄** | 滑块验证时关闭手柄,用触控板 / 鼠标操作,验证完恢复 |
| **Wayland 自适应** | SteamOS 3.x 完全适配,GPU/Vulkan + VA-API 硬件加速;掌机模式 Gamescope 自动走 XWayland(已知 Gamescope Wayland surface 渲染 bug) |
| **Steam Input 兼容** | 加进 Steam 库后,Steam 控制器布局完整叠加生效 |
| **轻量** | 关闭扩展、后台、同步、翻译、域名可靠性等无关模块,降低 CPU/内存占用 |

### 快速开始

#### Steam Deck 用户(桌面模式)

```bash
# 1. 在桌面模式开 Konsole,克隆项目
cd ~
git clone https://github.com/RoderickEzreal/endfield-cloud-steamdeck.git
cd endfield-cloud-steamdeck

# 2. 一键安装依赖(runtime + dev + npm + udev 规则)
./scripts/install-deps-arch.sh

# 3. 打包 AppImage(约 5-10 分钟,首次会下载 Electron 二进制)
./scripts/build-appimage.sh

# 4. 装到 ~/apps/
mkdir -p ~/apps
cp dist/endfield-cloud-client-*.AppImage ~/apps/endfield-cloud-client.AppImage
chmod +x ~/apps/endfield-cloud-client.AppImage

# 5. 用 wrapper 启动(自动适配桌面/掌机模式)
./scripts/launch-steamdeck.sh ~/apps/endfield-cloud-client.AppImage
# 或拷到 ~/bin 后(默认读 $HOME/apps/...):
cp scripts/launch-steamdeck.sh ~/bin/endfield-cloud
chmod +x ~/bin/endfield-cloud
~/bin/endfield-cloud
```

#### Steam Deck 用户(下载预编译版本)

```bash
# 下载最新版本
mkdir -p ~/apps
cd ~/apps
APPIMAGE_URL=$(curl -sL https://api.github.com/repos/RoderickEzreal/endfield-cloud-steamdeck/releases/latest \
  | grep browser_download_url | grep AppImage | cut -d '"' -f 4)
curl -L -o endfield-cloud-client.AppImage "$APPIMAGE_URL"
chmod +x endfield-cloud-client.AppImage

# 启动(直接跑;Chromium 自己探测 Wayland vs XWayland)
./endfield-cloud-client.AppImage
```

### 快捷键

| 按键 | 行为 |
|---|---|
| `F11` | 无边框全屏切换 |
| `ESC` | 退出全屏 |
| `F5` | 刷新页面(忽略缓存) |
| `F12` | 临时开关手柄输入 |
| `Ctrl+Q` / `Cmd+Q` | 退出应用 |
| `Alt+F4` | 退出应用 |

### CLI 参数

```bash
endfield-cloud-client --url=https://endfield.hypergryph.com/cloud
endfield-cloud-client --window-size=1920x1080
endfield-cloud-client --fullscreen
endfield-cloud-client --windowed                   # 强制窗口化(覆盖记忆)
endfield-cloud-client --window-mode=fullscreen     # auto / fullscreen / windowed
```

### 添加到 Steam 库(可选)

让游戏模式(Gamescope)能像原生游戏一样启动:

1. Steam → 游戏 → 在库中添加非 Steam 的游戏
2. 浏览 → `~/apps/endfield-cloud-client.AppImage`
3. 添加

详细 Steam Input 手柄布局配置见 [docs/steam-input-config.md](docs/steam-input-config.md)。

> 💡 wrapper 里的 `--no-sandbox` 来自 Chromium SUID helper 与 AppImage FUSE namespace 在 SteamOS 内核下的冲突,不影响安全(见 `src/main.js` 里 `contextIsolation: true` / `nodeIntegration: false`)。

### 文档

| 文档 | 内容 |
|---|---|
| [docs/steam-deck-setup.md](docs/steam-deck-setup.md) | Steam Deck 完整安装流程 |
| [docs/steam-library-add.md](docs/steam-library-add.md) | 加进 Steam 库的多种方法 |
| [docs/steam-input-config.md](docs/steam-input-config.md) | Steam Input 手柄布局配置 |
| [docs/troubleshooting.md](docs/troubleshooting.md) | 故障排查(手柄 / GPU / 网页) |

### 兼容性

| 平台 | 状态 |
|---|---|
| SteamOS 3.5+ (Steam Deck 原生) | ✅ 验证通过 |
| Arch Linux 2024+ (Wayland) | ✅ 验证通过 |
| Manjaro (Wayland) | ✅ 应该可用(未实测) |
| 其它 Linux (X11 桌面) | ⚠️ 需手动加 `--ozone-platform=x11` |
| macOS / Windows | ❌ 不在支持范围(Steam Deck + Linux 项目) |

x86_64 only。

### 开发

#### 从源码运行(开发者)

```bash
git clone https://github.com/RoderickEzreal/endfield-cloud-steamdeck.git
cd endfield-cloud-steamdeck
npm install
npm start              # 直接跑源码,不打包
npm run start:debug    # 调试日志
```

#### 目录结构

```
endfield-cloud-steamdeck/
├── package.json              # Electron + electron-builder 配置
├── src/
│   ├── main.js               # 主进程:窗口 / 快捷键 / 生命周期 / Wayland 注入
│   └── preload.js            # 上下文桥 + navigator.getGamepads 静音拦截
├── resources/
│   ├── icon.svg              # 图标源文件
│   └── icons/                # 自动生成的 PNG(electron-builder 用)
├── scripts/
│   ├── install-deps-arch.sh  # Arch 依赖一键装
│   ├── build-appimage.sh     # AppImage 打包
│   ├── launch-steamdeck.sh   # Steam Deck 启动 wrapper(自适应 Wayland 模式)
│   └── steam-add.sh          # 加进 Steam 库的 VDF 注入
└── docs/                     # 详细文档
```

#### 技术栈

- **Electron 33.4.11** — Chromium 内核
- **electron-builder 25.1.8** — AppImage 打包
- **Chromium 130** — 渲染引擎
- **Node 20** — 仅打包期使用(运行时无 Node API 暴露)

### 安全与合规

本项目**所有游戏数据流、所有登录校验、所有协议交互均经官方云游戏网页处理**。本项目:

- ✅ 不收集任何用户数据
- ✅ 不向任何第三方服务器发送游戏相关信息
- ✅ 不保存用户名 / 密码 / Token(仅存官方 Cookie,标准浏览器机制)
- ✅ 不读取或修改游戏运行时数据

如果你认为本项目违反了鹰角官方用户协议,**请不要使用**。

### License

[MIT](LICENSE) — 但请遵守上述安全与合规约束。

---

## English

### What is this

A **minimal desktop client** that wraps the official Endfield cloud game webpage into a native window, optimized for Steam Deck.

It is **strictly a thin shell**:

- ❌ No reverse engineering
- ❌ No packet capture / data tampering
- ❌ No login / captcha / protocol bypass
- ❌ No input simulation — gamepad events flow through the standard Web Gamepad API
- ❌ No cheats, hacks, or stream modifications

### Features

- **Chromium kernel** (Electron 33)
- **Steam Deck native resolution** — 1280×800 default, auto-detects external displays
- **Borderless fullscreen** — F11 toggle, ESC exit
- **Native Web Gamepad API passthrough** — Steam Deck / Xbox / DS4 / DualSense
- **Persistent cookie sessions** — no plaintext credentials stored
- **F12 toggles gamepad** for slider verification
- **Wayland-first** — Vulkan + VA-API acceleration;Steam Deck gaming mode (Gamescope) auto-falls back to XWayland
- **Steam Input compatible** — add to Steam library for full overlay support

### Quick Start (Steam Deck)

```bash
# Desktop mode, in Konsole:
git clone https://github.com/RoderickEzreal/endfield-cloud-steamdeck.git
cd endfield-cloud-steamdeck
./scripts/install-deps-arch.sh
./scripts/build-appimage.sh
mkdir -p ~/apps
cp dist/endfield-cloud-client-*.AppImage ~/apps/endfield-cloud-client.AppImage
chmod +x ~/apps/endfield-cloud-client.AppImage

# Launch via wrapper (auto-adapts to desktop / gaming mode):
./scripts/launch-steamdeck.sh ~/apps/endfield-cloud-client.AppImage
```

Or download a pre-built AppImage from the [latest release](https://github.com/RoderickEzreal/endfield-cloud-steamdeck/releases/latest) and run it directly.

### Shortcuts

| Key | Action |
|---|---|
| `F11` | Toggle borderless fullscreen |
| `ESC` | Exit fullscreen |
| `F5` | Reload page (ignore cache) |
| `F12` | Toggle gamepad input |
| `Ctrl+Q` / `Cmd+Q` | Quit |
| `Alt+F4` | Quit |

### CLI Options

```bash
endfield-cloud-client --url=https://endfield.hypergryph.com/cloud
endfield-cloud-client --window-size=1920x1080
endfield-cloud-client --fullscreen
endfield-cloud-client --windowed                   # force windowed (overrides memory)
endfield-cloud-client --window-mode=fullscreen     # auto / fullscreen / windowed
```

### Compatibility

| Platform | Status |
|---|---|
| SteamOS 3.5+ (Steam Deck) | ✅ Verified |
| Arch Linux 2024+ (Wayland) | ✅ Verified |
| Manjaro (Wayland) | ✅ Should work (untested) |
| Other Linux (X11 desktop) | ⚠️ Add `--ozone-platform=x11` manually |
| macOS / Windows | ❌ Out of scope (Steam Deck + Linux project) |

x86_64 only.

### Development

```bash
git clone https://github.com/RoderickEzreal/endfield-cloud-steamdeck.git
cd endfield-cloud-steamdeck
npm install
npm start              # run from source, no packaging
npm run start:debug    # with verbose logging
npm run build:linux    # produce AppImage in dist/
```

### Documentation

| Document | Content |
|---|---|
| [docs/steam-deck-setup.md](docs/steam-deck-setup.md) | Full Steam Deck install walkthrough |
| [docs/steam-library-add.md](docs/steam-library-add.md) | Adding to Steam library (multiple methods) |
| [docs/steam-input-config.md](docs/steam-input-config.md) | Steam Input gamepad layout config |
| [docs/troubleshooting.md](docs/troubleshooting.md) | Troubleshooting (gamepad / GPU / webpage) |

### License

MIT — see [LICENSE](LICENSE). Please respect the security & compliance constraints above.
