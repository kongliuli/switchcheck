'use strict';

// Scans a repository for the runtime versions the project itself declares:
// package.json (engines.node / volta.node), .nvmrc, .node-version,
// .python-version, pyproject.toml (requires-python). Provider-based like the
// workflow scanner — the same files can be read locally or over SFTP.
//
// For each spec the declared BASELINE version is extracted (the minimum the
// project says it supports) — that is the one that goes EOL under you first.

// Provider reads may be sync strings (local fs) or promises (SFTP) — await
// handles both, and a missing file is just "not declared here".
async function readVia(provider, root, rel) {
  try {
    return await provider.readFile(provider.join(root, rel));
  } catch {
    return null;
  }
}

// "20" | "v20.11.1" | "^20.11" | ">=20 <22" | "22.x" → '20' (the minimum)
function nodeBaseline(spec) {
  const nums = [];
  for (const tok of String(spec).split(/[\s,|]+/)) {
    const m = tok.match(/(\d{1,2})/);
    if (m) nums.push(Number(m[1]));
  }
  return nums.length ? String(Math.min(...nums)) : null;
}

// ">=3.10" | "3.11.5" | ">=3.10,<3.12" → '3.10' (the minimum)
function pythonBaseline(spec) {
  const minors = [];
  for (const m of String(spec).matchAll(/3\s*\.\s*(\d{1,2})/g)) minors.push(Number(m[1]));
  return minors.length ? `3.${Math.min(...minors)}` : null;
}

function baseline(tool, spec) {
  return tool === 'python' ? pythonBaseline(spec) : nodeBaseline(spec);
}

async function scanRepoRuntime(root, provider) {
  const files = [];

  const pkgRaw = await readVia(provider, root, 'package.json');
  if (pkgRaw != null) {
    let parsed = null;
    try { parsed = JSON.parse(pkgRaw); } catch { parsed = undefined; }
    if (parsed === undefined) {
      files.push({ file: 'package.json', tool: 'node', parseError: true, specs: [] });
    } else if (parsed) {
      const specs = [];
      if (parsed.engines && parsed.engines.node) {
        specs.push({ spec: String(parsed.engines.node), from: 'engines.node' });
      }
      if (parsed.volta && parsed.volta.node) {
        specs.push({ spec: String(parsed.volta.node), from: 'volta.node' });
      }
      if (specs.length) {
        for (const s of specs) s.version = baseline('node', s.spec);
        files.push({ file: 'package.json', tool: 'node', specs });
      }
    }
  }

  for (const [rel, tool] of [['.nvmrc', 'node'], ['.node-version', 'node'], ['.python-version', 'python']]) {
    const raw = await readVia(provider, root, rel);
    if (raw == null) continue;
    const spec = raw.trim().split(/\s+/)[0];
    if (!spec) continue;
    files.push({ file: rel, tool, specs: [{ spec, from: rel, version: baseline(tool, spec) }] });
  }

  const pyRaw = await readVia(provider, root, 'pyproject.toml');
  if (pyRaw != null) {
    const m = pyRaw.match(/requires-python\s*=\s*["']([^"']+)["']/i);
    if (m) {
      files.push({
        file: 'pyproject.toml',
        tool: 'python',
        specs: [{ spec: m[1], from: 'requires-python', version: pythonBaseline(m[1]) }],
      });
    }
  }

  return { root, files };
}

module.exports = { scanRepoRuntime, nodeBaseline, pythonBaseline };
