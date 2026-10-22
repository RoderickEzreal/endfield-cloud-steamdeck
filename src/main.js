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
const SHIM_PATH = path.join(__dirname, 'shim.js');

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
    'WebContentsForceDark',
  ].join(',')
);
// 注:原先这里有 'UseOzonePlatformWayland' —— 那是很早就被 Chromium 移除的 legacy
// feature 名,现在完全不起作用,留着只会误导人。删掉。

// ============================================================
// Ozone 平台选择 —— 强制 X11 / XWayland
// ============================================================
//
// 为什么必须钉死 x11(而不是 auto):
//
// 1) 掌机模式(Gamescope)
//    Gamescope 自称 Wayland 合成器,但**实际只能显示 X11/XWayland 应用**。
//    Chromium 的 Ozone/Wayland 后端在 Gamescope 下创建的 surface,Gamescope
//    渲染不出来 → "进程跑着、窗口不可见、Steam Big Picture 还在前面"。
//    (v1.0.7 的关键修复,参考 Cider issue #1447)
//
// 2) 桌面模式(KWin)—— 这一条更隐蔽,直接关系到"3D 鼠标"能不能用:
//    Chromium 的**原生 Wayland 指针锁定**实现在
//    chrome/browser/ui/views/frame/browser_desktop_window_tree_host_linux.cc,
//    那是 **Chrome 专用**类。Electron 走的是 views 层的
//    DesktopWindowTreeHostLinux,继承基类
//    `WindowTreeHost::SupportsMouseLock() { return false; }`。
//    → Electron 直到 v40.5.0(2026-02-19,electron/electron#49283)才有原生
//      Wayland pointer lock。在此之前,Chromium 会退回**软件锁**:
//      光标被隐藏,但只在靠近边缘 15% 时才回中,光标照样能跑出窗口 ——
//      正是"移动视角时鼠标会离开窗口"这个症状。
//    (electron/electron#49754 有视频复现,原文:"On wayland when the pointer
//     is locked the mouse only becomes hidden until it moves outside of the
//     window's bounds")
//    而 X11/XWayland 路径走的是 `cursor_client->LockCursor()` → 真正的
//    XGrabPointer 硬约束,光标**完全锁在窗口内**,mouse-look 才正常。
//
// 结论:本项目统一走 XWayland,两种模式行为一致,且指针锁定是硬约束。
//       将来若升级到 Electron ≥ 40.5.0 并且桌面端想用原生 Wayland,
//       再按模式分别放开(掌机模式仍必须 x11)。
//
// CLI 覆盖:--ozone-platform=wayland 可强行走原生 Wayland(仅供调试)。
app.commandLine.appendSwitch('ozone-platform-hint', 'x11');

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
      // 显式覆盖 --fullscreen(wrapper 会同时传两个,后出现的 --windowed 优先)
      out.fullscreen = false;
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
let pointerLocked = false;   // 渲染进程告知:当前是否处于指针锁定(3D 鼠标)状态
const cliOpts = parseCliArgs(process.argv.slice(1));

// ============================================================
// main world 兼容垫片注入
// ============================================================
//
// 必须在 main world 注入(contextIsolation=true 时 preload 是 isolated world,
// 改 Element.prototype / navigator 对页面不生效)。
// webContents.executeJavaScript 走的就是页面 main world。
//
// 垫片内容见 src/shim.js:
//   1) requestPointerLock 去掉 Linux 不支持的 unadjustedMovement(3D 鼠标修好的关键)
//   2) 派发 ef-pointerlock 事件上报锁定状态
//   3) navigator.getGamepads 覆写(F12 手柄静音)
let shimSource = null;

function getShimSource() {
  if (shimSource === null) {
    try {
      shimSource = fs.readFileSync(SHIM_PATH, 'utf8');
    } catch (e) {
      console.error('[shim] read failed:', e.message);
      shimSource = '';
    }
  }
  return shimSource;
}

