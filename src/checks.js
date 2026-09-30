'use strict';

// Check orchestration, shared by the GUI: resolve a target (local machine /
// folder, or SSH host) → collect or scan → match the knowledge base →
// assemble a result with verdict + counts. Extracted from the Electron main
// process so it runs (and tests) without a window. The only seams injected
// by the caller are the SSH module and how connection options are resolved.

const path = require('path');
const fs = require('fs');
const collect = require('./desktop/collect');
const { checkMachine, loadKbs } = require('./desktop/check');
const ciScan = require('./ci/scan');
const ciCheck = require('./ci/check');
const runtimeScan = require('./runtime/scan');
const runtimeCheck = require('./runtime/check');
const { verdict, countByStatus } = require('./engine');
const L = require('./labels');
const ssh = require('./ssh');

const VERSION = require('../package.json').version;

const fmt = (s, m) => String(s).replace(/\{(\w+)\}/g, (_, k) => (m[k] !== undefined ? m[k] : ''));

// Stage messages follow the UI language (opts.lang, zh default).
function stageFor(opts) {
  const lang = opts && L.LANGS.includes(opts.lang) ? opts.lang : 'zh';
  return L.STR[lang].stage;
}

function finishResult(kind, hostLabel, title, sections, extraMeta = {}) {
  const all = sections.flatMap(s => s.findings);
  return {
    ok: true,
    kind,
    host: hostLabel,
    title,
    sections,
    verdict: verdict(all),
    counts: countByStatus(all),
    meta: {
      generatedAt: new Date().toISOString().slice(0, 10),
      version: VERSION,
      ...extraMeta,
    },
  };
}

async function runLinuxCheck(opts = {}, deps = {}) {
  const send = deps.send || (() => {});
  const stage = stageFor(opts);
  const kbs = loadKbs();
  let machine;
  if (opts.target === 'ssh') {
    const connOpts = deps.connectionOpts(opts);
    send('connect', fmt(stage.connect, { host: connOpts.host, port: connOpts.port }));
    const conn = await (deps.ssh || ssh).connect(connOpts, m => send('connect', m));
    try {
      if (deps.afterConnect) deps.afterConnect(conn, opts);
      if (await conn.detectPlatform() !== 'windows') {
        throw new Error('SSH 目标不是 Windows 主机 — Windows→Linux 迁移体检需要扫描 Windows 机器。');
      }
      machine = await collect.collectAll(conn, step => send('collect', fmt(stage.remoteCollect, { label: stage.steps[step] })));
    } finally {
      conn.close();
    }
  } else {
    // The local scan is Windows PowerShell through and through; on a mac or
    // Linux desktop it can't run — point the user at the SSH mode instead.
    if ((deps.platform || process.platform) !== 'win32') {
      throw new Error('本机体检仅支持 Windows。在 macOS / Linux 上请选择「SSH 远程 Windows 主机」来体检那台 Windows 电脑。');
    }
    machine = await collect.collectAll(collect.localRunner, step => send('collect', fmt(stage.localCollect, { label: stage.steps[step] })));
  }
  send('match', stage.matchLinux);
  const sections = checkMachine(machine, kbs);
  const kbDate = [kbs.apps.updatedAt, kbs.hardware.updatedAt, kbs.games.updatedAt].sort().pop();
  return finishResult('linux', machine.host,
    `Windows → Linux 迁移体检 — ${machine.host}`, sections, { kbDate });
}

async function runCiCheck(opts = {}, deps = {}) {
  const send = deps.send || (() => {});
  const stage = stageFor(opts);
  const kb = ciCheck.loadKb();
  const root = opts.target === 'ssh'
    ? String(opts.remotePath || '~').trim()
    : String(opts.ciPath || '.').trim();
  let scan;
  if (opts.target === 'ssh') {
    const connOpts = deps.connectionOpts(opts);
    send('connect', fmt(stage.connect, { host: connOpts.host, port: connOpts.port }));
    const conn = await (deps.ssh || ssh).connect(connOpts, m => send('connect', m));
    try {
      if (deps.afterConnect) deps.afterConnect(conn, opts);
      send('scan', fmt(stage.scanCi, { root }));
      // '~' is a shell-ism; SFTP wants it resolved to the login directory.
      const rootOnHost = conn.normalizeRemotePath ? conn.normalizeRemotePath(root) : root;
      scan = await ciScan.scanRepo(rootOnHost, conn);
    } finally {
      conn.close();
    }
  } else {
    if (!fs.existsSync(path.join(root, '.github', 'workflows'))) {
      throw new Error(`${root} 下没有找到 .github/workflows 目录。`);
    }
    scan = await ciScan.scanRepo(root);
  }
  if (!scan.workflows.length) {
    throw new Error(`${root} 下没有找到任何 workflow 文件(.github/workflows/*.yml)。`);
  }
  send('match', stage.matchCi);
  const sections = ciCheck.checkScan(scan, kb);
  return finishResult('ci', root,
    `CI 体检 — Ubuntu 26.04 就绪度(${root})`, sections, { kbDate: kb.snapshotDate });
}

async function runRuntimeCheck(opts = {}, deps = {}) {
  const send = deps.send || (() => {});
  const stage = stageFor(opts);
  const kb = runtimeCheck.loadKb();
  const root = opts.target === 'ssh'
    ? String(opts.remotePath || '~').trim()
    : String(opts.ciPath || '.').trim();
  let scan;
  if (opts.target === 'ssh') {
    const connOpts = deps.connectionOpts(opts);
    send('connect', fmt(stage.connect, { host: connOpts.host, port: connOpts.port }));
    const conn = await (deps.ssh || ssh).connect(connOpts, m => send('connect', m));
    try {
      if (deps.afterConnect) deps.afterConnect(conn, opts);
      send('scan', fmt(stage.scanRuntime, { root }));
      const rootOnHost = conn.normalizeRemotePath ? conn.normalizeRemotePath(root) : root;
      scan = await runtimeScan.scanRepoRuntime(rootOnHost, conn);
    } finally {
      conn.close();
    }
  } else {
    scan = await runtimeScan.scanRepoRuntime(root, ciScan.fsProvider);
  }
  send('match', stage.matchRuntime);
  const sections = runtimeCheck.checkScan(scan, kb);
  return finishResult('runtime', root,
    `运行时体检 — Node/Python EOL(${root})`, sections, { kbDate: kb.snapshotDate });
}

// Never throws — the renderer gets { ok: false, error } either way.
async function runCheck(opts, deps = {}) {
  try {
    if (opts.type === 'ci') return await runCiCheck(opts, deps);
    if (opts.type === 'runtime') return await runRuntimeCheck(opts, deps);
    return await runLinuxCheck(opts, deps);
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

module.exports = { runCheck, runLinuxCheck, runCiCheck, runRuntimeCheck, finishResult };
