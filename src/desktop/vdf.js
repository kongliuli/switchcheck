'use strict';

// Minimal Valve Data Format parser — enough for Steam's libraryfolders.vdf
// and appmanifest_*.acf files. Tolerant: never throws, skips comments.

function tokenize(text) {
  const tokens = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === '/' && text[i + 1] === '/') {
      while (i < n && text[i] !== '\n') i++;
      continue;
    }
    if (c === '"') {
      let j = i + 1, val = '';
      while (j < n && text[j] !== '"') {
        if (text[j] === '\\' && (text[j + 1] === '"' || text[j + 1] === '\\')) {
          val += text[j + 1];
          j += 2;
        } else {
          val += text[j];
          j++;
        }
      }
      tokens.push({ t: 'str', v: val });
      i = j + 1;
      continue;
    }
    if (c === '{') { tokens.push({ t: '{' }); i++; continue; }
    if (c === '}') { tokens.push({ t: '}' }); i++; continue; }
    if (/\s/.test(c)) { i++; continue; }
    let j = i;
    while (j < n && !/[\s{}"]/.test(text[j])) j++;
    tokens.push({ t: 'str', v: text.slice(i, j) });
    i = j;
  }
  return tokens;
}

function parseVdf(text) {
  const tokens = tokenize(text || '');
  let pos = 0;

  function parseObject() {
    const obj = {};
    let lastKey = null;
    while (pos < tokens.length) {
      const tk = tokens[pos];
      if (tk.t === '}') { pos++; return obj; }
      if (tk.t === '{') {
        pos++;
        obj[lastKey] = parseObject();
        lastKey = null;
        continue;
      }
      if (lastKey === null) {
        lastKey = tk.v;
        pos++;
      } else {
        obj[lastKey] = tk.v;
        lastKey = null;
        pos++;
      }
    }
    return obj;
  }

  const root = parseObject();
  return root;
}

// Steam libraryfolders.vdf -> array of library paths
function parseLibraryFolders(text) {
  const root = parseVdf(text);
  const out = [];
  const folders = root.libraryfolders || {};
  for (const value of Object.values(folders)) {
    if (value && typeof value === 'object' && typeof value.path === 'string') {
      out.push(value.path.replace(/\\\\/g, '\\'));
    }
  }
  return out;
}

// appmanifest_*.acf -> { appid, name, sizeOnDisk }
function parseAppManifest(text) {
  let m = parseVdf(text);
  // Manifests wrap their fields in an "AppState" block; descend when present.
  if (m.AppState && typeof m.AppState === 'object') m = m.AppState;
  else if (Object.keys(m).length === 1) {
    const only = m[Object.keys(m)[0]];
    if (only && typeof only === 'object') m = only;
  }
  return {
    appid: m.appid ? String(m.appid) : null,
    name: m.name ? String(m.name) : null,
  };
}

module.exports = { parseVdf, parseLibraryFolders, parseAppManifest };
