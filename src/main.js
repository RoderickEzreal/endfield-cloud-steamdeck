'use strict';

/**
 * Endfield Cloud Client - Electron 主进程
 *
 * 角色:Chromium 内核封装壳。
 * 职责:加载官方云游戏页面 + 转发系统手柄事件 + 持久化 Cookie 会话。
 * 禁止:不修改、不破解、不绕过鹰角登录校验;不抓包、不篡改游戏数据。
 *
 * 运行平台:Arch Linux (Steam Deck 原生系统)
 * 技术栈:Electron (Chromium 内核)
 */

const { app, BrowserWindow, Menu, shell, session, ipcMain, screen } = require('electron');
const path = require('path');
const fs = require('fs');

// ============================================================
// 单实例锁 — 防止重复启动占用手柄资源
// ============================================================
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}

// ============================================================
// 常量
// ============================================================
const GAME_URL = 'https://endfield.hypergryph.com/cloud';
const DEFAULT_WIDTH = 1280;   // Steam Deck 原生分辨率
const DEFAULT_HEIGHT = 800;
const MIN_WIDTH = 640;
const MIN_HEIGHT = 480;
const AUTO_SIZE_RATIO = 0.75; // 主显示器工作区 75%(首启动默认尺寸)
const USER_ACTIVATION_DELAY_MS = 800;
const WINDOW_STATE_SAVE_DEBOUNCE_MS = 500;
const CONFIG_DIR = app.getPath('userData');
const CONFIG_PATH = path.join(CONFIG_DIR, 'window-state.json');

// ============================================================
// Chromium 命令行开关 — 针对 Steam Deck (AMD Van Gogh APU) 优化
// ============================================================

// GPU / Vulkan / 视频硬件加速
app.commandLine.appendSwitch(
  'enable-features',
  [
    'Vulkan',
    'VaapiVideoDecoder',
    'VaapiIgnoreDriverChecks',
    'WebRTCPipewireSupport',
    'GamepadExtensionsChromium',
    'UseOzonePlatformWayland',
    'WebContentsForceDark',
  ].join(',')
);

// Ozone 平台选择
//
// 关键认知(2026-10-16 实测,基于 Cider issue #1447 同款问题):
//   Gamescope 自称 Wayland 合成器,但**实际只能显示 X11/XWayland 应用**。
//   Electron/Chromium 的 Ozone/Wayland 后端在 Gamescope 下创建的 surface,
//   Gamescope 渲染不出来 → "进程跑着、窗口不可见、Steam Big Picture 还在前面"。
//   修复:Chromium 在 Gamescope 下应走 XWayland,不要 Wayland。
//
//   桌面模式 KWin:Chromium 走 Wayland(hint=auto 会优先 Wayland)
//   掌机模式 Gamescope:Chromium 必须走 X11(hint=auto 会落到 XWayland)
//
// 用 'auto' 让 Chromium 自己判断,两种 mode 都 OK。
// CLI 覆盖:--ozone-platform=wayland 或 --ozone-platform=x11
app.commandLine.appendSwitch('ozone-platform-hint', 'auto');

// GPU 栅格化 + 零拷贝
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');

// 性能优化 — 减少后台节流
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

// 关闭不必要功能 — 降低 CPU/内存占用
app.commandLine.appendSwitch('disable-extensions');
app.commandLine.appendSwitch('disable-default-apps');
app.commandLine.appendSwitch('disable-component-update');
app.commandLine.appendSwitch('disable-domain-reliability');
app.commandLine.appendSwitch('disable-breakpad');
app.commandLine.appendSwitch('disable-sync');
app.commandLine.appendSwitch('disable-translate');
app.commandLine.appendSwitch('no-pings');
app.commandLine.appendSwitch('no-first-run');

// 强制不走任何代理。
// 原因:SteamOS / KDE Plasma 菜单启动器(走 foreground_booster → systemd transient service)
//      会带入 HTTP_PROXY / HTTPS_PROXY,导致云游戏 CDN SSL 握手失败(ERR_CONNECTION_CLOSED,页面黑屏)。
//      云游戏本身走 WebRTC(直 UDP),代理无效,反而会卡握手。
// 覆盖方式:CLI 传 --proxy-server=... 仍可启用。
app.commandLine.appendSwitch('no-proxy-server');
process.env.HTTP_PROXY = process.env.HTTPS_PROXY = process.env.http_proxy = process.env.https_proxy = '';

// 注:Wayland socket 自适应(掌机模式 Gamescope 用 gamescope-0,桌面模式 KWin 用 wayland-0)
// 已在 wrapper 脚本(launch-steamdeck.sh)里探测并设置 WAYLAND_DISPLAY,
// 这里不再重复,避免双源真相不一致。
// 直接执行 AppImage 时如果没有 wrapper,WAYLAND_DISPLAY 没设,Chromium 会回落到 XWayland,
// 桌面 KWin 下也能渲染,只是用 X11 路径。

