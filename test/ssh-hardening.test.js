'use strict';

// SSH hardening units that don't need a server: fingerprint normalization,
// error translation, operation timeouts.

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const {
  normalizeFingerprint, friendlySshError, withTimeout,
} = require('../src/ssh');

const RAW_KEY = Buffer.from('fake-public-key-bytes');

test('normalizeFingerprint: raw key buffer → OpenSSH-style sha256', () => {
  const fp = normalizeFingerprint(RAW_KEY);
  const expect = 'SHA256:' + crypto.createHash('sha256').update(RAW_KEY).digest('base64').replace(/=+$/, '');
  assert.equal(fp, expect);
});

test('normalizeFingerprint: hashed strings normalize to one canonical form', () => {
  const b64 = crypto.createHash('sha256').update(RAW_KEY).digest('base64'); // has '=' padding
  const padded = 'SHA256:' + b64;
  const bare = b64.replace(/=+$/, '');
  const unpadded = 'SHA256:' + bare;
  const set = new Set([padded, unpadded, bare, normalizeFingerprint(RAW_KEY)].map(normalizeFingerprint));
  assert.equal(set.size, 1, `all shapes should normalize alike, got ${[...set].join(' / ')}`);
});

test('normalizeFingerprint: nullish → null', () => {
  assert.equal(normalizeFingerprint(null), null);
  assert.equal(normalizeFingerprint(''), null);
  assert.equal(normalizeFingerprint(undefined), null);
});

test('friendlySshError maps raw ssh2/network errors to plain Chinese', () => {
  assert.match(friendlySshError(new Error('connect ETIMEDOUT 1.2.3.4:22')), /连接超时/);
  assert.match(friendlySshError(new Error('connect ECONNREFUSED 1.2.3.4:22')), /OpenSSH 服务器/);
  assert.match(friendlySshError(new Error('getaddrinfo ENOTFOUND build.internal')), /无法解析/);
  assert.match(friendlySshError(new Error('All configured authentication methods failed')), /认证失败/);
  assert.match(friendlySshError(new Error('Encrypted private key detected')), /私钥无法解析/);
  assert.match(friendlySshError(new Error('ENOENT: no such file')), /私钥文件不存在/);
  // unknown errors pass through untouched
  assert.equal(friendlySshError(new Error('weird')), 'weird');
});

test('withTimeout: resolves under the limit, rejects with the given message past it', async () => {
  await assert.doesNotReject(withTimeout(Promise.resolve('ok'), 1000, 'boom'));
  await assert.rejects(
    withTimeout(new Promise(() => {}), 30, '远程操作超时（0.03s）'),
    /远程操作超时/,
  );
});

test('friendlySshError localizes per language', () => {
  const e = new Error('connect ECONNREFUSED 1.2.3.4:22');
  assert.match(friendlySshError(e, 'zh'), /OpenSSH 服务器/);
  assert.match(friendlySshError(e, 'en'), /OpenSSH Server/);
  assert.match(friendlySshError(e, 'ja'), /OpenSSH Server/);
  // unknown language falls back to Chinese
  assert.match(friendlySshError(e, 'xx'), /OpenSSH 服务器/);
});
