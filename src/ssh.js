'use strict';

// SSH transport, shared by the GUI. Wraps ssh2 into the same "runner" shape
// the collectors use locally (runPs / exists / readFile / readdir / join /
// hostname / platform), so scanning a remote Windows host is a matter of
// passing this instead of localRunner. Also serves as a scan provider for
// workflow repos (SFTP works against Windows and Linux sshd alike).
//
// Hardening:
//   - host-key TOFU: connect() compares the server fingerprint against
//     opts.expectedFingerprint (from the saved profile); on first connect
//     the caller stores runner.hostFingerprint. Mismatch aborts pre-auth.
//   - every exec/SFTP op runs under a timeout — a hung remote never hangs
//     the check.
//   - ssh2's raw errors are translated into plain-language Chinese ones.
//
// ssh2 is lazy-required: the plain CLI keeps working without it loaded.

const crypto = require('crypto');

const CONNECT_TIMEOUT = 15000;
const OP_TIMEOUT = 45000;

const UTF8 = '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;';

const { psResult } = require('./desktop/ps');

function encodePs(script) {
  return Buffer.from(UTF8 + script, 'utf16le').toString('base64');
}

function posixJoin(...parts) {
  return parts.filter(Boolean).join('/').replace(/\/{2,}/g, '/');
}

// Resolves private key material from a profile: inline key content or a path.
function keyMaterial(profile) {
  if (profile.privateKey) return profile.privateKey;
  if (profile.keyPath) return require('fs').readFileSync(profile.keyPath, 'utf8');
  return null;
}

// OpenSSH-style fingerprint: SHA-256 over the raw key, base64 without padding.
// ssh2's hostVerifier may hand us the raw key (Buffer) or a pre-hashed string;
// normalize both so comparisons and stored fingerprints stay consistent.
function normalizeFingerprint(input) {
  if (!input) return null;
  if (Buffer.isBuffer(input)) {
    return 'SHA256:' + crypto.createHash('sha256').update(input).digest('base64').replace(/=+$/, '');
  }
  let s = String(input).trim();
  s = s.replace(/^SHA256:/i, '').replace(/=+$/, '');
  if (/^[A-Za-z0-9+/]{43}$/.test(s)) return 'SHA256:' + s;
  return s; // unknown shape — keep verbatim so equal inputs still compare equal
}

function friendlySshError(e) {
  const m = String((e && e.message) || e);
  if (/ETIMEDOUT|timed out/i.test(m)) return '连接超时 — 检查主机地址与网络';
  if (/ECONNREFUSED/.test(m)) return '连接被拒绝 — 该端口没有响应，远端可能未启用 OpenSSH 服务器';
  if (/ENOTFOUND|getaddrinfo/i.test(m)) return '主机名无法解析 — 检查地址拼写与 DNS';
  if (/ENETUNREACH|EHOSTUNREACH/.test(m)) return '网络不可达';
  if (/permission denied|All configured authentication|authentication methods failed|no supported/i.test(m)) {
    return '认证失败 — 用户名、密码或私钥不正确';
  }
  if (/Cannot parse privateKey|encrypted/i.test(m)) return '私钥无法解析 — 确认文件格式（PEM/OpenSSH）与口令';
  if (/ENOENT/.test(m)) return '私钥文件不存在 — 检查路径';
  return m;
}

