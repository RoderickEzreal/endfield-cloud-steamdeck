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

Object.defineProperty(navigator, 'getGamepads', {
  configurable: true,
  enumerable: true,
  writable: false,
  value: function getGamepads() {
    if (gamepadMuted) return [];
    return _nativeGetGamepads();
  },
});

// ============================================================
// 暴露给渲染进程的最小 API(都是只读)
// ============================================================
contextBridge.exposeInMainWorld('endfieldClient', {
  /**
   * 查询当前手柄是否静音
   * @returns {Promise<boolean>}
   */
  getGamepadMuted: () => ipcRenderer.invoke('get-gamepad-state'),

  /**
   * 查询运行环境(版本号等诊断信息)
   * @returns {Promise<{platform: string, arch: string, electron: string, chrome: string, node: string}>}
   */
  getEnv: () => ipcRenderer.invoke('get-env'),
});
