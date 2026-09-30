'use strict';

// Runtime EOL check: baseline parsing from real-world version specs and the
// red/yellow/green judgment against the knowledge base (now injected for
// deterministic tests).

const test = require('node:test');
const assert = require('node:assert');
const { nodeBaseline, pythonBaseline, scanRepoRuntime } = require('../src/runtime/scan');
const { checkScan, versionFinding } = require('../src/runtime/check');

const KB = require('../data/runtime-eol.json');
const NOW = new Date('2026-09-30T00:00:00Z');

test('node baselines: pins, carets, ranges, nvmrc-style', () => {
  assert.equal(nodeBaseline('20'), '20');
  assert.equal(nodeBaseline('v20.11.1'), '20');
  assert.equal(nodeBaseline('^20.11.1'), '20');
  assert.equal(nodeBaseline('~22'), '22');
  assert.equal(nodeBaseline('22.x'), '22');
  assert.equal(nodeBaseline('>=20 <22'), '20');
  assert.equal(nodeBaseline('>=18 || >=22'), '18');
  assert.equal(nodeBaseline('lts/hydrogen'), null);
});

test('python baselines: requires-python forms', () => {
  assert.equal(pythonBaseline('>=3.10'), '3.10');
  assert.equal(pythonBaseline('>=3.10,<3.12'), '3.10');
  assert.equal(pythonBaseline('3.11.5'), '3.11');
  assert.equal(pythonBaseline('>=3.9'), '3.9');
  assert.equal(pythonBaseline('>= 3 . 10'), '3.10');
  assert.equal(pythonBaseline('>=2.7'), null);
});

test('scanRepoRuntime reads the usual declaration files via a provider', async () => {
  const files = {
    '/repo/package.json': JSON.stringify({ engines: { node: '>=20 <22' }, volta: { node: '22.11.0' } }),
    '/repo/.nvmrc': '22\n',
    '/repo/pyproject.toml': '[project]\nname = "x"\nrequires-python = ">=3.10,<3.12"\n',
  };
  const provider = {
    exists: async () => true,
    readFile: async p => {
      const v = files[p.replace(/\\/g, '/')];
      if (v === undefined) throw new Error('ENOENT');
      return v;
    },
    join: (...a) => a.join('/'),
  };
  const scan = await scanRepoRuntime('/repo', provider);
  assert.equal(scan.files.length, 3);
  const pkg = scan.files.find(f => f.file === 'package.json');
  assert.deepEqual(pkg.specs.map(s => s.version), ['20', '22']);
  assert.equal(scan.files.find(f => f.file === '.nvmrc').specs[0].version, '22');
  assert.equal(scan.files.find(f => f.file === 'pyproject.toml').specs[0].version, '3.10');
});

test('verdicts: passed EOL is red, within window yellow, supported green', () => {
  const red = versionFinding('node', '20', 'engines.node', KB, NOW);       // EOL 2026-04-30
  assert.equal(red.status, 'red');
  const yellow = versionFinding('python', '3.10', 'requires-python', KB, NOW); // EOL 2026-10-31
  assert.equal(yellow.status, 'yellow');
  const green = versionFinding('node', '22', '.nvmrc', KB, NOW);           // EOL 2027-04-30
  assert.equal(green.status, 'green');
});

test('unknown majors and unparseable specs stay informational', () => {
  assert.equal(versionFinding('node', '99', '.nvmrc', KB, NOW).status, 'info');
  assert.equal(versionFinding('node', null, '.nvmrc', KB, NOW).status, 'info');
  assert.equal(versionFinding('go', '1.21', 'go.mod', KB, NOW).status, 'info');
});

test('checkScan: one section per file, empty scan gets a pointer section', () => {
  const scan = {
    files: [
      { file: 'package.json', tool: 'node', specs: [{ spec: '20', from: 'engines.node', version: '20' }] },
      { file: '.nvmrc', tool: 'node', specs: [{ spec: '22', from: '.nvmrc', version: '22' }] },
    ],
  };
  const sections = checkScan(scan, KB, NOW);
  assert.equal(sections.length, 2);
  assert.equal(sections[0].findings[0].status, 'red');
  assert.equal(sections[1].findings[0].status, 'green');

  const empty = checkScan({ files: [] }, KB, NOW);
  assert.equal(empty.length, 1);
  assert.equal(empty[0].findings[0].status, 'info');
});
