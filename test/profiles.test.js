'use strict';

// ProfileStore (src/gui/profiles.js) with a fake safeStorage: encryption
// round-trip, plaintext-never-on-disk, remember/no-remember flows and
// connectionOpts merging.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ProfileStore } = require('../src/gui/profiles');

function fakeSafeStorage(available = true) {
  return {
    isEncryptionAvailable: () => available,
    encryptString: s => Buffer.from('enc:' + s, 'utf8'),
    decryptString: buf => {
      const t = buf.toString('utf8');
      if (!t.startsWith('enc:')) throw new Error('not encrypted');
      return t.slice(4);
    },
  };
}

function makeStore(available = true) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'switchcheck-profiles-'));
  return new ProfileStore({ dir, safeStorage: fakeSafeStorage(available) });
}

test('save with rememberPassword stores ciphertext only, list() decrypts', () => {
  const store = makeStore();
  const { id } = store.save({
    name: '办公室台式机', host: '192.168.1.23', port: 22, username: 'chen',
    authType: 'password', password: 's3cret', rememberPassword: true,
  });
  const raw = JSON.parse(fs.readFileSync(store.file, 'utf8'));
  assert.ok(raw[0].password);
  assert.ok(!JSON.stringify(raw).includes('s3cret'), 'plaintext must not hit disk');
  const p = store.list().find(x => x.id === id);
  assert.equal(p.hasPassword, true);
  assert.equal(p.password, 's3cret');
});

test('save without rememberPassword keeps no secret at all', () => {
  const store = makeStore();
  store.save({ host: 'h', username: 'u', password: 's3cret', rememberPassword: false });
  const raw = JSON.parse(fs.readFileSync(store.file, 'utf8'));
  assert.equal(raw[0].password, null);
  assert.equal(store.list()[0].password, '');
});

test('with encryption unavailable the secret is dropped, never stored plaintext', () => {
  const store = makeStore(false);
  store.save({ host: 'h', username: 'u', password: 's3cret', rememberPassword: true });
  const raw = JSON.parse(fs.readFileSync(store.file, 'utf8'));
  assert.equal(raw[0].password, null);
});

test('saving with the same id updates instead of duplicating', () => {
  const store = makeStore();
  const { id } = store.save({ host: 'h1', username: 'u', name: 'a' });
  store.save({ id, host: 'h2', username: 'u', name: 'b' });
  const list = store.list();
  assert.equal(list.length, 1);
  assert.equal(list[0].host, 'h2');
});

test('validation: host and username are required', () => {
  const store = makeStore();
  assert.throws(() => store.save({ username: 'u' }), /主机地址/);
  assert.throws(() => store.save({ host: 'h' }), /用户名/);
});

test('connectionOpts prefers the freshly typed password and decrypts stored ones', () => {
  const store = makeStore();
  const { id } = store.save({
    host: 'h', port: 2222, username: 'u', password: 'stored', rememberPassword: true,
  });
  const base = store.connectionOpts({ profileId: id });
  assert.equal(base.password, 'stored');
  assert.equal(base.port, 2222);
  const typed = store.connectionOpts({ profileId: id, password: 'typed' });
  assert.equal(typed.password, 'typed');
  const inline = store.connectionOpts({ host: 'x', username: 'y', password: 'z' });
  assert.deepEqual(
    { host: inline.host, username: inline.username, password: inline.password },
    { host: 'x', username: 'y', password: 'z' },
  );
  assert.throws(() => store.connectionOpts({ profileId: 'missing' }), /找不到/);
});

test('TOFU fingerprint: saved once, never silently overwritten, carried into connectionOpts', () => {
  const store = makeStore();
  const { id } = store.save({ host: 'h', username: 'u' });
  assert.equal(store.connectionOpts({ profileId: id }).hostFingerprint, undefined);

  assert.deepEqual(store.maybeSaveFingerprint(id, 'SHA256:abc'), { ok: true, existed: false });
  assert.equal(store.connectionOpts({ profileId: id }).hostFingerprint, 'SHA256:abc');

  // a changed host key must NOT be absorbed silently
  assert.deepEqual(store.maybeSaveFingerprint(id, 'SHA256:evil'), { ok: true, existed: true });
  assert.equal(store.connectionOpts({ profileId: id }).hostFingerprint, 'SHA256:abc');
});

test('export strips secrets; import merges and skips duplicates', () => {
  const store = makeStore();
  store.save({ host: 'h1', username: 'u', name: 'a', password: 'secret', rememberPassword: true });
  store.save({ host: 'h2', username: 'u', name: 'b', authType: 'key', keyPath: 'C:/k' });

  const exported = store.exportProfiles();
  assert.ok(!JSON.stringify(exported).includes('secret'), 'no secrets in exports');
  assert.equal(exported.profiles.length, 2);

  const store2 = makeStore();
  const first = store2.importProfiles(exported);
  assert.deepEqual({ added: first.added, skipped: first.skipped }, { added: 2, skipped: 0 });
  const second = store2.importProfiles(exported);
  assert.deepEqual({ added: second.added, skipped: second.skipped }, { added: 0, skipped: 2 });

  const imported = store2.list().find(p => p.host === 'h2');
  assert.equal(imported.authType, 'key');
  assert.equal(imported.password, '', 'imported profiles never carry secrets');
  assert.throws(() => store2.importProfiles({ nope: true }), /文件格式/);
});