// ============================================================
// Wayland socket 自适应(掌机模式 Gamescope 用 gamescope-0,
// 桌面模式 KWin 用 wayland-0)。Chromium ozone 直读 $WAYLAND_DISPLAY,
// 没设的话启动失败。这里在 app 启动前兜底探测(只在 wrapper 没设时执行)。
// ============================================================
if (!process.env.WAYLAND_DISPLAY && process.platform === 'linux') {
  const xrd = process.env.XDG_RUNTIME_DIR || `/run/user/${process.getuid?.() || 0}`;
  const candidates = [];
  try {
    for (const name of fs.readdirSync(xrd)) {
      if (/^(wayland|gamescope)-\d+$/.test(name)) {
        candidates.push(name);
      }
    }
  } catch (_) { /* 目录不可读就跳 */ }
  // 优先 gamescope(掌机模式),其次 wayland
  const gamescopeSock = candidates.find((n) => n.startsWith('gamescope'));
  const waylandSock = candidates.find((n) => n.startsWith('wayland'));
  const picked = gamescopeSock || waylandSock;
  if (picked) {
    process.env.WAYLAND_DISPLAY = picked;
    console.log(`[wayland] auto-detected: ${picked} (XDG_RUNTIME_DIR=${xrd})`);
  }
}

// ============================================================
// CLI 参数解析
// ============================================================
function parseCliArgs(argv) {
  const out = {
    url: GAME_URL,
    width: null,         // null = 自动检测(显示 75%)
    height: null,
    fullscreen: false,
    windowMode: null,    // 'auto' | 'fullscreen' | 'windowed'
  };
  for (const arg of argv) {
    if (arg.startsWith('--url=')) {
      out.url = arg.slice('--url='.length);
    } else if (arg.startsWith('--window-size=')) {
      const m = arg.slice('--window-size='.length).match(/^(\d+)x(\d+)$/);
      if (m) {
        out.width = parseInt(m[1], 10);
        out.height = parseInt(m[2], 10);
      }
    } else if (arg === '--fullscreen') {
      out.fullscreen = true;
    } else if (arg === '--windowed') {
      out.windowMode = 'windowed';
    } else if (arg === '--window-mode=fullscreen') {
      out.windowMode = 'fullscreen';
    } else if (arg.startsWith('--window-mode=')) {
      out.windowMode = arg.slice('--window-mode='.length);
    }
  }
  return out;
}

// ============================================================
// 窗口状态持久化(尺寸 + 全屏)
// ============================================================
function loadWindowState() {
  try {
    const data = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    return {
      width: Number.isInteger(data.width) && data.width >= 640 ? data.width : DEFAULT_WIDTH,
      height: Number.isInteger(data.height) && data.height >= 480 ? data.height : DEFAULT_HEIGHT,
      fullscreen: data.fullscreen === true,
    };
  } catch (e) {
    return { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT, fullscreen: false };
  }
}

function saveWindowState(win) {
  if (!win || win.isDestroyed()) return;
  try {
    const bounds = win.getBounds();
    const state = {
      width: bounds.width,
      height: bounds.height,
      fullscreen: win.isFullScreen(),
    };
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(state, null, 2));
  } catch (e) {
    console.error('[window-state] save failed:', e.message);
  }
}

// ============================================================
// 应用状态
// ============================================================
let mainWindow = null;
let gamepadMuted = false;
const cliOpts = parseCliArgs(process.argv.slice(1));

