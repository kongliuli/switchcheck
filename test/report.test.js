'use strict';
const test = require('node:test');
const assert = require('node:assert');
const terminal = require('../src/report/terminal');
const markdown = require('../src/report/markdown');
const html = require('../src/report/html');

const sections = [{
  name: 'Demo <section>',
  findings: [
    { status: 'red', title: 'Bad <thing>', detail: 'd', advice: 'a' },
    { status: 'green', title: 'Fine', detail: '', advice: '' },
  ],
}];

test('terminal render strips ANSI when color disabled', () => {
  const out = terminal.render('Title', sections, { color: false });
  assert.ok(out.includes('Bad <thing>'));
  assert.ok(!out.includes('\x1b['));
  assert.ok(out.includes('Not ready'));
});

test('terminal render keeps ANSI when color enabled', () => {
  const out = terminal.render('Title', sections, { color: true });
  assert.ok(out.includes('\x1b[31m'));
});

test('markdown render emits verdict and fix lines', () => {
  const out = markdown.render('Title', sections, { generatedAt: '2026-09-30' });
  assert.ok(out.includes('**Verdict: Not ready'));
  assert.ok(out.includes('Fix: a'));
});

test('html render escapes user content', () => {
  const out = html.render('Title', sections, {});
  assert.ok(out.includes('Bad &lt;thing&gt;'));
  assert.ok(out.includes('Demo &lt;section&gt;'));
  assert.ok(!out.includes('<thing>'));
});
