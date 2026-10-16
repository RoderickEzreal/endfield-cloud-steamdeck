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

const { app, BrowserWindow, Menu, shell, session, ipcMain, dialog } = require('electron');
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

// Wayland / X11 自动选择(Steam Deck Gamescope 优先 Wayland)
// 注:'auto' 在 SteamOS 上会落到 XWayland + MIT-MAGIC-COOKIE-1 auth,导致无桌面 session 时启动失败。
//    强制 'wayland' 是 Steam Deck / SteamOS 3.x 的安全默认;非 Wayland 环境仍能通过 CLI --ozone-platform=x11 覆盖。
app.commandLine.appendSwitch('ozone-platform-hint', 'wayland');

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

// ============================================================
// Wayland socket 自适应(掌机模式 Gamescope 用 gamescope-0,
// 桌面模式 KWin 用 wayland-0)。Chromium ozone 直读 $WAYLAND_DISPLAY,
// 没设的话启动失败。这里在 app 启动前兜底探测。
// ============================================================
if (!process.env.WAYLAND_DISPLAY) {
  const fs = require('fs');
  const path = require('path');
  const xrd = process.env.XDG_RUNTIME_DIR || `/run/user/${process.getuid?.() || 0}`;
  const candidates = [];
  try {
    for (const name of fs.readdirSync(xrd)) {
      if (/^(wayland|gamescope)-\d+$/.test(name)) {
        candidates.push(name);
      }
    }
  } catch (_) { /* 目录不可读就跳 */ }
  // 优先 gamescope(掌机模式)
  candidates.sort((a, b) => (a.startsWith('gamescope') ? -1 : 1) - (b.startsWith('gamescope') ? -1 : 1));
  if (candidates.length > 0) {
    process.env.WAYLAND_DISPLAY = candidates[0];
    console.log(`[wayland] auto-detected: ${candidates[0]} (XDG_RUNTIME_DIR=${xrd})`);
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
  const { screen } = require('electron');

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
    width = Math.max(640, Math.min(wa.width, Math.round(wa.width * 0.75)));
    height = Math.max(480, Math.min(wa.height, Math.round(wa.height * 0.75)));
    console.log(`[window] auto-size: display=${wa.width}x${wa.height} → ${width}x${height}`);
  }

  mainWindow = new BrowserWindow({
    width,
    height,
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    title: 'Endfield Cloud',
    // 明确:窗口可调整大小(用户拖边框缩放)
    resizable: true,
    minWidth: 640,
    minHeight: 480,
    // Steam Deck Gamescope 下无边框窗口更稳(避免 steam Big Picture overlay 遮盖)
    frame: false,
    // Steam 识别窗口类名 — 让 Steam Input / 覆盖层能找到
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
    // 强制提到顶层 + 焦点(Gamescope 下有时被 Steam Big Picture 遮盖)
    mainWindow.setAlwaysOnTop(true);
    mainWindow.moveTop();
    mainWindow.focus();
    // 1 秒后取消 always-on-top,避免挡其它窗口
    setTimeout(() => mainWindow.setAlwaysOnTop(false), 1000);
  });

  // 持久化窗口大小
  mainWindow.on('resize', () => saveWindowState(mainWindow));
  mainWindow.on('move', () => saveWindowState(mainWindow));
  mainWindow.on('close', () => saveWindowState(mainWindow));

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
    }, 800);
  });

  // 外部链接默认浏览器打开(避免在游戏窗口里跳走)
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // 阻止页面内非主域导航
  mainWindow.webContents.on('will-navigate', (e, url) => {
    const target = new URL(url);
    const current = new URL(cliOpts.url);
    if (target.host !== current.host) {
      e.preventDefault();
      shell.openExternal(url);
    }
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

  // 设置 User-Agent 让服务器知道这是桌面浏览器
  session.defaultSession.setUserAgent(
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 ' +
    'EndfieldCloudClient/1.0'
  );

  // 允许 Web Gamepad(默认就是 true,这里显式声明)
  // Chromium 在 Linux 上读 /dev/input/event* 自动识别手柄

  const win = createMainWindow();
  registerShortcuts(win);
});

app.on('window-all-closed', () => {
  app.quit();
});

// ============================================================
// IPC — 接收 preload 端的请求
// ============================================================
ipcMain.handle('get-gamepad-state', () => gamepadMuted);

// 暴露给 preload 一个最小化的环境查询
ipcMain.handle('get-env', () => ({
  platform: process.platform,
  arch: process.arch,
  electron: process.versions.electron,
  chrome: process.versions.chrome,
  node: process.versions.node,
}));
