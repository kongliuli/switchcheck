'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const {
  scanRepo, parseUses, detectTools, detectAptPackages, extractVersionSpecs,
} = require('../src/ci/scan');

const FIXTURE = path.join(__dirname, 'fixtures', 'repo');

test('parseUses handles action refs', () => {
  assert.deepEqual(parseUses('actions/checkout@v4'), { kind: 'action', repo: 'actions/checkout', major: 'v4', ref: 'v4' });
  assert.equal(parseUses('actions/checkout@v4.1.1').major, 'v4');
  assert.equal(parseUses('docker://alpine:3.20').kind, 'docker');
  assert.equal(parseUses('./.github/actions/local').kind, 'local');
});

test('detectTools finds bare tools and avoids hyphen false-positives', () => {
  assert.ok(detectTools('node build.js && npm ci').includes('node'));
  assert.ok(detectTools('npm ci').includes('npm'));
  assert.ok(!detectTools('echo node-version').includes('node'));
  assert.ok(detectTools('python3 -m pip install x').includes('python'));
  assert.ok(detectTools('go build ./...').includes('go'));
  assert.ok(detectTools('conda env create').includes('conda'));
});

test('detectAptPackages extracts names, drops flags and versions', () => {
  const run = 'sudo apt-get install -y python3-pip cmake=3.28 g++ \\\n  wget';
  assert.deepEqual(detectAptPackages(run).sort(), ['cmake', 'g++', 'python3-pip', 'wget']);
  assert.deepEqual(detectAptPackages('echo nothing'), []);
});

test('extractVersionSpecs handles numbers, strings, arrays', () => {
  assert.deepEqual(extractVersionSpecs(20), ['20']);
  assert.deepEqual(extractVersionSpecs('20.x'), ['20']);
  assert.deepEqual(extractVersionSpecs(['3.11', '3.12']), ['3.11', '3.12']);
  assert.deepEqual(extractVersionSpecs(null), []);
});

test('scanRepo reads the fixture workflows', () => {
  const scan = scanRepo(FIXTURE);
  assert.equal(scan.workflows.length, 1);
  const wf = scan.workflows[0];
  assert.equal(wf.parseError, null);

  const byId = Object.fromEntries(wf.jobs.map(j => [j.id, j]));

  assert.deepEqual(byId.build.osLabels, ['ubuntu-latest']);
  const setup = byId.build.setups.find(s => s.tool === 'node');
  assert.ok(setup.expression, 'matrix node-version should be flagged as expression');

  assert.deepEqual(byId['python-job'].osLabels, ['ubuntu-22.04']);
  assert.ok(byId['python-job'].tools.includes('python'));
  assert.ok(byId['python-job'].aptPackages.includes('python3-pip'));

  assert.equal(byId['container-job'].container, 'node:20');
  assert.ok(byId['container-job'].tools.includes('node'));

  assert.ok(byId['conda-job'].tools.includes('conda'));
  assert.deepEqual(byId['conda-job'].osLabels, ['ubuntu-24.04']);

  assert.deepEqual(byId['windows-job'].osLabels, ['windows-latest']);
  assert.ok(byId['matrix-os'].osLabels.includes('ubuntu-latest'));
  assert.ok(byId['matrix-os'].osLabels.includes('macos-15'));
});
