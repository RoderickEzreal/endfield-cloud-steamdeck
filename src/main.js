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
// CLI 参数解析
// ============================================================
function parseCliArgs(argv) {
  const out = { url: GAME_URL, width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT, fullscreen: false };
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
  const width = cliOpts.width !== DEFAULT_WIDTH ? cliOpts.width : state.width;
  const height = cliOpts.height !== DEFAULT_HEIGHT ? cliOpts.height : state.height;

  mainWindow = new BrowserWindow({
    width,
    height,
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    title: 'Endfield Cloud',
    // Steam 识别窗口类名 — 让 Steam Input / 覆盖层能找到
    // 实际类名由 package.json "name" 字段决定(electron-builder 打包后)
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
    if (cliOpts.fullscreen || state.fullscreen) {
      mainWindow.setFullScreen(true);
    }
    mainWindow.show();
  });

  // 持久化窗口大小
  mainWindow.on('resize', () => saveWindowState(mainWindow));
  mainWindow.on('move', () => saveWindowState(mainWindow));
  mainWindow.on('close', () => saveWindowState(mainWindow));

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
