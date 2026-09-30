'use strict';

// Shared PowerShell result handling. Local spawn (collect.js) and remote
// SSH exec (ssh.js) both end with the same shape — exit code + utf8
// stdout/stderr holding compressed JSON — so parse it in exactly one place.

// "powershell" is not recognized → on an SSH target this almost always means
// the remote host is not Windows, which deserves a plain-language message.
const NOT_FOUND_RE = /不是内部或外部命令|not recognized|command not found/i;

function psResult(r, { remote = false } = {}) {
  if (r.code !== 0) {
    const errText = ((r.stderr || '') + (r.stdout || '')).trim();
    if (remote && NOT_FOUND_RE.test(errText)) {
      return { ok: false, error: '远程主机上没有 powershell.exe(linux 体检的 SSH 目标必须是 Windows)' };
    }
    if (errText) return { ok: false, error: errText.split('\n')[0] };
    return { ok: false, error: `powershell exited ${r.code}` };
  }
  const out = (r.stdout || '').trim();
  if (!out) return { ok: true, data: [] };
  try {
    const parsed = JSON.parse(out);
    return { ok: true, data: Array.isArray(parsed) ? parsed : [parsed] };
  } catch (e) {
    return { ok: false, error: 'unparseable PowerShell output' };
  }
}

module.exports = { psResult };
