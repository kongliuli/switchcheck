'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { checkMachine, appFinding, gameFinding, loadKbs } = require('../src/desktop/check');

const kbs = loadKbs();

test('known native app maps to green', () => {
  const f = appFinding({ name: 'WeChat 4.0', version: '4.0.3' }, kbs);
  assert.equal(f.status, 'green');
  assert.match(f.title, /WeChat 4\.0/);
});

test('system runtime noise is skipped', () => {
  const machine = {
    software: { ok: true, items: [
      { name: 'Microsoft Visual C++ 2015-2022 Redistributable (x64)', version: '' },
      { name: 'WeChat', version: '' },
    ] },
    steam: { installed: false, games: [] },
    hardware: { ok: true, gpus: [], nics: [], audio: [] },
    printers: { ok: true, items: [] },
  };
  const sections = checkMachine(machine, kbs);
  const apps = sections.find(s => s.name === 'Applications');
  assert.equal(apps.findings.filter(f => f.status !== 'info').length, 1);
  assert.ok(apps.findings.some(f => /system components skipped/.test(f.title)));
});

test('blocked tax software maps to red', () => {
  const f = appFinding({ name: '增值税发票开票软件（税控盘版）', version: '' }, kbs);
  assert.equal(f.status, 'red');
});

test('unknown app falls back to verify', () => {
  const f = appFinding({ name: 'MyCustomInhouseTool 2.1', version: '2.1' }, kbs);
  assert.equal(f.status, 'yellow');
  assert.ok(f.url);
});

test('qq exclusion steers QQ音乐 away from the QQ entry', () => {
  const music = appFinding({ name: 'QQ音乐', version: '' }, kbs);
  assert.equal(music.status, 'yellow');
  assert.match(music.title, /QQ/);
  const qq = appFinding({ name: '腾讯QQ', version: '' }, kbs);
  assert.equal(qq.status, 'green');
});

test('steam games: known native, known blocked, unknown default', () => {
  const native = gameFinding({ appid: '730', name: 'Counter-Strike 2' }, kbs);
  assert.equal(native.status, 'green');

  const blocked = gameFinding({ appid: null, name: 'Apex Legends' }, kbs);
  assert.equal(blocked.status, 'red');

  const unknown = gameFinding({ appid: '9999999', name: 'Some Indie Game' }, kbs);
  assert.equal(unknown.status, 'yellow');
  assert.match(unknown.url, /protondb/);
});

test('hardware and printers map through vendor rules', () => {
  const machine = {
    software: { ok: true, items: [] },
    steam: { installed: false, games: [] },
    hardware: { ok: true, gpus: [{ name: 'NVIDIA GeForce RTX 4070' }], nics: [{ name: 'Intel(R) Wi-Fi 6 AX201' }], audio: [] },
    printers: { ok: true, items: [{ name: 'HP LaserJet 1020', driver: 'hp', port: '192.168.1.50', network: true }] },
  };
  const sections = checkMachine(machine, kbs);
  const hw = sections.find(s => s.name === 'Hardware').findings;
  assert.equal(hw.find(f => /NVIDIA/.test(f.title)).status, 'green');
  const printer = sections.find(s => s.name === 'Printers').findings[0];
  assert.equal(printer.status, 'green');
  assert.match(printer.detail, /driverless IPP/);
});
