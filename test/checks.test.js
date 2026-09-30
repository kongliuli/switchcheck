'use strict';

// The orchestration extracted from the Electron main process (src/checks.js),
// tested through the two injected seams: a fake ssh module and a stub
// connectionOpts. No network, no PowerShell, no Electron.

const test = require('node:test');
const assert = require('node:assert');
const { runCheck, runLinuxCheck } = require('../src/checks');
const { posixJoin } = require('../src/ssh');

// A fake ssh connection that doubles as a collector runner (runPs /
// readFile / ...) and a scan provider (exists / readdir / readFile / join).
function fakeConn({ platform = 'windows', files = {}, host = 'REMOTE-BOX' } = {}) {
  const state = { closed: false };
  return {
    state,
    detectPlatform: async () => platform,
    hostname: async () => host,
    platform: async () => 'win32',
    join: posixJoin,
    exists: async p => files[p.replace(/\\/g, '/')] !== undefined
      || p === '/repo/.github/workflows',
    readFile: async p => {
      const v = files[p.replace(/\\/g, '/')];
      if (v === undefined) throw new Error('ENOENT ' + p);
      return v;
    },
    readdir: async p => {
      if (p === '/repo/.github/workflows') return ['ci.yml'];
      const dir = p.replace(/\\/g, '/').replace(/\/$/, '') + '/';
      return Object.keys(files).filter(f => f.startsWith(dir)).map(f => f.slice(dir.length));
    },
    close: () => { state.closed = true; },
  };
}

function fakeSsh(conn, log = []) {
  return {
    connect: async (opts) => {
      log.push(opts);
      return conn;
    },
  };
}

const LINUX_FILES = {
  // registry-ish answers keyed by script markers, matching what runPs sees
};

test('linux check over SSH rejects a non-Windows target and closes the connection', async () => {
  const conn = fakeConn({ platform: 'unix' });
  const res = await runCheck(
    { type: 'linux', target: 'ssh', profileId: 'p1' },
    { ssh: fakeSsh(conn), connectionOpts: () => ({ host: 'box', port: 22 }) },
  );
  assert.equal(res.ok, false);
  assert.match(res.error, /不是 Windows/);
  assert.ok(conn.state.closed, 'connection must be closed');
});

test('linux check over SSH collects via the runner and closes the connection', async () => {
  const conn = fakeConn({});
  conn.runPs = async script => {
    if (script.includes('Uninstall')) {
      return { ok: true, data: [{ DisplayName: 'WeChat', DisplayVersion: '3.9', Publisher: 'Tencent' }] };
    }
    if (script.includes('Valve')) return { ok: true, data: [] };
    if (script.includes('Win32_VideoController')) return { ok: true, data: [{ gpu: '', nic: '', audio: '' }] };
    if (script.includes('Win32_Printer')) return { ok: true, data: [] };
    return { ok: false, error: 'unexpected' };
  };
  const steps = [];
  const res = await runCheck(
    { type: 'linux', target: 'ssh', profileId: 'p1' },
    {
      ssh: fakeSsh(conn),
      connectionOpts: o => ({ host: 'box', port: 22, profileId: o.profileId }),
      send: (stage, msg) => steps.push(stage),
    },
  );
  assert.equal(res.ok, true);
  assert.equal(res.kind, 'linux');
  assert.equal(res.host, 'REMOTE-BOX');
  assert.equal(res.verdict.status, 'green'); // WeChat is "native" in the KB (4.0 has a Linux build)
  assert.ok(res.sections.some(s => s.name === 'Applications'));
  assert.ok(conn.state.closed);
  assert.ok(steps.includes('connect') && steps.includes('match'));
});

test('ci check over SSH closes the connection even when a workflow read fails', async () => {
  const conn = fakeConn({ files: {} });
  const res = await runCheck(
    { type: 'ci', target: 'ssh', profileId: 'p1', remotePath: '/repo' },
    {
      ssh: fakeSsh(conn),
      connectionOpts: () => ({ host: 'box', port: 22 }),
    },
  );
  // fakeConn lists ci.yml but has no content for it — the read throws and
  // runCheck must surface ok:false while still closing the connection.
  assert.equal(res.ok, false);
  assert.ok(conn.state.closed);
});

test('ci check over SSH reports a clear error when no workflows exist', async () => {
  const conn = fakeConn({ files: {} });
  conn.exists = async () => false;
  const res = await runCheck(
    { type: 'ci', target: 'ssh', profileId: 'p1', remotePath: '/repo' },
    { ssh: fakeSsh(conn), connectionOpts: () => ({ host: 'box', port: 22 }) },
  );
  assert.equal(res.ok, false);
  assert.match(res.error, /没有找到任何 workflow/);
  assert.ok(conn.state.closed);
});

test('runCheck never throws — a missing connection config becomes ok:false', async () => {
  const res = await runCheck(
    { type: 'linux', target: 'ssh', profileId: 'nope' },
    {
      ssh: fakeSsh(fakeConn()),
      connectionOpts: () => { throw new Error('找不到该 SSH 连接配置，请重新选择或新建。'); },
    },
  );
  assert.equal(res.ok, false);
  assert.match(res.error, /找不到/);
});

test('local linux check path uses the injected send and reaches KB matching', async () => {
  // On non-Windows dev machines collectAll's local runner can't run PowerShell;
  // assert only the shape of the failure (never a throw).
  const res = await runLinuxCheck({ target: 'local' }, { send: () => {} });
  if (process.platform !== 'win32') {
    assert.equal(res.ok, false);
  } else {
    assert.equal(res.ok, true);
    assert.equal(res.kind, 'linux');
  }
});

test('runtime check works over SSH and through runCheck dispatch', async () => {
  const conn = fakeConn({
    files: {
      '/repo/package.json': JSON.stringify({ engines: { node: '>=20 <22' } }),
      '/repo/.nvmrc': '22\n',
    },
  });
  const res = await runCheck(
    { type: 'runtime', target: 'ssh', profileId: 'p1', remotePath: '/repo' },
    { ssh: fakeSsh(conn), connectionOpts: () => ({ host: 'box', port: 22 }) },
  );
  assert.equal(res.ok, true);
  assert.equal(res.kind, 'runtime');
  assert.ok(conn.state.closed, 'connection must be closed');
  // engines node >=20 <22 → baseline 20 → EOL 2026-04-30 is in the past → red
  const pkg = res.sections.find(s => s.name === 'package.json');
  assert.ok(pkg, 'package.json section present');
  assert.equal(pkg.findings[0].status, 'red');
  const nvmrc = res.sections.find(s => s.name === '.nvmrc');
  assert.equal(nvmrc.findings[0].status, 'green');
});

test('local linux check is rejected on non-Windows desktops with SSH guidance', async () => {  // runCheck wraps this into {ok:false}; runLinuxCheck itself rejects.
  await assert.rejects(
    runLinuxCheck({ target: 'local' }, { send: () => {}, platform: 'darwin' }),
    /仅支持 Windows.*SSH/s,
  );
  await assert.rejects(
    runLinuxCheck({ target: 'local' }, { send: () => {}, platform: 'linux' }),
    /仅支持 Windows/,
  );

  // and the user-facing path never throws:
  const res = await runCheck({ type: 'linux', target: 'local' }, { send: () => {}, platform: 'darwin' });
  assert.equal(res.ok, false);
  assert.match(res.error, /仅支持 Windows/);
});