// ============================================================
// 主窗口创建
// ============================================================
function createMainWindow() {
  const state = loadWindowState();

  // 决定初始窗口尺寸:
  //   1) CLI 显式 --window-size  → 用 CLI
  //   2) 上次保存的窗口大小       → 用 state
  //   3) 否则                     → 主显示器工作区 75%(适配外接显示器 / 掌机屏)
  let width, height;
  if (cliOpts.width && cliOpts.height) {
    width = cliOpts.width;
    height = cliOpts.height;
  } else if (state.width && state.height) {
    width = state.width;
    height = state.height;
  } else {
    const display = screen.getPrimaryDisplay();
    const wa = display.workAreaSize;
    width = Math.max(MIN_WIDTH, Math.min(wa.width, Math.round(wa.width * AUTO_SIZE_RATIO)));
    height = Math.max(MIN_HEIGHT, Math.min(wa.height, Math.round(wa.height * AUTO_SIZE_RATIO)));
    console.log(`[window] auto-size: display=${wa.width}x${wa.height} → ${width}x${height}`);
  }

  mainWindow = new BrowserWindow({
    width,
    height,
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    title: 'Endfield Cloud',
    resizable: true,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    frame: process.platform !== 'linux', // Linux 默认无边框;其他平台有标题栏
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      // 允许自动播放(云游戏流媒体需要)
      autoplayPolicy: 'no-user-gesture-required',
      // Web Gamepad API 默认启用;Linux 上自动读 /dev/input/event*
      spellcheck: false,
    },
    show: false, // ready-to-show 时再显示,避免白屏
  });

  // 加载云游戏页面
  mainWindow.loadURL(cliOpts.url);

  // 准备就绪后显示
  mainWindow.once('ready-to-show', () => {
    const wantFullscreen =
      cliOpts.fullscreen ||
      (cliOpts.windowMode === 'fullscreen') ||
      (cliOpts.windowMode === null && state.fullscreen);
    if (wantFullscreen) {
      mainWindow.setFullScreen(true);
    }
    mainWindow.show();
    mainWindow.focus();
  });

  // 持久化窗口大小 — resize/move 触发频繁,debounce 避免每帧写盘
  let saveTimer = null;
  const scheduleSave = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      saveWindowState(mainWindow);
    }, WINDOW_STATE_SAVE_DEBOUNCE_MS);
  };
  mainWindow.on('resize', scheduleSave);
  mainWindow.on('move', scheduleSave);
  mainWindow.on('close', () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveWindowState(mainWindow);
  });

  // 注入合成 user activation,让 Chromium 立刻激活 Web Gamepad / Web Audio
  // 根因:Chromium 默认要求用户先有点击/键盘才轮询 getGamepads,云游戏页面没激活就不轮询
  mainWindow.webContents.once('did-finish-load', () => {
    setTimeout(() => {
      mainWindow.webContents.executeJavaScript(`
        (() => {
          // 模拟一次用户激活(不冒泡到 UI,只触发内部激活状态)
          const ev = new MouseEvent('click', {
            bubbles: false, cancelable: true, view: window,
            button: 0, buttons: 0, clientX: 0, clientY: 0
          });
          document.dispatchEvent(ev);
          // 顺手给个键盘激活(WebRTC / Web Audio 也要)
          const kev = new KeyboardEvent('keydown', { bubbles: false, key: 'Tab' });
          document.dispatchEvent(kev);
        })();
      `).catch((err) => console.error('[user-activation] failed:', err.message));
    }, USER_ACTIVATION_DELAY_MS);
  });

  // 外部链接默认浏览器打开(避免在游戏窗口里跳走)
  // 白名单:只允许 http/https,其它协议拒绝
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        shell.openExternal(url);
      } else {
        console.warn('[openExternal] blocked non-http(s):', url);
      }
    } catch (_) {
      console.warn('[openExternal] invalid url:', url);
    }
    return { action: 'deny' };
  });

  // 阻止页面内非主域导航(白名单:同 host 才允许)
  mainWindow.webContents.on('will-navigate', (e, url) => {
    try {
      const target = new URL(url);
      const current = new URL(cliOpts.url);
      if (target.host !== current.host) {
        e.preventDefault();
        // 同白名单约束
        if (target.protocol === 'http:' || target.protocol === 'https:') {
          shell.openExternal(url);
        }
      }
    } catch (_) { /* 解析失败忽略 */ }
  });

  return mainWindow;
}

// ============================================================
// 全局快捷键 — F11 / ESC / F5 / F12
// ============================================================
function registerShortcuts(win) {
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;

    // Ctrl/Alt/Cmd 修饰键:
    //   input.meta = Cmd(macOS) / Super(Linux)
    //   input.control = Ctrl
    //   input.alt = Alt
    //   input.shift = Shift
    const ctrlOrMeta = !!(input.control || input.meta);

    switch (input.key) {
      case 'F11':
        // 无边框全屏切换
        win.setFullScreen(!win.isFullScreen());
        event.preventDefault();
        break;
      case 'Escape':
        // 退出全屏
        if (win.isFullScreen()) {
          win.setFullScreen(false);
          event.preventDefault();
        }
        break;
      case 'F5':
        // 刷新页面(忽略缓存 — 云游戏刷新经常需要)
        win.webContents.reloadIgnoringCache();
        event.preventDefault();
        break;
      case 'F12':
        // 开关手柄输入(滑块验证时关闭手柄,用触控板/鼠标)
        gamepadMuted = !gamepadMuted;
        win.webContents.send('toggle-gamepad', gamepadMuted);
        console.log(`[gamepad] ${gamepadMuted ? 'MUTED' : 'ENABLED'}`);
        event.preventDefault();
        break;
      case 'q':
      case 'Q':
        // Ctrl+Q / Cmd+Q → 退出应用
        if (ctrlOrMeta) {
          console.log('[quit] Ctrl+Q');
          app.quit();
          event.preventDefault();
        }
        break;
      case 'F4':
        // Alt+F4 → 退出
        if (input.alt) {
          console.log('[quit] Alt+F4');
          app.quit();
          event.preventDefault();
        }
        break;
    }
  });
}

// ============================================================
// 应用生命周期
// ============================================================
app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
  }
});

app.whenReady().then(() => {
  // 隐藏默认菜单栏(全屏游戏不需要)
  Menu.setApplicationMenu(null);

  // 设置 User-Agent 让服务器知道这是桌面浏览器,带版本号便于服务器端日志识别
  session.defaultSession.setUserAgent(
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 ' +
    `EndfieldCloudClient/${app.getVersion()}`
  );

  const win = createMainWindow();
  registerShortcuts(win);
});

app.on('window-all-closed', () => {
  app.quit();
});

// 注:IPC handlers 在 main.js 不需要。
// 手柄静音靠 preload 直接拦截 navigator.getGamepads,主进程只通过
// webContents.send('toggle-gamepad') 通知 preload。
// 任何渲染进程拿不到 Node API(env/version 都通过 process.versions 在主进程,不必暴露)。
