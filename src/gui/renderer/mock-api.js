'use strict';

// Browser-preview mock of the Electron bridge. In Electron, preload.js
// defines window.api and this file does nothing. Opening index.html in a
// plain browser installs a mock so the UI can be previewed and tested
// without the app shell.

if (!window.api) {
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  const SAMPLE_LINUX = {
    ok: true,
    kind: 'linux',
    host: 'OFFICE-PC',
    title: 'Windows → Linux 迁移体检 — OFFICE-PC',
    sections: [
      {
        name: 'Applications',
        findings: [
          { status: 'yellow', title: 'WeChat (微信) (3.9.12)', detail: 'No official Linux build of the Windows client; newer WeChat ships a Linux beta.', advice: 'Use WeChat for Linux (beta) or the web version.', url: 'https://linux.weixin.qq.com/' },
          { status: 'green', title: 'WPS Office (12.1)', detail: 'Vendor ships a native Linux version.', advice: '' },
          { status: 'red', title: '航天信息 税控开票软件 (V3.0)', detail: 'Tax-control invoicing relies on Windows-only USB drivers and ActiveX controls.', advice: 'No viable path on Linux — keep a Windows machine/VM for invoicing.', url: 'https://flathub.org/' },
          { status: 'yellow', title: 'Google Chrome (126.0)', detail: 'Chromium-based browsers are first-class on Linux.', advice: 'Install Chrome for Linux or use Chromium.' },
          { status: 'info', title: '18 Windows system components skipped', detail: 'Runtimes, redistributables and updates are Windows plumbing with no Linux counterpart.', advice: '' },
        ],
      },
      {
        name: 'Steam games',
        findings: [
          { status: 'green', title: 'Counter-Strike 2', detail: 'Native Linux build ships with the game.', advice: 'Native Linux build — nothing to do.' },
          { status: 'yellow', title: 'Elden Ring', detail: 'Runs well under Proton (ProtonDB: Gold).', advice: 'Enable Steam Play (Proton) for all titles; check the ProtonDB rating.', url: 'https://www.protondb.com/search/Elden%20Ring' },
          { status: 'red', title: 'Delta Force', detail: 'Kernel-level anti-cheat blocks Linux/Proton.', advice: 'Anti-cheat blocks Linux; keep a Windows partition/VM for this one.' },
        ],
      },
      {
        name: 'Hardware',
        findings: [
          { status: 'yellow', title: 'NVIDIA GeForce RTX 4070', detail: 'Proprietary driver required; Wayland support is decent but lagging AMD.', advice: 'Install the distro proprietary driver after switching; prefer X11 for release builds.' },
          { status: 'green', title: 'Intel I211 Gigabit Network Connection', detail: 'igb driver, in-kernel for years.', advice: '' },
          { status: 'green', title: 'Intel Wi-Fi 6 AX200', detail: 'iwlwifi firmware in mainline.', advice: '' },
        ],
      },
      {
        name: 'Printers',
        findings: [
          { status: 'green', title: 'HP LaserJet M1136 MFP', detail: 'HP drivers via HPLIP; IPP Everywhere supported.', advice: '' },
        ],
      },
    ],
    verdict: { status: 'red', headline: '未就绪 — 存在阻塞项' },
    counts: { red: 2, yellow: 4, green: 5, info: 1 },
    meta: { generatedAt: '2026-09-30', kbDate: '2026-09-01', version: '0.1.0' },
  };

  const SAMPLE_CI = {
    ok: true,
    kind: 'ci',
    host: 'D:/Code/demo-service',
    title: 'CI 体检 — Ubuntu 26.04 就绪度(D:/Code/demo-service)',
    sections: [
      {
        name: '.github/workflows/ci.yml',
        findings: [
          { status: 'red', title: 'ci.yml: build uses ubuntu-latest', detail: 'ubuntu-latest flips to Ubuntu 26.04 between 2026-10-19 and 2026-11-19 — the image under your job changes silently.', advice: 'Pin ubuntu-24.04 now, then trial ubuntu-26.04 on a branch.' },
          { status: 'yellow', title: 'Bare node/npm in run steps', detail: 'Image default moves Node 22.23.2 → 24.21.0, npm 10.9.8 → 11.19.0.', advice: 'Use actions/setup-node with an explicit version.' },
          { status: 'yellow', title: 'setup-python pinned to 3.9', detail: 'Python 3.9 is EOL and gone from the 26.04 toolcache.', advice: 'Move to 3.12+ before the rollout.' },
        ],
      },
      {
        name: '.github/workflows/release.yml',
        findings: [
          { status: 'red', title: 'release.yml uses conda (removed in 26.04)', detail: 'Miniconda/conda is removed from the Ubuntu 26.04 image.', advice: 'Switch to setup-miniconda action or venv + pip.' },
          { status: 'green', title: 'actions/checkout@v4', detail: 'Current runtime.', advice: '' },
        ],
      },
      {
        name: 'Rollout timeline',
        findings: [
          { status: 'info', title: 'Rollout window: 2026-10-19 → 2026-11-19', detail: 'Green rollout of ubuntu-latest → ubuntu-26.04; brownouts announced for ubuntu-22.04.', advice: 'Test on a pinned branch before the window opens.' },
        ],
      },
    ],
    verdict: { status: 'red', headline: '未就绪 — 存在阻塞项' },
    counts: { red: 2, yellow: 2, green: 1, info: 1 },
    meta: { generatedAt: '2026-09-30', kbDate: '2026-09-18', version: '0.1.0' },
  };

  const SAMPLE_RUNTIME = {
    ok: true,
    kind: 'runtime',
    host: 'D:/Code/demo-service',
    title: '运行时体检 — Node/Python EOL(D:/Code/demo-service)',
    sections: [
      {
        name: 'package.json',
        findings: [
          { status: 'red', title: 'Node.js 20 已停止安全维护', detail: 'EOL 2026-04-30（已是 153 天前）— 不再发布安全补丁。', advice: '把 engines.node 升到受支持的Node.js版本。', runtime: 'node', version: '20' },
          { status: 'green', title: 'Node.js 22 受支持', detail: '维护至 2027-04-30。', runtime: 'node', version: '22' },
        ],
      },
      {
        name: '.nvmrc',
        findings: [
          { status: 'green', title: 'Node.js 22 受支持', detail: '维护至 2027-04-30。', runtime: 'node', version: '22' },
        ],
      },
      {
        name: 'pyproject.toml',
        findings: [
          { status: 'yellow', title: 'Python 3.10 即将停止维护', detail: 'EOL 2026-10-31（还剩 31 天）。', advice: '提前安排升级：更新 requires-python 并在 CI 里先试跑新版本。', runtime: 'python', version: '3.10' },
        ],
      },
    ],
    verdict: { status: 'red', headline: '未就绪 — 存在阻塞项' },
    counts: { red: 1, yellow: 1, green: 2, info: 0 },
    meta: { generatedAt: '2026-09-30', kbDate: '2026-09-30', version: '0.2.0' },
  };

  const PROFILES = [
    { id: 'p_mock1', name: '办公室台式机', host: '192.168.1.23', port: 22, username: 'chen', authType: 'password', keyPath: '', hostFingerprint: 'SHA256:c2FtcGxlLWhvc3Qta2V5LWZpbmdlcnByaW50', hasPassword: true, password: '', hasKeyPassphrase: false, keyPassphrase: '' },
    { id: 'p_mock2', name: '构建服务器', host: 'build.internal', port: 22, username: 'ci', authType: 'key', keyPath: 'C:/Users/me/.ssh/id_ed25519', hostFingerprint: '', hasPassword: false, password: '', hasKeyPassphrase: false, keyPassphrase: '' },
  ];

  const HISTORY = [
    { id: 'h_mock2', at: '2026-09-28T02:10:00.000Z', kind: 'linux', host: 'OFFICE-PC', verdict: 'yellow', counts: { red: 1, yellow: 5, green: 6, info: 1 } },
    { id: 'h_mock1', at: '2026-09-14T02:00:00.000Z', kind: 'linux', host: 'OFFICE-PC', verdict: 'red', counts: { red: 3, yellow: 4, green: 5, info: 1 } },
  ];

  window.api = {
    async listProfiles() {
      return { safeStorage: true, profiles: PROFILES.map(p => ({ ...p })) };
    },
    async saveProfile(profile) {
      const id = profile.id || `p_mock_${Date.now()}`;
      const at = PROFILES.findIndex(p => p.id === id);
      const rec = { id, name: profile.name, host: profile.host, port: profile.port, username: profile.username, authType: profile.authType, keyPath: profile.keyPath || '', hasPassword: !!(profile.password || (at >= 0 && PROFILES[at].hasPassword)), password: '', hasKeyPassphrase: false, keyPassphrase: '' };
      if (at >= 0) PROFILES[at] = rec; else PROFILES.push(rec);
      return { ok: true, id };
    },
    async deleteProfile(id) {
      const at = PROFILES.findIndex(p => p.id === id);
      if (at >= 0) PROFILES.splice(at, 1);
      return { ok: true };
    },
    async sshTest() {
      await sleep(700);
      return Math.random() > 0.35 ? { ok: true, platform: 'windows', fingerprint: 'SHA256:Zm9vYmFy' } : { ok: false, error: '连接被拒绝 — 该端口没有响应，远端可能未启用 OpenSSH 服务器' };
    },
    async startCheck(opts) {
      const ci = opts.type === 'ci';
      const rt = opts.type === 'runtime';
      const steps = opts.target === 'ssh'
        ? [['connect', '正在连接 192.168.1.23:22 …'], ['connect', 'SSH 已连接'],
           ['scan', rt ? '正在读取远程运行时声明文件 …' : '正在读取远程 .github/workflows …'],
           ['collect', rt ? '解析版本声明…' : '解析 workflow 文件…'],
           ['match', rt ? '正在对照运行时 EOL 知识库…' : '正在对照 Ubuntu 26.04 镜像清单…']]
        : rt
          ? [['scan', '正在读取运行时声明文件 …'], ['match', '正在对照运行时 EOL 知识库…']]
          : ci
            ? [['scan', '正在读取 .github/workflows …'], ['match', '正在对照 Ubuntu 26.04 镜像清单…']]
            : [['collect', '正在采集：已安装软件…'], ['collect', '正在采集：Steam 库…'], ['collect', '正在采集：硬件…'], ['collect', '正在采集：打印机…']];
      for (const [stage, msg] of steps) {
        await sleep(350);
        window.api.__emit({ stage, message: msg });
      }
      await sleep(250);
      return opts.type === 'ci' ? SAMPLE_CI : opts.type === 'runtime' ? SAMPLE_RUNTIME : SAMPLE_LINUX;
    },
    async runTrial(req) {
      await sleep(400);
      window.api.__emit({ stage: 'trial', message: `${req.dryRun ? '[预览] ' : ''}重写 .github/workflows/ci.yml:ubuntu-latest → ubuntu-26.04` });
      await sleep(400);
      window.api.__emit({ stage: 'trial', message: req.dryRun ? '[预览] 完成,未改动仓库' : '创建分支 switchcheck/ubuntu-26.04-trial ✓' });
      await sleep(300);
      if (!req.dryRun) window.api.__emit({ stage: 'trial', message: 'gh pr create … ✓ https://github.com/demo-service/pull/42' });
      return { ok: true };
    },
    async historyList() { return HISTORY.map(h => ({ ...h })); },
    async historyGet(id) {
      const e = HISTORY.find(h => h.id === id);
      if (!e) return null;
      const result = e.id === 'h_mock1'
        ? { ...SAMPLE_LINUX, verdict: { status: 'red', headline: '未就绪 — 存在阻塞项' }, counts: HISTORY[1].counts, sections: SAMPLE_LINUX.sections.map(s => ({ ...s, findings: s.findings.map(f => ({ ...f })), })), }
        : SAMPLE_LINUX;
      if (e.id === 'h_mock1') {
        // fabricate an older snapshot: an extra red that is "resolved" today
        result.sections = [
          { name: 'Applications', findings: [{ status: 'red', title: '腾讯桌面整理 (已卸载)', detail: '旧机器上的阻塞项。', advice: '' }, ...SAMPLE_LINUX.sections[0].findings] },
          ...SAMPLE_LINUX.sections.slice(1),
        ];
      }
      return { entry: { id: e.id, at: e.at, kind: e.kind, host: e.host }, result };
    },
    async historyClear() { HISTORY.length = 0; return { ok: true }; },
    async exportProfiles() { return 'C:/Users/me/Desktop/switchcheck-connections.json'; },
    async importProfiles() { return { added: 2, skipped: 1 }; },
    __emit: () => {},
    onProgress(cb) { window.api.__emit = cb; },
    async pickFolder() { return 'D:/Code/demo-service'; },
    async pickKeyFile() { return 'C:/Users/me/.ssh/id_ed25519'; },
    async saveReport(req) { console.log('mock saveReport', req.format, req.suggestedName); return `C:/Users/me/Desktop/${req.suggestedName}`; },
    async openExternal(url) { window.open(url, '_blank'); },
    async version() { return '0.3.0-mock'; },
    onUpdateStatus() { /* no updates in the browser mock */ },
    async updateCheck() { return { state: 'dev' }; },
    async updateInstall() { /* noop */ },
  };
}
