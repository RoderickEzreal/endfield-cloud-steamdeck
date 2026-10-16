# 如何把 Endfield Cloud Client 加进 Steam 库

> 把应用加进 Steam 库后,你可以:
> - 在 Steam Deck **游戏模式**下像原生游戏一样启动
> - 用 Steam Overlay 截图、调音量、切桌面
> - 配合 Steam Input 自定义手柄布局

---

## 方法 1:Steam UI 手动添加(最稳)

### 步骤

1. 打开 Steam(桌面模式或游戏模式都行)
2. 左上角 **游戏 → 在库中添加非 Steam 的游戏...**
   - 中文 Steam:游戏 → 添加非 Steam 游戏 → 添加
3. 点击 **浏览...**,找到 AppImage:
   ```
   /home/deck/endfield-cloud-client/dist/endfield-cloud-client-1.0.0.AppImage
   ```
4. 选中 → **添加选定程序**
5. Steam 会问"是否添加到 Steam",选**是**

### 完成

库列表会出现"Endfield Cloud",右键 → 属性可改:

- **名称**:"终末地云" / "Endfield Cloud" 随你
- **目标**:`/home/deck/endfield-cloud-client/dist/endfield-cloud-client-1.0.0.AppImage`
- **启动选项**:留空
- **启动目录**:`/home/deck/endfield-cloud-client/dist/`

---

## 方法 2:脚本一键添加

```bash
./scripts/steam-add.sh dist/endfield-cloud-client-1.0.0.AppImage
```

脚本会自动:

1. 定位 `localconfig.vdf`(Steam 用户配置)
2. 备份原文件(`*.backup.YYYYMMDD-HHMMSS`)
3. 注入新的 Shortcut 条目
4. 检测 Steam 是否在运行,**强制要求先关 Steam**

如果脚本说"找不到 Shortcuts 块",说明 Steam 版本特殊,
请用**方法 1**(手动添加)。

---

## 方法 3:命令行 steam-shortcuts 工具

如果你偏好纯 CLI:

```bash
# 安装第三方工具
yay -S steam-shortcuts

# 添加
steam-shortcuts add \
  --appname "Endfield Cloud" \
  --exe "/home/deck/endfield-cloud-client/dist/endfield-cloud-client-1.0.0.AppImage" \
  --workdir "/home/deck/endfield-cloud-client/dist" \
  --icon "/home/deck/endfield-cloud-client/resources/icons/512x512.png"
```

---

## 加完后配置

加进 Steam 后,建议改这几项:

### 兼容性(若 AppImage 启动失败)

右键 → 属性 → 兼容性 → 勾选"强制使用特定 Steam Play 兼容性工具":
- 选 `Steam Linux Runtime - Soldier`(最稳)

### 启动参数

右键 → 属性 → 启动选项:

```
--window-size=1280x800
```

或加些常用 flag:

```
--window-size=1280x800 --enable-features=Vulkan
```

### Steam Input 配置

见 [`steam-input-config.md`](steam-input-config.md)

---

## 游戏模式下启动

加完 Steam 库后:

1. 退出桌面模式(Steam → 电源 → 切换到游戏模式)
2. 在游戏库里找"Endfield Cloud"
3. 点击启动

Steam Deck 会用 Gamescope 显示该窗口,
分辨率自适应屏幕(1280×800)。

---

## 故障排查

### 添加后 Steam 不显示

- 确认 Steam 完全关闭(右上角退出,不只关窗口)
- 重新打开 Steam,等库刷新

### 添加后启动闪退

- 打开 `.AppImage` 直接在终端跑,看错误信息
- 可能原因:缺运行时依赖 → 跑 `install-deps-arch.sh --runtime`
- 可能原因:AppImage 不可执行 → `chmod +x ...AppImage`

### Steam Input 不识别

- 启动应用 → Steam 控制器设置 → "检测到的控制器支持"
- 选 **强制启用**

### 滑块验证无法操作

- 启动应用 → F12 临时关闭手柄 → 用触控板 / 鼠标完成
- 完成后再按 F12 恢复
