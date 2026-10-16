# 故障排查

> 收集中遇到的所有问题 + 解决方案。
> 排错前请先看[概述](#概述)和[快速诊断清单](#快速诊断清单)。

---

## 概述

按可能性排序:

| 类别 | 出现概率 | 表现 |
|---|---|---|
| 手柄权限 | 50% | 手柄不识别、滑块卡死 |
| GPU 加速 | 25% | 画面卡顿、撕裂、CPU 飙高 |
| 网页加载 | 15% | 白屏、登录失败、超时 |
| 系统依赖 | 5% | 启动崩溃、缺库 |
| 网络 | 5% | 鹰角服务器连不上 |

---

## 快速诊断清单

跑完这五步,90% 问题能定位:

```bash
# 1. 看启动日志(关键!)
./dist/endfield-cloud-client-1.0.0.AppImage --enable-logging=stderr --v=1 2>&1 | tee /tmp/endfield.log

# 2. 看手柄设备
ls -l /dev/input/event* /dev/input/js*

# 3. 看 GPU
vulkaninfo | head -20
vainfo

# 4. 看进程
ps aux | grep -i endfield

# 5. 看用户数据目录(可能有崩溃日志)
ls -la ~/.config/Endfield\ Cloud/
```

---

## 1. 手柄识别失败

### 症状

- 云游戏页面显示"未检测到手柄"
- 手柄按键没反应
- `navigator.getGamepads()` 返回空数组

### 排查

#### 1.1 系统是否识别手柄?

```bash
ls -l /dev/input/event*
```

应看到形如:

```
crw-rw---- 1 root input 13, 64 Oct 16 12:00 /dev/input/event0
crw-rw---- 1 root input 13, 65 Oct 16 12:00 /dev/input/event1
...
```

**关键**:
- 设备属于 `input` 组(不是 root 独占)
- 当前用户在 `input` 组(`id -nG $USER` 应包含 `input`)

#### 1.2 udev 规则生效?

```bash
cat /etc/udev/rules.d/99-endfield-cloud-gamepad.rules
```

应有:

```
KERNEL=="event*", SUBSYSTEM=="input", GROUP="input", MODE="0660"
KERNEL=="js*",     SUBSYSTEM=="input", GROUP="input", MODE="0660"
```

若没有 → 跑 `./scripts/install-deps-arch.sh --udev`。

#### 1.3 用户在 input 组?

```bash
groups $USER
```

若没有 `input` → `sudo usermod -aG input $USER`,**重新登录**。

#### 1.4 Steam Input 是否创建了虚拟手柄?

```bash
ls -l /dev/input/event*
```

若看到多个 `event*`,且有名字含 `Microsoft X-Box` / `Sony` / `Steam Controller`,
说明 Steam Input 工作正常。

#### 1.5 Chromium 是否收到事件?

启动时加调试 flag:

```bash
./endfield-cloud-client --enable-logging=stderr --v=1 2>&1 | grep -i gamepad
```

应看到形如:

```
[INFO:CONSOLE] "Gamepad connected: ..."
```

#### 1.6 F12 是否关了?

按 **F12** 切换手柄状态。看终端日志:

```
[gamepad] MUTED
[gamepad] ENABLED
```

确认是 `ENABLED`。

### 解决方案

| 根因 | 修复 |
|---|---|
| udev 规则缺失 | `./scripts/install-deps-arch.sh --udev` |
| 用户不在 input 组 | `sudo usermod -aG input $USER`,重登 |
| Steam Input 未启用 | Steam 控制器设置 → 强制启用 |
| 应用层静音 | 按 F12 恢复 |
| 手柄未配对 | 蓝牙配对 / 重新插 USB |

---

## 2. 硬件加速异常

### 症状

- 画面撕裂、卡顿
- CPU 占用飙到 100%
- 终端报 `Failed to create Vulkan instance`
- 终端报 `VAAPI decoder not available`

### 排查

#### 2.1 Vulkan 工作?

```bash
vulkaninfo | head -10
```

应输出设备列表。

若没有 → `sudo pacman -S vulkan-radeon vulkan-icd-loader mesa`(AMD)
或 `vulkan-intel`(Intel)

#### 2.2 VA-API 工作?

```bash
vainfo
```

应输出 driver 信息 + 多个 profile。

若没有 → `sudo pacman -S libva libva-utils mesa-vdpau`
Intel: `libva-intel-driver`
AMD: `libva-mesa-driver`

#### 2.3 Steam Deck 特定

```bash
# Gamescope 是否正常运行?
ls -la /usr/bin/gamescope 2>/dev/null

# Vulkan 设备
ls -la /dev/dri/
```

应看到 `card0` / `renderD128`。

### 解决方案

#### A. 强制软件渲染(回退方案)

```bash
./endfield-cloud-client --disable-gpu
```

CPU 占用会变高但能跑。验证是否为 GPU 问题。

#### B. 显式指定 GPU

```bash
./endfield-cloud-client --use-gl=egl
# 或
./endfield-cloud-client --use-gl=desktop
```

#### D. Steam Deck 用户

Steam Deck 默认在 Gamescope 会话运行 Electron 应用。
若 GPU 异常,试试在桌面模式下启动,排除 Gamescope 干扰。

---

## 3. 网页加载问题

### 症状

- 白屏
- "无法连接到 endfield.hypergryph.com"
- 登录页打不开
- 一直转圈

### 排查

#### 3.1 网络通?

```bash
curl -v https://endfield.hypergryph.com/cloud
```

应看到 200 / 30x 响应。

#### 3.2 DNS 解析?

```bash
dig endfield.hypergryph.com
# 或
nslookup endfield.hypergryph.com
```

#### 3.3 浏览器能开吗?

同台机器 Firefox/Chrome 访问:
`https://endfield.hypergryph.com/cloud`

- 若能开 → 应用层问题
- 若不能开 → 网络/地区问题

#### 3.4 系统代理?

若你用 mihomo / clash / ss:

```bash
# Electron 是否绕过代理?
echo $HTTP_PROXY $HTTPS_PROXY
```

Electron 默认**走系统代理**。若代理有问题:

```bash
./endfield-cloud-client --no-proxy-server
```

### 解决方案

| 根因 | 修复 |
|---|---|
| 服务器临时抽风 | 等几小时再试 |
| DNS 污染 | `echo "1.1.1.1 endfield.hypergryph.com" | sudo tee /etc/hosts.d/endfield` |
| 代理被劫持 | `--no-proxy-server` 或配置 Electron 走指定代理 |
| 缓存损坏 | `rm -rf ~/.config/Endfield\ Cloud/Cache/` |
| Cookie 过期 | `rm -rf ~/.config/Endfield\ Cloud/Cookies` 重新登录 |

---

## 4. 启动崩溃

### 症状

- 双击 AppImage 无反应
- 终端跑直接 exit code != 0
- 窗口瞬间关闭

### 排查

#### 4.1 缺库?

```bash
./endfield-cloud-client.AppImage 2>&1 | head -50
```

若看到形如:

```
error while loading shared libraries: libnss3.so: cannot open shared object file
```

→ 跑 `./scripts/install-deps-arch.sh --runtime`

#### 4.2 AppImage 不可执行?

```bash
file ./endfield-cloud-client.AppImage
# 应输出:ELF 64-bit LSB executable, ...

ls -la ./endfield-cloud-client.AppImage
# 应有 x 权限
```

若无 x:`chmod +x`

#### 4.3 FUSE 不可用?

AppImage 默认需要 FUSE 挂载。若 Steam Deck FUSE 未启用:

```bash
# 解包式运行(无需 FUSE)
./endfield-cloud-client.AppImage --appimage-extract-and-run
```

或装 FUSE:

```bash
sudo pacman -S fuse2
sudo modprobe fuse
sudo usermod -aG fuse $USER
```

### 解决方案

| 根因 | 修复 |
|---|---|
| 缺库 | `install-deps-arch.sh --runtime` |
| 权限错 | `chmod +x` |
| FUSE 不可用 | `--appimage-extract-and-run` 或装 fuse2 |
| 路径含中文 | 重命名为纯 ASCII 路径 |
| Steam Deck 只读 | AppImage 放 `/home/deck/`,不放系统盘 |

---

## 5. Cookie / 登录状态丢失

### 症状

- 每次启动都要重新登录
- 之前记住的账号没了

### 排查

```bash
ls -la ~/.config/Endfield\ Cloud/
```

应有 `Cookies`(SQLite 数据库)。

若没有 → 写入权限问题。

### 解决方案

```bash
# 修复权限
chown -R $USER:$USER ~/.config/Endfield\ Cloud/

# 强制持久化
# 已在 main.js 里硬编码,无需配置
```

---

## 6. 滑块验证卡死

### 症状

- 滑块拖不动
- 鼠标点击没反应
- 验证码出不来

### 解决方案

1. 按 **F12** 关闭手柄
2. 用**右触控板**缓慢滑动完成验证
3. 完成后按 **F12** 恢复手柄

如果触控板仍不行:

- Steam 控制器设置切到 **Gamepad Mouse** 布局
- 临时禁用 Steam Input 强制关闭

---

## 7. 性能调优

### 内存占用过高

编辑 `src/main.js` 的 Chromium switches:

```javascript
// 关闭 JS 优化(可能降低体验但省内存)
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=512');
```

### 网络带宽限制

鹰角云游戏支持手动调画质档。登录后在游戏内设置选低档。

### Steam Deck 散热

- 用底座风扇(满速)
- 室温 < 30°C
- 关闭后台下载(Steam 设置)

---

## 8. 日志位置

| 日志类型 | 位置 |
|---|---|
| 应用 stdout/stderr | `--enable-logging=stderr` 时显式打 |
| Chromium 内部日志 | `~/.config/Endfield Cloud/chrome_debug.log` |
| GPU 错误 | 同上 |
| 崩溃转储 | `~/.config/Endfield Cloud/Crashpad/` |

---

## 9. 提交 Issue 前

请提供:

1. **操作系统版本**:`cat /etc/os-release | head -5`
2. **启动日志完整输出**:`./endfield-cloud-client --enable-logging=stderr --v=1 2>&1 | tee endfield.log`
3. **GPU 信息**:`vulkaninfo --summary`
4. **手柄检测**:`ls -l /dev/input/event*`
5. **复现步骤**:最小化操作流程

附 `endfield.log` 一起提交。

---

## 10. 完全卸载 + 清理

```bash
# 卸应用
rm -rf ~/endfield-cloud-client
rm -rf ~/.local/bin/endfield-cloud-client

# 清用户数据(下次启动会重新登录)
rm -rf ~/.config/Endfield\ Cloud/

# 卸 udev 规则
sudo rm /etc/udev/rules.d/99-endfield-cloud-gamepad.rules
sudo udevadm control --reload-rules

# 卸系统包(可选)
sudo pacman -Rns libappimage fuse2 librsvg imagemagick
```

---

## 还是没解决?

收集日志后,贴到 GitHub issue 或反馈渠道。
