'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { verdict, countByStatus, worstStatus, sortFindings } = require('../src/engine');

test('verdict reflects the worst finding', () => {
  assert.equal(verdict([{ status: 'green' }, { status: 'yellow' }]).status, 'yellow');
  assert.equal(verdict([{ status: 'green' }, { status: 'red' }]).status, 'red');
  assert.equal(verdict([]).status, 'green');
  assert.equal(verdict([{ status: 'info' }]).status, 'green');
});

test('countByStatus tallies each level', () => {
  assert.deepEqual(
    countByStatus([{ status: 'red' }, { status: 'red' }, { status: 'green' }]),
    { red: 2, yellow: 0, green: 1, info: 0 }
  );
});

test('sortFindings orders red first', () => {
  const sorted = sortFindings([{ status: 'green' }, { status: 'red' }, { status: 'yellow' }]);
  assert.deepEqual(sorted.map(f => f.status), ['red', 'yellow', 'green']);
});