function injectShim(win) {
  if (!win || win.isDestroyed()) return;
  const src = getShimSource();
  if (!src) return;
  win.webContents.executeJavaScript(src).then(
    (r) => console.log('[shim] injected ->', r),
    (e) => console.error('[shim] inject failed:', e.message)
  );
}

// ============================================================
// 诊断 IPC — 渲染进程(preload)把 pointer lock 现场日志送回主进程打印
// ============================================================

// preload(sandbox)读不到本地文件,用同步 IPC 取垫片源码
ipcMain.on('get-shim-source', (event) => {
  event.returnValue = getShimSource();
});

ipcMain.on('pointer-lock-state', (_event, locked, element) => {
  const next = locked === true;
  if (next !== pointerLocked) {
    console.log(`[pointer-lock] ${next ? 'LOCKED' : 'UNLOCKED'}${element ? ' on ' + element : ''}`);
  }
  pointerLocked = next;
});

ipcMain.on('pointer-lock-error', (_event, name, message) => {
  console.log(`[pointer-lock] ERROR: ${name || ''} ${message || ''}`.trim());
});

let lastFocusState = '';
ipcMain.on('renderer-focus-state', (_event, state) => {
  const key = `${state && state.hasFocus}|${state && state.visibility}`;
  if (key === lastFocusState) return;
  lastFocusState = key;
  console.log(`[renderer] hasFocus=${state && state.hasFocus} visibility=${state && state.visibility}`);
});

