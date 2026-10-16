# Steam Input 手柄配置指南

> 本指南帮你把 Steam Deck / Xbox / DS4 / DualSense 手柄映射到
> 云游戏网页原生 Web Gamepad API。
>
> **核心思路**:让 Chromium 直接读手柄 + 让 Steam Input 叠加生效。
> 本项目**不做**键鼠模拟,所有手柄信号由系统传到 Chromium,
> 网页通过标准 `navigator.getGamepads()` 读取。

---

## 三层手柄信号链

```
[物理手柄]
   ↓ evdev / hidapi
[Steam Input 映射层]   ← 在这里改键位
   ↓ 虚拟手柄 (uinput)
[Chromium Gamepad API] ← 直接读事件
   ↓ Web Gamepad 标准接口
[云游戏网页]
```

> **关键点**:Steam Input 创建虚拟手柄设备,Chromium 自动识别。
> 这意味着你在 Steam 里改的键位,网页直接收到。

---

## 1. Steam Deck 内置手柄

### 默认配置

Steam Deck 加游戏后,Steam 默认配置 = "Gamepad with Joystick Trackpad",
基本够用:

- 左摇杆 = 移动(模拟 W/S/A/D)
- 右摇杆 = 视角(鼠标)
- A = 鼠标左键
- B = 鼠标右键
- X/Y = 键盘键
- L2/R2 = 鼠标中键
- 触控板 = 鼠标移动 / 滑动

### F12 关闭手柄技巧(滑块验证)

云游戏登录时常见滑块验证,需要精准鼠标点击,
这时手柄信号会干扰操作:

1. 按 **F12**(在游戏窗口聚焦时) → 关闭手柄
2. 用**右触控板**慢慢滑动 / 点击完成验证
3. 验证完成 → 按 **F12** 恢复手柄

---

## 2. 切换 Steam Input 布局

### 用 Steam UI

1. 启动"Endfield Cloud"
2. Steam 弹窗 → "控制器设置"
3. 选一个布局模板:
   - **Gamepad with Joystick Trackpad**(默认)
   - **Gamepad Mouse**(更像鼠标)
   - **Gamepad**(纯键盘模拟)

### 用社区布局

1. Steam → 控制器设置 → 浏览布局
2. 搜 "Endfield" / "Endfield Cloud" / "Cloud Gamepad"
3. 订阅后自动应用

---

## 3. 自定义键位

### 简单改键

1. 控制器设置 → 当前布局 → 编辑
2. 单击任意按钮 → 选新输入
3. 保存

### 高级:直接编辑 VDF

配置文件在:

```
~/.steam/steam/controller_base/templates/
```

不推荐手动改,Steam UI 够用。

---

## 4. Xbox / DS4 / DualSense 外接手柄

### Steam Deck 连接

- **Xbox**:蓝牙配对 → Steam 自动识别为 "Xbox Controller"
- **DS4**:蓝牙 / USB → Steam 自动识别
- **DualSense**:蓝牙 / USB → Steam 自动识别

### Steam Input 覆盖

外接手柄默认走 Steam Input,你可以在:

控制器设置 → 顶部"控制器类型"下拉框选择要配置的手柄。

> **重要**:Steam 会创建虚拟手柄给 Chromium。
> 如果你想**禁用** Steam Input,直接传原生信号:

控制器设置 → "快捷键" → 控制器类型下拉旁的小齿轮 →
选 "禁用 Steam Input"

---

## 5. 手柄按键 → Web Gamepad 映射表

Chromium 的 Web Gamepad API 标准映射(`Standard Gamepad` layout):

| Steam 按钮 | Web Gamepad index.button |
|---|---|
| A | 0 |
| B | 1 |
| X | 2 |
| Y | 3 |
| L1 | 4 |
| R1 | 5 |
| L2(模拟) | axes[2] / buttons[6] |
| R2(模拟) | axes[5] / buttons[7] |
| Select / View | 8 |
| Start / Menu | 9 |
| 左摇杆按下 | 10 |
| 右摇杆按下 | 11 |
| 方向键上 | 12 |
| 方向键下 | 13 |
| 方向键左 | 14 |
| 方向键右 | 15 |
| Home | 16 |

如果云游戏网页用了非标准映射,在 Steam Input 里改即可。

---

## 6. 在终端验证手柄是否被识别

启动应用后,在终端跑:

```bash
# 列出所有 /dev/input/event*
ls -l /dev/input/event*

# 用 evtest 看具体哪个是手柄
sudo pacman -S evtest
sudo evtest
```

选 `/dev/input/eventN`(通常名字含 "Steam Controller" / "Xbox" / "Sony")。

如果看不到手柄设备:

- udev 规则未生效 → 重启或 `sudo udevadm trigger`
- 用户不在 input 组 → `sudo usermod -aG input $USER`,重登

---

## 7. 调试:F12 关闭手柄的副作用

**按 F12 后**:
- 云游戏网页的 `navigator.getGamepads()` 返回 `[]`
- 已连接的 gamepad 仍触发 `gamepadconnected` 事件,但读不到数据
- 页面 HUD 上的"手柄已连接"指示可能仍亮(无法控制)

**这是已知 trade-off**:要彻底屏蔽 Chromium 的手柄事件需要改 C++ 层,
Electron 不暴露这种 API。

如果云游戏因此检测不到手柄,请报告给我们,可以改用
"按 F12 时禁用 Steam Input 布局"(纯 Steam 端操作,不需要应用配合)。

---

## 8. 推荐配置:双布局切换

为了让滑块验证更顺滑,推荐:

### 控制器布局 A:"Cloud Gamepad"
- 用于正常游戏
- 标准 Gamepad 布局

### 控制器布局 B:"Touchpad Mouse"
- 用于滑块验证 / UI 操作
- 纯鼠标模式

### 切换方式

控制器设置 → 顶部布局选择器 → 用快捷键切换(可选 Quick Switch)。

或者更简单:**直接按 F12 关应用层手柄,然后用 Steam Input 的鼠标布局**。

---

## 下一步

- 出问题 → [`troubleshooting.md`](troubleshooting.md) - 特别是"手柄识别失败"章节
- Steam Deck 安装 → [`steam-deck-setup.md`](steam-deck-setup.md)
