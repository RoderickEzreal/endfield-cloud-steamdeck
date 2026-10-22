'use strict';

/**
 * Endfield Cloud Client - Preload 脚本
 *
 * 职责(刻意保持很薄):
 *   1. 抢在页面脚本之前,把 main world 兼容垫片注入进去(见 src/shim.js)
 *   2. 把 main world 派发的指针锁定状态事件转发给主进程
 *
 * 为什么垫片要"抢时间"注入:
 *   云终末地网页端锁定鼠标时调用 element.requestPointerLock({unadjustedMovement:true})。
 *   unadjustedMovement(原始鼠标输入)在 Chromium 上只有 Windows/macOS 支持,
 *   Linux 上 promise 直接 reject NotSupportedError,而页面只 warn 不重试
 *   → 指针永远锁不上 → "3D 鼠标"模式进不去 + 光标跑出画面导致视角中断。
 *   垫片把该参数去掉,让浏览器按标准语义正常锁定。
 *
 * 为什么必须注入 main world:
 *   contextIsolation=true 时本脚本跑在 isolated world,
 *   isolated world 与 main world 各自持有独立的 Element.prototype / navigator,
 *   在这边打补丁对页面完全无效(以前的 F12 手柄静音就是这么失效的)。
 *
 * 安全约束:
 *   - 不向页面暴露任何 API(contextBridge.exposeInMainWorld 不使用)
 *   - 不暴露 Node API(fs / process)
 */

const { ipcRenderer, webFrame } = require('electron');

// ============================================================
// 1. 尽早注入 main world 垫片
// ============================================================
// webFrame.executeJavaScript 走页面 main world(要 isolated world 用
// executeJavaScriptInIsolatedWorld)。这里在 preload 阶段执行,早于页面自己的脚本。
//
// 垫片源码由主进程通过同步 IPC 提供 —— sandbox:true 的 preload 不能读本地文件。
let shimSource = '';
try {
  shimSource = ipcRenderer.sendSync('get-shim-source') || '';
} catch (err) {
  console.warn('[preload] failed to fetch shim source:', err && err.message);
}

if (shimSource) {
  try {
    const r = webFrame.executeJavaScript(shimSource);
    if (r && typeof r.then === 'function') {
      r.then(
        (v) => console.log('[preload] webFrame.executeJavaScript(shim) ->', v),
        (e) => console.warn('[preload] webFrame shim failed:', e && e.message)
      );
    }
  } catch (err) {
    console.warn('[preload] webFrame.executeJavaScript threw:', err && err.message);
  }
} else {
  console.warn('[preload] no shim source available');
}

// 自检:webFrame.executeJavaScript 到底落在哪个 world?
// 若 main world 注入成功,主进程在 dom-ready 时还会再注入一次(幂等),
// 这里只负责回报观测结果。
setTimeout(() => {
  try {
    console.log(
      '[preload] shim visible in this world?',
      typeof window.__efShim !== 'undefined',
      '| this world =', typeof window.__efShimInstalled !== 'undefined' ? 'isolated' : 'main'
    );
  } catch (err) {
    console.warn('[preload] world self-check failed:', err && err.message);
  }
}, 600);

// ============================================================
// 2. 转发指针锁定状态
// ============================================================
// 垫片在 main world 里监听 pointerlockchange,并派发 document 上的
// 'ef-pointerlock' CustomEvent。DOM 事件在两个 world 之间可见,
// 这里把它转成 IPC 给主进程(主进程据此知道当前是不是锁定状态)。
document.addEventListener('ef-pointerlock', (event) => {
  const detail = (event && event.detail) || {};
  try {
    ipcRenderer.send('pointer-lock-state', detail.locked === true, detail.element || null);
  } catch (_) { /* ignore */ }
});

document.addEventListener('ef-pointerlockerror', (event) => {
  const detail = (event && event.detail) || {};
  try {
    ipcRenderer.send('pointer-lock-error', detail.name || '', detail.message || '');
    // 锁定失败多半是窗口没拿到 OS 焦点 —— 让主进程把焦点要回来。
    // 页面下一次 keydown / mouseenter 会重新发起锁定请求,那时就能成功。
    ipcRenderer.send('pointer-lock-failed');
  } catch (_) { /* ignore */ }
});

// ============================================================
// 3. 焦点 / 可见性诊断
// ============================================================
// Chromium 判定"能不能锁指针"看渲染进程的 HasFocus(),
// 这里定期回报,便于确认窗口是不是真的拿到了焦点。
setInterval(() => {
  try {
    ipcRenderer.send('renderer-focus-state', {
      hasFocus: document.hasFocus(),
      visibility: document.visibilityState,
    });
  } catch (_) { /* ignore */ }
}, 3000);