// 指针锁定请求被拒 → 把窗口焦点要回来(一次性,不循环抢)
//
// 为什么:Chromium 要求 requestPointerLock() 时窗口持有 OS 焦点。
// 掌机模式(Gamescope)/Steam 覆盖层都可能让窗口短暂失焦,
// 一旦失焦,锁定请求必然失败 → 视角模式进不去,光标还会跑出窗口。
// 这里只在"锁定请求失败"这个具体时刻补一次焦点,不做周期性抢焦点。
ipcMain.on('pointer-lock-failed', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isFocused()) {
    console.log('[pointer-lock] request failed but window already focused');
    return;
  }
  console.log('[pointer-lock] request failed -> restoring window focus, will retry');
  mainWindow.focus();
});

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

  // 注入 main world 垫片(每次导航都重来一次,垫片是 per-document 的)
  mainWindow.webContents.on('dom-ready', () => injectShim(mainWindow));

  // 页面 console 转发到终端 —— 定位问题时能直接看到页面自己的报错
  // (比如页面 catch 住的 requestPointerLock NotSupportedError)
  mainWindow.webContents.on('console-message', (...args) => {
    // Electron 33: (event, {level, message, lineNumber, sourceId})
    // 老签名:   (event, level, message, line, sourceId)
    let message = '';
    let sourceId = '';
    if (args[1] && typeof args[1] === 'object') {
      message = args[1].message || '';
      sourceId = args[1].sourceId || '';
    } else {
      message = String(args[2] ?? '');
      sourceId = String(args[4] ?? '');
    }
    // 只转发页面自己的日志,浏览器内部噪音过滤掉
    if (!/[ef-shim]/.test(message) && !/pointerlock|pointer lock/i.test(message)) return;
    console.log(`[page] ${message}${sourceId ? '  (' + String(sourceId).split('/').pop() + ')' : ''}`);
  });

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
    // 关键:Chromium 判定"能不能锁指针"看的是**渲染进程**的焦点
    // (RenderWidgetHostView::HasFocus),不是窗口的 toplevel 焦点。
    // BrowserWindow.focus() 只管后者,必须再补一发 webContents.focus()。
    mainWindow.webContents.focus();
  });

  // 窗口拿到焦点时,同步把焦点给渲染进程。
  // 掌机模式(Gamescope)/Steam 覆盖层都可能让渲染进程掉焦点,
  // 而掉焦点状态下 requestPointerLock() 必被拒 —— 视角模式就进不去。
  // 这是"跟随式"补焦点,不是周期性抢焦点。
  mainWindow.on('focus', () => {
    if (!mainWindow.isDestroyed()) mainWindow.webContents.focus();
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
  //
  // 关键修正(2026-10-21):之前这里 dispatch 了一个**不可信**的 MouseEvent + KeyboardEvent,
  //   · 不可信事件永远拿不到 transient activation —— 激活其实一直没生效
  //   · 但它**会真的冒到页面的 document 级监听器**。云终末地的 keydown 处理器
  //     收到这个假 Tab 就会去申请指针锁定,拿不到激活 → SecurityError,
  //     还会顺带触发游戏内的按键动作。
  // 现在改成 executeJavaScript(code, userGesture=true):
  //   第二个参数让这次执行**带用户手势**,Blink 会给 frame 记一次 transient activation,
  //   而且不再往页面里塞任何伪造的 DOM 事件。
  mainWindow.webContents.once('did-finish-load', () => {
    setTimeout(() => {
      mainWindow.webContents.executeJavaScript('void 0', true).then(
        () => console.log('[user-activation] granted (userGesture=true)'),
        (err) => console.error('[user-activation] failed:', err.message)
      );
    }, USER_ACTIVATION_DELAY_MS);
  });

  // 诊断:记录每个 frame 的导航(主 frame / 子 frame = iframe)
  // 云游戏页面若把本体放在 iframe 里,指针锁定受 iframe 的 allow/sandbox 约束
  mainWindow.webContents.on('did-frame-navigate', (_e, url, isMainFrame) => {
    console.log(`[frame] ${isMainFrame ? 'main' : 'sub '} ${String(url).slice(0, 180)}`);
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
        // ESC:退出全屏 / 退出指针锁定
        //
        // 指针锁定(3D 鼠标)状态下,ESC 是 Chromium 与游戏"退出视角锁定"的标准按键。
        // 如果这里 preventDefault 吃掉,渲染进程收不到 ESC,Chromium 的强制解锁也不触发
        // → 光标被永久困在画面里,只能杀进程。
        //
        // 锁定状态的权威来源是 main world 的 document.pointerLockElement
        // (isolated world 读到的可能不同步),所以这里直接问页面。
        if (pointerLocked) {
          // 快速路径:IPC 已知锁定 → 直接放行
          console.log('[shortcut] ESC passed through (pointer locked)');
          break;
        }
        if (win.isFullScreen()) {
          win.webContents.executeJavaScript('!!document.pointerLockElement').then(
            (locked) => {
              if (locked) {
                console.log('[shortcut] ESC passed through (pointer locked, queried)');
                return;
              }
              win.setFullScreen(false);
            },
            () => win.setFullScreen(false)
          );
        }
        break;
      case 'F5':
        // 刷新页面(忽略缓存 — 云游戏刷新经常需要)
        win.webContents.reloadIgnoringCache();
        event.preventDefault();
        break;
      case 'F12':
        // 开关手柄输入(滑块验证时关闭手柄,用触控板/鼠标)
        //
        // 静音标志必须写在 main world:contextIsolation=true 时 preload 在 isolated world,
        // 在那边覆写 navigator.getGamepads 对页面完全无效(F12 以前就是因此不生效)。
        // 覆写本体在 src/shim.js 里。
        gamepadMuted = !gamepadMuted;
        win.webContents.executeJavaScript(
          `window.__efGamepadMuted = ${gamepadMuted ? 'true' : 'false'};` +
          `console.log('[ef-shim] gamepad ${gamepadMuted ? 'MUTED' : 'ENABLED'}');`
        ).catch(() => { /* 页面还没加载完就忽略 */ });
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

  // 诊断:响应头里如果有 Permissions-Policy / Feature-Policy 限制 pointer-lock,
  // 页面调 requestPointerLock() 会直接被浏览器拒掉(报 SecurityError)。
  // 这里只打印,不修改。
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    try {
      const headers = details.responseHeaders || {};
      for (const key of Object.keys(headers)) {
        const lower = key.toLowerCase();
        if (lower.includes('permissions-policy') || lower.includes('feature-policy')) {
          console.log(`[headers] ${lower}: ${headers[key]}`);
        }
      }
    } catch (_) { /* ignore */ }
    callback({ responseHeaders: details.responseHeaders });
  });

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
