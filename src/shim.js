// ============================================================
// Endfield Cloud Client — main world 兼容垫片
// ============================================================
//
// 用途:本文件由主进程读取,以字符串形式注入到页面的 **main world** 执行。
//       必须是 main world —— contextIsolation=true 时,preload 所在的是
//       isolated world,两边的 Element.prototype / navigator 是各自 realm 的,
//       在 preload 里打补丁对页面完全无效。
//
// 背景(2026-10-21 定位):
//   云终末地网页端锁定鼠标时调用
//       element.requestPointerLock({ unadjustedMovement: true })
//   `unadjustedMovement`(原始鼠标输入)在 Chromium 上**只有 Windows/macOS 支持**,
//   Linux 上整个 promise 直接 reject NotSupportedError。
//   页面侧只有 `.catch(e => warn(e))`,没有任何 fallback,
//   于是 pointer lock 永远拿不到:
//     · document.pointerLockElement 恒为 null → 页面的"3D 鼠标"标志恒为 false
//     · 光标不受约束,移出 <video> 触发 mouseleave → 页面发 blur → 视角控制中断
//
//   本垫片只做一件事:调用 requestPointerLock 时把该平台不支持的可选参数去掉,
//   并在 NotSupportedError 时用无参方式重试一次。
//   属于浏览器平台兼容补丁(等同 UA 覆盖 / polyfill),
//   不修改游戏逻辑、不绕登录、不碰任何游戏数据或协议。
//
// 附带:F12 手柄静音(同样必须落在 main world,否则 navigator.getGamepads 覆写无效)。
//
// 幂等:重复注入直接返回 'already'。
// ============================================================

(() => {
  if (window.__efShimInstalled) return 'already';
  window.__efShimInstalled = true;

  const log = (...args) => {
    try {
      console.log('[ef-shim]', ...args);
    } catch (_) { /* ignore */ }
  };

  const NOT_SUPPORTED = 'NotSupportedError';

  // ------------------------------------------------------------
  // 1. Pointer Lock —— 去掉平台不支持的 unadjustedMovement
  // ------------------------------------------------------------
  const origLock = Element.prototype.requestPointerLock;

  if (typeof origLock === 'function' && !origLock.__efPatched) {
    const plainRetry = (self) => origLock.call(self);

    const patched = function requestPointerLockShim(options) {
      const self = this;
      let opts = options;
      let stripped = false;

      // options 是字典 → 复制一份并剔除 unadjustedMovement
      if (options && typeof options === 'object') {
        opts = {};
        for (const key of Object.keys(options)) {
          if (key === 'unadjustedMovement') {
            stripped = true;
            continue;
          }
          opts[key] = options[key];
        }
        // 没有 unadjustedMovement 就不必复制,保持原样(包括 undefined / 旧式字符串参数)
        if (!stripped) opts = options;
      }

      if (stripped) {
        log('requestPointerLock: dropping unadjustedMovement (unsupported on this platform)');
      }

      let promise;
      try {
        promise = origLock.call(self, opts);
      } catch (err) {
        // 老浏览器 / 老实现可能同步抛
        if (err && err.name === NOT_SUPPORTED) {
          log('requestPointerLock: sync NotSupportedError, retrying without options');
          return plainRetry(self);
        }
        throw err;
      }

      if (promise && typeof promise.catch === 'function') {
        return promise.catch((err) => {
          if (err && err.name === NOT_SUPPORTED) {
            log('requestPointerLock: NotSupportedError, retrying without options');
            return plainRetry(self);
          }
          log('requestPointerLock failed:', err && err.name, err && err.message);
          reportError(err);
          throw err;
        });
      }
      return promise;
    };

    patched.__efPatched = true;
    Element.prototype.requestPointerLock = patched;
  }

  // ------------------------------------------------------------
  // 2. 上报指针锁定状态(主进程据此决定 ESC 是"退出全屏"还是"放行给页面")
  // ------------------------------------------------------------
  const report = () => {
    const el = document.pointerLockElement;
    const detail = {
      locked: !!el,
      element: el ? (el.tagName + (el.id ? '#' + el.id : '')) : null,
    };
    // 派发到 document —— 事件在 main world 与 isolated world 之间可见,
    // preload 侧靠它把状态同步给主进程。
    try {
      document.dispatchEvent(new CustomEvent('ef-pointerlock', { detail }));
    } catch (_) { /* ignore */ }
    log('pointerlock state:', detail.locked, detail.element);
  };

  // 指针锁定失败的真实原因只在 promise rejection 里(pointerlockerror 事件本身没 message),
  // 这里把错误详情带出去。
  const reportError = (err) => {
    const detail = {
      name: (err && err.name) || 'Error',
      // 注意用 ?? 而不是 ||:err.message 可能是空字符串,
      // 用 || 会短路到 String(err) → 日志里变成 "[object Object]"
      message: (err && err.message !== undefined && err.message !== null)
        ? String(err.message)
        : String(err),
    };
    try {
      document.dispatchEvent(new CustomEvent('ef-pointerlockerror', { detail }));
    } catch (_) { /* ignore */ }
  };

  document.addEventListener('pointerlockchange', report);
  document.addEventListener('pointerlockerror', (event) => {
    reportError({ name: 'PointerLockError', message: (event && event.message) || '' });
    log('pointerlockerror:', event && event.message);
  });

  // ------------------------------------------------------------
  // 3. F12 手柄静音(必须在 main world 覆写 navigator.getGamepads 才有效)
  // ------------------------------------------------------------
  const nativeGetGamepads = navigator.getGamepads
    ? navigator.getGamepads.bind(navigator)
    : () => [];

  window.__efGamepadMuted = false;

  try {
    Object.defineProperty(navigator, 'getGamepads', {
      configurable: true,
      enumerable: true,
      writable: false,
      value: function getGamepads() {
        if (window.__efGamepadMuted) return [];
        return nativeGetGamepads();
      },
    });
    log('getGamepads override installed');
  } catch (err) {
    log('getGamepads override failed:', err && err.message);
  }

  // 给主进程 / 探针用的自检入口
  window.__efShim = {
    version: 1,
    pointerLockPatched: !!(Element.prototype.requestPointerLock &&
      Element.prototype.requestPointerLock.__efPatched),
    // 未打补丁的原生实现 —— 探针用它复现"不传 unadjustedMovement 之外的原始行为"
    origRequestPointerLock: origLock,
    lockState: () => {
      const el = document.pointerLockElement;
      return {
        locked: !!el,
        element: el ? (el.tagName + (el.id ? '#' + el.id : '')) : null,
        hasFocus: document.hasFocus(),
        visibility: document.visibilityState,
      };
    },
    setGamepadMuted: (v) => { window.__efGamepadMuted = !!v; },
  };

  log('installed');
  return 'installed';
})();
