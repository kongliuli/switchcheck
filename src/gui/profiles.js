'use strict';

// SSH connection profile store. Secrets are encrypted through Electron
// safeStorage (DPAPI on Windows) before touching disk — plaintext never
// persists, and if encryption is unavailable the secret is simply not
// saved. Extracted from main.js as pure Node so it can be unit-tested
// with a fake safeStorage.

const fs = require('fs');
const path = require('path');
const L = require('../labels');

function errMsg(lang, key, map) {
  const table = (L.LANGS.includes(lang) ? L.STR[lang] : L.STR.zh).ui;
  let s = table[key] || key;
  if (map) s = s.replace(/\{(\w+)\}/g, (_, k) => (map[k] !== undefined ? map[k] : ''));
  return s;
}

class ProfileStore {
  constructor({ dir, safeStorage }) {
    this.file = path.join(dir, 'ssh-profiles.json');
    this.safeStorage = safeStorage;
  }

  _load() {
    try {
      const list = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }

  _save(list) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(list, null, 2));
  }

  encryptionAvailable() {
    return this.safeStorage.isEncryptionAvailable();
  }

  encrypt(plain) {
    if (!plain || !this.safeStorage.isEncryptionAvailable()) return null;
    return this.safeStorage.encryptString(plain).toString('base64');
  }

  decrypt(b64) {
    if (!b64 || !this.safeStorage.isEncryptionAvailable()) return '';
    try {
      return this.safeStorage.decryptString(Buffer.from(b64, 'base64'));
    } catch {
      return '';
    }
  }

  // Shape the renderer sees: booleans for "a secret is stored", the secret
  // itself only decrypted (same user, OS-protected at rest). hostFingerprint
  // is the SSH host key (TOFU); secrets are never part of it.
  list() {
    return this._load().map(p => ({
      id: p.id,
      name: p.name,
      host: p.host,
      port: p.port,
      username: p.username,
      authType: p.authType,
      keyPath: p.keyPath || '',
      hostFingerprint: p.hostFingerprint || '',
      hasPassword: !!p.password,
      password: this.decrypt(p.password),
      hasKeyPassphrase: !!p.keyPassphrase,
      keyPassphrase: this.decrypt(p.keyPassphrase),
    }));
  }

  save(input) {
    const list = this._load();
    const id = input.id || `p_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    const prev = list.find(p => p.id === id);
    const profile = {
      id,
      name: String(input.name || `${input.host}`).slice(0, 80),
      host: String(input.host || '').trim(),
      port: Number(input.port) || 22,
      username: String(input.username || '').trim(),
      authType: input.authType === 'key' ? 'key' : 'password',
      keyPath: input.authType === 'key' ? String(input.keyPath || '').trim() : '',
      password: input.rememberPassword
        ? (this.encrypt(input.password) || (prev && prev.password) || null)
        : null,
      keyPassphrase: input.authType === 'key' && input.rememberPassword
        ? (this.encrypt(input.keyPassphrase) || (prev && prev.keyPassphrase) || null)
        : null,
    };
    if (!profile.host) throw new Error('主机地址不能为空');
    if (!profile.username) throw new Error('用户名不能为空');
    const at = list.findIndex(p => p.id === id);
    if (at === -1) list.push(profile);
    else list[at] = profile;
    this._save(list);
    return { ok: true, id };
  }

  delete(id) {
    this._save(this._load().filter(p => p.id !== id));
    return { ok: true };
  }

  // TOFU: remember the host key fingerprint seen on a successful connect —
  // only when the profile doesn't have one yet (a change must be an explicit
  // user decision, never a silent overwrite).
  maybeSaveFingerprint(id, fingerprint) {
    if (!fingerprint) return { ok: false };
    const list = this._load();
    const p = list.find(x => x.id === id);
    if (!p) return { ok: false };
    if (p.hostFingerprint) return { ok: true, existed: true };
    p.hostFingerprint = fingerprint;
    this._save(list);
    return { ok: true, existed: false };
  }

  // Export carries no secrets — only connection details and the host
  // fingerprint (a property of the server, safe to move between machines).
  exportProfiles() {
    return {
      tool: 'switchcheck-profiles',
      version: 1,
      exportedAt: new Date().toISOString(),
      profiles: this._load().map(p => ({
        name: p.name,
        host: p.host,
        port: p.port,
        username: p.username,
        authType: p.authType,
        keyPath: p.keyPath || '',
        hostFingerprint: p.hostFingerprint || '',
      })),
    };
  }

  // Merge an exported file back in; entries matching host+port+username are
  // skipped. Returns counters for the UI. Never accepts secrets.
  importProfiles(input) {
    const list = this._load();
    const incoming = (input && Array.isArray(input.profiles)) ? input.profiles : null;
    if (!incoming) throw new Error('文件格式不对 — 需要 switchcheck 导出的连接配置 JSON。');
    let added = 0;
    let skipped = 0;
    for (const raw of incoming) {
      const host = String(raw.host || '').trim();
      const username = String(raw.username || '').trim();
      if (!host || !username) { skipped++; continue; }
      const dup = list.some(p => p.host === host && Number(p.port) === (Number(raw.port) || 22) && p.username === username);
      if (dup) { skipped++; continue; }
      list.push({
        id: `p_${Date.now()}_${Math.floor(Math.random() * 1e6)}_${added}`,
        name: String(raw.name || host).slice(0, 80),
        host,
        port: Number(raw.port) || 22,
        username,
        authType: raw.authType === 'key' ? 'key' : 'password',
        keyPath: String(raw.keyPath || '').trim(),
        hostFingerprint: String(raw.hostFingerprint || '').trim() || null,
        password: null,
        keyPassphrase: null,
      });
      added++;
    }
    this._save(list);
    return { ok: true, added, skipped };
  }

  // Stored profile (by id) or inline fields from an unsaved form → options
  // for ssh.connect(). A password just typed in the UI wins over the stored
  // one so "edit → test without saving" behaves as expected.
  connectionOpts(opts = {}) {
    if (!opts.profileId) {
      return {
        host: String(opts.host || '').trim(),
        port: Number(opts.port) || 22,
        username: String(opts.username || '').trim(),
        authType: opts.authType,
        keyPath: opts.keyPath,
        passphrase: opts.passphrase,
        password: opts.password,
      };
    }
    const p = this._load().find(x => x.id === opts.profileId);
    if (!p) throw new Error(errMsg(opts.lang, 'errProfileMissing'));
    return {
      host: p.host,
      port: p.port,
      username: p.username,
      authType: p.authType,
      keyPath: p.keyPath,
      hostFingerprint: p.hostFingerprint || undefined,
      passphrase: opts.passphrase || this.decrypt(p.keyPassphrase),
      password: opts.password || this.decrypt(p.password),
    };
  }
}

module.exports = { ProfileStore };
