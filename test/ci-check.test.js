'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { scanRepo } = require('../src/ci/scan');
const { checkScan, loadKb } = require('../src/ci/check');

const FIXTURE = path.join(__dirname, 'fixtures', 'repo');

function titlesWith(scan, kb, re) {
  const sections = checkScan(scan, kb);
  return sections.flatMap(s => s.findings).filter(f => re.test(f.title));
}

test('fixture repo gets the expected finding mix', () => {
  const kb = loadKb();
  const sections = checkScan(scanRepo(FIXTURE), kb);
  const all = sections.flatMap(s => s.findings);
  const statuses = new Set(all.map(f => f.status));

  assert.ok(statussHas(all, 'red'), 'expect at least one red');
  assert.ok(statussHas(all, 'yellow'), 'expect yellows');
  assert.ok(statussHas(all, 'green'), 'expect greens');

  // ubuntu-latest flip
  assert.ok(all.some(f => f.status === 'yellow' && /ubuntu-latest/.test(f.title)));
  // 22.04 retirement track
  assert.ok(all.some(f => f.status === 'yellow' && /ubuntu-22\.04/.test(f.title)));
  // checkout@v3 node16 = red; checkout@v4 node20 = yellow
  assert.ok(all.some(f => f.status === 'red' && /checkout@v3/.test(f.title)));
  assert.ok(all.some(f => f.status === 'yellow' && /checkout@v4/.test(f.title)));
  // setup-node@v4 runtime yellow
  assert.ok(all.some(f => f.status === 'yellow' && /setup-node@v4/.test(f.title)));
  // node version from matrix -> info
  assert.ok(all.some(f => f.status === 'info' && /matrix expression/.test(f.title)));
  // bare python without setup-python
  assert.ok(all.some(f => f.status === 'yellow' && /python3\/pip without setup-python/.test(f.title)));
  // apt watchlist hits
  assert.ok(all.some(f => f.status === 'yellow' && /python3-pip/.test(f.title)));
  assert.ok(all.some(f => f.status === 'yellow' && /"cmake"/.test(f.title)));
  // conda removed
  assert.ok(all.some(f => f.status === 'red' && /removed from the 26\.04 image.*conda/.test(f.title)));
  // container insulation
  assert.ok(all.some(f => f.status === 'green' && /container/.test(f.title)));
});

test('rollout timeline section always present', () => {
  const kb = loadKb();
  const sections = checkScan(scanRepo(FIXTURE), kb);
  const rollout = sections.find(s => s.name === 'Rollout timeline');
  assert.ok(rollout);
  assert.ok(rollout.findings.length >= 1);
});

function statussHas(findings, status) {
  return findings.some(f => f.status === status);
}