function withTimeout(p, ms, label) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label}超时（${Math.round(ms / 1000)}s）— 远程主机可能无响应`)), ms);
    Promise.resolve(p).then(
      v => { clearTimeout(t); resolve(v); },
      e => { clearTimeout(t); reject(e); },
    );
  });
}

// Connects and returns a runner-like handle. opts:
//   host, port, username, password | privateKey | keyPath, passphrase,
//   expectedFingerprint (TOFU), opTimeoutMs
async function connect(opts, log = () => {}) {
  const { Client } = require('ssh2');
  const conn = new Client();
  const state = { sftp: null, closed: false, fingerprint: null, hostKeyRejected: false };
  const opTimeout = opts.opTimeoutMs || OP_TIMEOUT;

  try {
    await new Promise((resolve, reject) => {
      conn.on('ready', resolve);
      conn.on('error', reject);
      conn.on('close', () => { state.closed = true; });
      conn.connect({
        host: opts.host,
        port: Number(opts.port) || 22,
        username: opts.username,
        password: opts.password || undefined,
        privateKey: keyMaterial(opts) || undefined,
        passphrase: opts.passphrase || undefined,
        tryKeyboard: !opts.password && !keyMaterial(opts),
        readyTimeout: CONNECT_TIMEOUT,
        keepaliveInterval: 10000,
        hostVerifier: (key, cb) => {
          const fp = normalizeFingerprint(key);
          if (fp) state.fingerprint = fp;
          if (opts.expectedFingerprint && fp !== normalizeFingerprint(opts.expectedFingerprint)) {
            state.hostKeyRejected = true;
            cb(false);
            return;
          }
          cb(true); // no expectation yet → TOFU accept; caller stores the fingerprint
        },
      });
    });
  } catch (e) {
    try { conn.end(); } catch { /* already gone */ }
    if (state.hostKeyRejected) {
      throw new Error(
        '主机密钥指纹与保存的不一致 — 服务器可能重装过，也可能存在中间人风险。' +
        `确认无误后，请在连接管理器中删除该连接并重新保存。期望 ${opts.expectedFingerprint}，实际 ${state.fingerprint || '未知'}`,
      );
    }
    throw new Error(friendlySshError(e));
  }
  log('SSH 已连接');

  const exec = command => withTimeout(new Promise((resolve, reject) => {
    if (state.closed) return reject(new Error('SSH 连接已断开'));
    conn.exec(command, (err, stream) => {
      if (err) return reject(err);
      const out = [];
      const errOut = [];
      stream.on('data', c => out.push(c));
      stream.stderr.on('data', c => errOut.push(c));
      stream.on('close', code => {
        resolve({ code, stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(errOut).toString('utf8') });
      });
    });
  }), opTimeout, '远程命令执行');

  const sftp = () => {
    if (!state.sftp) {
      state.sftp = withTimeout(new Promise((resolve, reject) => {
        conn.sftp((err, s) => (err ? reject(err) : resolve(s)));
      }), opTimeout, 'SFTP 会话建立');
    }
    return state.sftp;
  };

  // Windows OpenSSH answers `ver` via the default shell; Linux/macOS hosts
  // don't have cmd. Used to give the linux check a clear target error.
  const detectPlatform = async () => {
    try {
      const r = await exec('cmd.exe /c ver 2>nul');
      if (/windows/i.test(r.stdout)) return 'windows';
    } catch { /* fallthrough */ }
    try {
      const r = await exec('uname -s');
      if (r.stdout.trim()) return 'unix';
    } catch { /* fallthrough */ }
    return 'unknown';
  };

  const runPs = async script => {
    let r;
    try {
      r = await exec(`powershell.exe -NoProfile -NonInteractive -EncodedCommand ${encodePs(script)}`);
    } catch (e) {
      return { ok: false, error: `SSH 命令执行失败: ${e.message}` };
    }
    return psResult(r, { remote: true });
  };

  const s = await sftp();
  // SFTP's login directory — '~' paths normalize against this.
  const homeDir = (await withTimeout(s.realpath('.'), opTimeout, 'SFTP realpath')).replace(/\\/g, '/');

  const runner = {
    runPs,
    exec,
    detectPlatform,
    hostFingerprint: state.fingerprint,
    homeDir,
    exists: async p => {
      try { await s.stat(p); return true; } catch { return false; }
    },
    readFile: async p => (await withTimeout(s.readFile(p), opTimeout, 'SFTP 读取文件')).toString('utf8'),
    readdir: async p => (await withTimeout(s.readdir(p), opTimeout, 'SFTP 列目录')).map(e => e.filename),
    // '~' is a shell-ism; SFTP needs it resolved to the login directory.
    normalizeRemotePath(p) {
      let sPath = String(p || '').trim();
      if (!sPath || sPath === '~') return '.';
      if (sPath === '~/' || sPath.startsWith('~/')) sPath = homeDir + sPath.slice(1);
      return sPath;
    },
    join: posixJoin,
    platform: async () => 'win32',           // linux-check targets are Windows
    hostname: async () => {
      const r = await exec('hostname');
      return r.stdout.trim() || opts.host;
    },
    close: () => {
      state.closed = true;
      try { conn.end(); } catch { /* already gone */ }
    },
  };
  return runner;
}

module.exports = { connect, posixJoin, normalizeFingerprint, friendlySshError, withTimeout };
