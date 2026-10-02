'use strict';

// `switchcheck ci --fix` / the GUI's "generate fixed YAML" button: rewrites
// ubuntu runner labels in place, with a dry-run preview and a no-op path.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runFix, planRewrites } = require('../src/ci/trial');

function makeRepo(workflow) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'switchcheck-fix-'));
  const wfDir = path.join(dir, '.github', 'workflows');
  fs.mkdirSync(wfDir, { recursive: true });
  fs.writeFileSync(path.join(wfDir, 'ci.yml'), workflow);
  return dir;
}

const WF = `jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: echo hi
  e2e:
    runs-on: ubuntu-24.04
    steps:
      - run: echo e2e
`;

test('runFix dry-run previews without touching files', () => {
  const repo = makeRepo(WF);
  const lines = [];
  const res = runFix(repo, { dryRun: true, log: l => lines.push(l) });
  assert.equal(res.ok, true);
  assert.equal(res.dryRun, true);
  assert.equal(res.rewrites, 1); // one file (both labels inside)
  const after = fs.readFileSync(path.join(repo, '.github', 'workflows', 'ci.yml'), 'utf8');
  assert.match(after, /ubuntu-latest/, 'dry-run must not modify the file');
  assert.ok(lines.some(l => l.includes('ci.yml')));
});

test('runFix rewrites ubuntu-latest and ubuntu-24.04 in place', () => {
  const repo = makeRepo(WF);
  const res = runFix(repo, {});
  assert.equal(res.ok, true);
  assert.equal(res.rewrites, 1);
  const after = fs.readFileSync(path.join(repo, '.github', 'workflows', 'ci.yml'), 'utf8');
  assert.ok(!/ubuntu-latest|ubuntu-24\.04/.test(after), 'all ubuntu labels rewritten');
  assert.match(after, /runs-on:\s*ubuntu-26\.04/);
  assert.match(after, /echo e2e/, 'untouched content survives');
});

test('runFix is a no-op when nothing matches', () => {
  const repo = makeRepo('jobs:\n  build:\n    runs-on: ubuntu-26.04\n');
  const res = runFix(repo, {});
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'no-change');
  assert.match(res.message, /nothing to fix/i);
});

test('planRewrites reports the changed file count', () => {
  const repo = makeRepo(WF);
  const plan = planRewrites(repo);
  assert.equal(plan.length, 1);
  assert.notEqual(plan[0].before, plan[0].after);
});
