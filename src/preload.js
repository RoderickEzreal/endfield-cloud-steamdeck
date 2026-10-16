'use strict';

/**
 * Endfield Cloud Client - Preload 脚本
 *
 * 在主进程与渲染进程之间架一道窄桥:
 * - 暴露最小化的 IPC 接口(只读环境信息 + 手柄状态查询)
 * - 注入 navigator.getGamepads 拦截,实现 F12 手柄静音
 *
 * 安全约束:
 * - contextIsolation: true(与渲染进程隔离)
 * - 不暴露 Node API,不暴露 fs/process
 */

const { contextBridge, ipcRenderer } = require('electron');

// ============================================================
// 手柄静音状态 — 由主进程通过 IPC 通知切换
// ============================================================
let gamepadMuted = false;
ipcRenderer.on('toggle-gamepad', (_event, muted) => {
  gamepadMuted = muted === true;
  console.log(`[preload] gamepad ${gamepadMuted ? 'MUTED' : 'ENABLED'}`);
});

// ============================================================
// 拦截 navigator.getGamepads — F12 静音时返回空数组
// ============================================================
// Chromium 的 Web Gamepad API 由 navigator.getGamepads() 驱动。
// 云游戏页面通常每帧调用它读取手柄状态。静音时返回 [] 即让页面"看不到手柄"。
// 注意:gamepadconnected/gamepaddisconnected 事件仍会触发,但页面取不到具体数据也没用。
const _nativeGetGamepads = navigator.getGamepads
  ? navigator.getGamepads.bind(navigator)
  : () => [];

// defineProperty 可能失败(若 navigator.getGamepads 不可配置),
// try/catch 保护,失败就静默退回到原生(无静音功能,但不阻断启动)
try {
  Object.defineProperty(navigator, 'getGamepads', {
    configurable: true,
    enumerable: true,
    writable: false,
    value: function getGamepads() {
      if (gamepadMuted) return [];
      return _nativeGetGamepads();
    },
  });
} catch (err) {
  console.warn('[preload] failed to override navigator.getGamepads:', err.message);
}

// 注:contextBridge.exposeInMainWorld 不再暴露任何 API。
// 渲染进程(cloud game page)是第三方页面,我们不主动暴露任何东西给它,
// 只通过 navigator.getGamepads 拦截实现 F12 静音。
// 如果未来需要页面主动查询状态,可加回 exposeInMainWorld,但目前不需要。
