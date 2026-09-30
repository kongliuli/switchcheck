'use strict';

// Shared display labels — one source for the Electron renderer (via
// <script>) and the HTML report renderer (via require). UMD on purpose.

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SC_LABELS = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  return {
    STATUS_ZH: { red: '阻塞', yellow: '需确认', green: '可用', info: '说明' },
    STATUS_ORDER: { red: 0, yellow: 1, green: 2, info: 3 },
    VERDICT_ICON: { red: '🚫', yellow: '⚠️', green: '✅' },
    VERDICT_ZH: {
      red: '未就绪 — 存在阻塞项',
      yellow: '基本可用 — 有项目需要确认',
      green: '可以切换',
    },
    KIND_ZH: { linux: 'Windows → Linux 迁移', ci: 'CI → Ubuntu 26.04', runtime: '运行时 EOL' },
    KIND_ICON: { linux: '🐧', ci: '⚙️', runtime: '⏱️' },
    SECTION_ZH: {
      Applications: '应用软件',
      'Steam games': 'Steam 游戏',
      Hardware: '硬件',
      Printers: '打印机',
      'Rollout timeline': '上线时间线',
    },
  };
});
