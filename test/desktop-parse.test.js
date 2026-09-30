'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { parseVdf, parseLibraryFolders, parseAppManifest } = require('../src/desktop/vdf');

const LIBRARY_VDF = `"libraryfolders"
{
  "0"
  {
    "path"    "C:\\\\Program Files (x86)\\\\Steam"
    "label"   ""
  }
  "1"
  {
    "path"    "D:\\\\SteamLibrary"
  }
}`;

const MANIFEST_VDF = `"AppState"
{
  "appid"    "730"
  "name"     "Counter-Strike 2"
  "installdir"  "Counter-Strike 2"
}`;

test('parseVdf builds nested objects', () => {
  const root = parseVdf(LIBRARY_VDF);
  assert.ok(root.libraryfolders);
  assert.equal(root.libraryfolders['0'].path, 'C:\\Program Files (x86)\\Steam');
});

test('parseLibraryFolders returns library paths with unescaped backslashes', () => {
  assert.deepEqual(parseLibraryFolders(LIBRARY_VDF), [
    'C:\\Program Files (x86)\\Steam',
    'D:\\SteamLibrary',
  ]);
});

test('parseAppManifest extracts appid and name', () => {
  assert.deepEqual(parseAppManifest(MANIFEST_VDF), { appid: '730', name: 'Counter-Strike 2' });
});

test('parseVdf tolerates garbage', () => {
  assert.deepEqual(parseVdf(''), {});
  assert.deepEqual(parseVdf('// comment only'), {});
});
