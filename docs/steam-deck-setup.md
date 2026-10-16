# Steam Deck 安装与运行指南

> 适用:Steam Deck 原生系统(SteamOS 3.x,基于 Arch Linux)
> 也适用:任意 Arch Linux / Manjaro 桌面环境

---

## 1. 系统要求

| 项目 | 最低 | 推荐 |
|---|---|---|
| 操作系统 | Arch Linux (2023+) / SteamOS 3.x | SteamOS 3.5+ |
| CPU | x86_64 | Steam Deck AMD Van Gogh |
| GPU | Vulkan 1.1+ | AMD Van Gogh(集成 RDNA2) |
| 内存 | 4 GB | Steam Deck 16 GB |
| 存储 | 200 MB(运行时)+ 1 GB(开发) | — |
| 网络 | 10 Mbps | 50 Mbps+(云游戏流畅) |

---

## 2. 安装步骤

### 2.1 进入桌面模式

Steam Deck 默认进游戏模式。**长按电源键 → 切换到桌面**。

桌面模式下打开 Konsole 终端,执行后续命令。

### 2.2 解锁 sudo(若需要)

```bash
# Steam Deck 默认 deck 用户有 sudo
sudo -v
```

若提示输入密码:Steam Deck 默认 `deck` 用户无密码,
直接回车即可;若已设密码,正常输入。

### 2.3 克隆或拷贝项目

```bash
# 若从另一台机器同步过来
scp user@host:/path/to/endfield-cloud-client ~/endfield-cloud-client

# 或从 U 盘拷贝
cp -r /run/media/deck/USBDRIVE/endfield-cloud-client ~/
cd ~/endfield-cloud-client
```

### 2.4 一键安装所有依赖

```bash
./scripts/install-deps-arch.sh
```

这个脚本会做四件事:

1. **运行时依赖** — Chromium 内核、GPU/Vulkan、VA-API、手柄库
2. **开发工具** — Node.js、npm、electron-builder、librsvg
3. **npm 依赖** — Electron 33、electron-builder 25
4. **udev 规则 + 用户组** — 让 `deck` 用户能访问 `/dev/input/event*`

> 安装完会提示"重新登录",这是因为要把用户加入 `input` 组。
> 在 Steam Deck 桌面模式下不必重登,但**重启一次**更稳妥。

### 2.5 打包

```bash
./scripts/build-appimage.sh
```

打包产物:`dist/endfield-cloud-client-1.0.0.AppImage`

### 2.6 试运行

```bash
chmod +x dist/endfield-cloud-client-1.0.0.AppImage
./dist/endfield-cloud-client-1.0.0.AppImage
```

如果看到黑色窗口并加载鹰角登录页,说明成功。

---

## 3. 把 AppImage 放到固定位置(可选)

```bash
mkdir -p ~/.local/bin
cp dist/endfield-cloud-client-1.0.0.AppImage ~/.local/bin/endfield-cloud-client
chmod +x ~/.local/bin/endfield-cloud-client

# 加进 PATH(若还没有)
echo 'export PATH=$HOME/.local/bin:$PATH' >> ~/.bashrc
```

以后可以直接:

```bash
endfield-cloud-client
```

---

## 4. 升级版本

```bash
cd ~/endfield-cloud-client
git pull    # 或重新拷贝
npm install
./scripts/build-appimage.sh
```

Cookie 持久化在 `~/.config/Endfield Cloud/`,**不会被升级清掉**。
若想彻底清除(退出登录):

```bash
rm -rf ~/.config/Endfield\ Cloud/
```

---

## 5. 安装位置参考

| 内容 | 路径 |
|---|---|
| AppImage | `dist/endfield-cloud-client-*.AppImage` |
| 用户数据(Cookie / 缓存) | `~/.config/Endfield Cloud/` |
| 窗口状态 | `~/.config/Endfield Cloud/window-state.json` |
| 渲染缓存 | `~/.config/Endfield Cloud/Cache/` |
| udev 规则 | `/etc/udev/rules.d/99-endfield-cloud-gamepad.rules` |

---

## 6. 卸载

```bash
rm -rf ~/.local/bin/endfield-cloud-client
rm -rf ~/.config/Endfield\ Cloud/
sudo rm /etc/udev/rules.d/99-endfield-cloud-gamepad.rules
sudo udevadm control --reload-rules
```

---

## 7. 下一步

- 加进 Steam 库 → [`steam-library-add.md`](steam-library-add.md)
- 配置 Steam Input 手柄布局 → [`steam-input-config.md`](steam-input-config.md)
- 出问题怎么办 → [`troubleshooting.md`](troubleshooting.md)
