# Endfield Cloud Client

> 轻量 Chromium 内核封装壳,专为 **Steam Deck(Arch Linux)** 游玩
> 《云·明日方舟:终末地》网页云游戏设计。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform: Arch Linux](https://img.shields.io/badge/Platform-Arch%20Linux-1793d1.svg)]()
[![Engine: Electron](https://img.shields.io/badge/Engine-Electron-47848F.svg)]()

---

## 这是什么

一个最小化的桌面客户端,**仅**负责把官方云游戏网页
[`endfield.hypergryph.com/cloud`](https://endfield.hypergryph.com/cloud)
包成原生窗口。**不**做以下任何事情:

- ❌ 不抓包、不解析、不篡改游戏数据流
- ❌ 不逆向、不修改、不绕过鹰角登录 / 滑块 / 协议校验
- ❌ 不模拟、不伪造、不替代官方输入源
- ❌ 不外挂、不加速、不修改云游戏串流协议

它只是壳。Chromium 内核 + 系统原生手柄 + 持久化 Cookie,
让你在 Steam Deck 上像玩原生游戏一样点一下就能玩。

---

## 核心功能

| 功能 | 说明 |
|---|---|
| 内置 Chromium | Electron 33.x,默认加载官方云游戏网页 |
| 原生分辨率 | 1280×800(Steam Deck 屏幕原生),支持无边框全屏 / 窗口切换 |
| 手柄透传 | 系统原生 Web Gamepad API,Steam Deck / Xbox / DS4 / DualSense 全兼容 |
| Cookie 持久化 | 记住鹰角账号登录态,**不存任何明文凭据** |
| 快捷键 | `F11` 全屏 / `ESC` 退出全屏 / `F5` 刷新 / `F12` 临时关手柄 |
| GPU 加速 | Vulkan + VA-API 视频硬解(Steam Deck AMD Van Gogh APU) |
| Steam Input | 可加进 Steam 库,Steam 控制器布局完整叠加生效 |
| 轻量 | 关闭扩展、后台、同步、翻译等无关模块,降低 CPU/内存占用 |

---

## 快速开始(Steam Deck)

### 1. 安装前置依赖

```bash
cd endfield-cloud-client
./scripts/install-deps-arch.sh
```

> 详情见 [`docs/steam-deck-setup.md`](docs/steam-deck-setup.md)

### 2. 安装 npm 依赖 + 打包 AppImage

```bash
./scripts/install-deps-arch.sh --dev --npm
./scripts/build-appimage.sh
```

打包产物:`dist/endfield-cloud-client-1.0.0.AppImage`

### 3. 运行

```bash
chmod +x dist/endfield-cloud-client-1.0.0.AppImage
./dist/endfield-cloud-client-1.0.0.AppImage
```

### 4.(可选)加进 Steam 库

```bash
./scripts/steam-add.sh dist/endfield-cloud-client-1.0.0.AppImage
```

> 详情见 [`docs/steam-library-add.md`](docs/steam-library-add.md)

---

## 开发模式

不打包,直接跑源码:

```bash
npm install         # 安装 Electron
npm start           # 启动
```

调试模式(详细日志):

```bash
npm run start:debug
```

强制 X11(若 Wayland 兼容有问题):

```bash
npm run start:wayland  # Wayland
npm start -- --ozone-platform=x11
```

---

## CLI 参数

```bash
endfield-cloud-client --url=https://endfield.hypergryph.com/cloud
endfield-cloud-client --window-size=1920x1080
endfield-cloud-client --fullscreen
```

---

## 项目结构

```
endfield-cloud-client/
├── package.json               # npm / electron-builder 配置
├── src/
│   ├── main.js                # 主进程:窗口创建 + 快捷键 + 生命周期
│   └── preload.js             # 上下文桥 + 手柄静音拦截
├── resources/
│   ├── icon.svg               # 图标源文件
│   └── icons/                 # 自动生成的 PNG 图标
├── scripts/
│   ├── install-deps-arch.sh   # Arch 依赖安装
│   ├── build-appimage.sh      # AppImage 打包
│   └── steam-add.sh           # 加进 Steam 库
└── docs/
    ├── steam-deck-setup.md
    ├── steam-library-add.md
    ├── steam-input-config.md
    └── troubleshooting.md
```

---

## 文档

- [Steam Deck 安装与运行](docs/steam-deck-setup.md)
- [如何加进 Steam 库](docs/steam-library-add.md)
- [Steam Input 手柄配置](docs/steam-input-config.md)
- [故障排查](docs/troubleshooting.md)

---

## 安全与合规

本项目仅作技术封装,**所有游戏数据流、所有登录校验、所有协议交互均经
官方云游戏网页处理**。本项目:

- 不收集任何用户数据
- 不向任何第三方服务器发送游戏相关信息
- 不保存用户名 / 密码 / Token(仅存官方 Cookie,标准浏览器机制)
- 不读取或修改游戏运行时数据

如果你认为本项目违反了鹰角官方用户协议,**请不要使用**。

---

## License

MIT
