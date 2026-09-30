'use strict';

// Tests for the pieces the GUI shares with the CLI: the collector "runner"
// abstraction (local vs SSH) and the provider-based workflow scanner. No
// PowerShell and no network here — runners/providers are fakes.

const test = require('node:test');
const assert = require('node:assert');
const { collectSoftware, collectSteam, collectAll } = require('../src/desktop/collect');
const { scanRepo } = require('../src/ci/scan');
const { posixJoin } = require('../src/ssh');

// ------------------------------------------------- fake runner (SSH-like) --

const LIBRARY_VDF = `"libraryfolders"
{
  "0"
  {
    "path"    "C:\\\\Program Files (x86)\\\\Steam"
  }
  "1"
  {
    "path"    "D:\\\\SteamLibrary"
  }
}`;

const MANIFEST = appid => `"AppState"
{
  "appid"    "${appid}"
  "name"     "Game ${appid}"
}`;

// Answers the four collector PowerShell scripts with canned JSON, the way an
// SSH runner would relay a remote powershell.exe -EncodedCommand call.
function fakeRunner(files) {
  return {
    async runPs(script) {
      if (script.includes('Uninstall')) {
        return {
          ok: true,
          data: [
            { DisplayName: 'WeChat', DisplayVersion: '3.9.12', Publisher: 'Tencent' },
            { DisplayName: '   ', DisplayVersion: '1.0', Publisher: 'x' }, // filtered out
          ],
        };
      }
      if (script.includes('Valve')) {
        return { ok: true, data: ['C:/Program Files (x86)/Steam'] };
      }
      if (script.includes('Win32_VideoController')) {
        return { ok: true, data: [{ gpu: '[{"Name":"NVIDIA GeForce RTX 4070"}]', nic: '', audio: '' }] };
      }
      if (script.includes('Win32_Printer')) {
        return { ok: true, data: [{ Name: 'HP LaserJet', DriverName: 'HP Universal', PortName: '192.168.1.50' }] };
      }
      return { ok: false, error: 'unexpected script' };
    },
    async exists(p) { return files[p.replace(/\\/g, '/')] !== undefined; },
    async readFile(p) {
      const v = files[p.replace(/\\/g, '/')];
      if (v === undefined) throw new Error('ENOENT ' + p);
      return v;
    },
    async readdir(p) {
      const dir = p.replace(/\\/g, '/').replace(/\/$/, '') + '/';
      return Object.keys(files)
        .filter(f => f.startsWith(dir))
        .map(f => f.slice(dir.length))
        .filter(f => !f.includes('/'));
    },
    join: posixJoin,
    hostname: async () => 'REMOTE-BOX',
    platform: async () => 'win32',
  };
}

test('collectSoftware maps registry rows through the runner', async () => {
  const res = await collectSoftware(fakeRunner({}));
  assert.ok(res.ok);
  assert.deepEqual(res.items, [{ name: 'WeChat', version: '3.9.12', publisher: 'Tencent' }]);
});

test('collectSteam reads vdf + manifests through the runner', async () => {
  const files = {
    'C:/Program Files (x86)/Steam/steamapps/libraryfolders.vdf': LIBRARY_VDF,
    'C:/Program Files (x86)/Steam/steamapps/appmanifest_730.acf': MANIFEST('730'),
    'D:/SteamLibrary/steamapps/appmanifest_570.acf': MANIFEST('570'),
  };
  const res = await collectSteam(fakeRunner(files));
  assert.ok(res.installed);
  assert.deepEqual(res.games, [{ appid: '730', name: 'Game 730' }, { appid: '570', name: 'Game 570' }]);
});

test('collectAll assembles the machine snapshot and reports steps', async () => {
  const steps = [];
  const machine = await collectAll(fakeRunner({}), (step, label) => steps.push(step + ':' + label));
  assert.equal(machine.host, 'REMOTE-BOX');
  assert.equal(machine.platform, 'win32');
  assert.equal(machine.software.items.length, 1);
  assert.equal(machine.hardware.gpus[0].name, 'NVIDIA GeForce RTX 4070');
  assert.equal(machine.printers.items[0].network, true);
  assert.deepEqual(steps.map(s => s.split(':')[0]), ['software', 'steam', 'hardware', 'printers']);
});

// --------------------------------------------- fake provider (SFTP-like) --

const WORKFLOW_YAML = `jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
`;

test('scanRepo works against an async remote provider', async () => {
  const provider = {
    exists: async p => p === '/repo/.github/workflows',
    readdir: async () => ['deploy.yml', 'notes.md'],
    readFile: async p => {
      if (p === '/repo/.github/workflows/deploy.yml') return WORKFLOW_YAML;
      throw new Error('ENOENT ' + p);
    },
    join: (...parts) => parts.join('/'),
  };
  const scan = await scanRepo('/repo', provider);
  assert.equal(scan.workflows.length, 1);
  const wf = scan.workflows[0];
  assert.equal(wf.file, '.github/workflows/deploy.yml');
  assert.equal(wf.parseError, null);
  assert.deepEqual(wf.jobs[0].osLabels, ['ubuntu-latest']);
});

test('posixJoin keeps ssh paths single-slashed', () => {
  assert.equal(posixJoin('~/repo', '.github', 'workflows'), '~/repo/.github/workflows');
  assert.equal(posixJoin('C:/repo/', '.github', 'workflows', 'ci.yml'), 'C:/repo/.github/workflows/ci.yml');
});
