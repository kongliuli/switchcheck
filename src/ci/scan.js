'use strict';

// Scans a repository's GitHub Actions workflows into a structured "what does
// this CI actually use" description. Pure data in, pure data out — all
// judgment lives in check.js against the knowledge base.

const fs = require('fs');
const path = require('path');
const YAML = require('yaml');

const WORKFLOW_DIR = path.join('.github', 'workflows');

function listWorkflowFiles(root) {
  const dir = path.join(root, WORKFLOW_DIR);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => /\.ya?ml$/i.test(f))
    .map(f => path.join(WORKFLOW_DIR, f))
    .sort();
}

// "actions/checkout@v4" -> { repo: 'actions/checkout', major: 'v4', ref: 'v4' }
// "docker://x" | "./local" | "owner/repo/path@ref" handled too.
function parseUses(ref) {
  if (!ref || ref.startsWith('docker://')) {
    return { kind: ref && ref.startsWith('docker://') ? 'docker' : 'unknown', repo: null, major: null, ref: ref || null };
  }
  if (ref.startsWith('./') || ref.startsWith('.') && ref[1] === '/') {
    return { kind: 'local', repo: null, major: null, ref };
  }
  const at = ref.lastIndexOf('@');
  if (at === -1) return { kind: 'unknown', repo: ref, major: null, ref };
  const repo = ref.slice(0, at);
  const version = ref.slice(at + 1);
  const majorMatch = version.match(/^(v?\d+)/i);
  return { kind: 'action', repo, major: majorMatch ? normaliseMajor(majorMatch[1]) : null, ref: version };
}

function normaliseMajor(m) {
  const s = String(m);
  return s.startsWith('v') || s.startsWith('V') ? 'v' + s.slice(1) : 'v' + s;
}

const TOOL_PATTERNS = [
  ['node', /(?<![\w.-])node(?![\w.-])/],
  ['npm', /(?<![\w.-])npm(?![\w.-])/],
  ['npx', /(?<![\w.-])npx(?![\w.-])/],
  ['yarn', /(?<![\w.-])yarn(?![\w.-])/],
  ['pnpm', /(?<![\w.-])pnpm(?![\w.-])/],
  ['python', /(?<![\w.-])python3?(?![\w.-])/],
  ['pip', /(?<![\w.-])pip3?(?![\w.-])/],
  ['ruby', /(?<![\w.-])ruby(?![\w.-])/],
  ['go', /(?<![\w.-])go\s+(?:run|build|test|install|mod|fmt|vet|get)(?![\w-])/],
  ['java', /(?<![\w.-])(?:java|javac|mvn|gradle)(?![\w.-])/],
  ['cmake', /(?<![\w.-])cmake(?![\w.-])/],
  ['gcc', /(?<![\w.-])(?:gcc|g\+\+)(?![\w.-])/],
  ['docker-compose', /(?:docker\s+compose|docker-compose)/],
  ['conda', /(?<![\w.-])conda(?![\w.-])/],
  ['swift', /(?<![\w.-])swift(?![\w.-])/],
  ['julia', /(?<![\w.-])julia(?![\w.-])/],
  ['hg', /(?<![\w.-])hg(?![\w.-])/],
  ['fastlane', /(?<![\w.-])fastlane(?![\w.-])/],
  ['lerna', /(?<![\w.-])lerna(?![\w.-])/],
  ['newman', /(?<![\w.-])newman(?![\w.-])/],
  ['pulumi', /(?<![\w.-])pulumi(?![\w.-])/],
  ['mediainfo', /(?<![\w.-])mediainfo(?![\w.-])/],
  ['parcel', /(?<![\w.-])parcel(?![\w.-])/],
];

function detectTools(runText) {
  const found = [];
  for (const [name, re] of TOOL_PATTERNS) {
    if (re.test(runText)) found.push(name);
  }
  return found;
}

// Extracts package names from `apt-get install a b=1.2 c/jammy -y` commands,
// tolerating line continuations.
function detectAptPackages(runText) {
  const pkgs = new Set();
  const re = /(?:apt(?:-get)?\s+install|apt\s+install)\s+((?:[^&|;\n]*\\\n)*[^&|;\n]*)/gi;
  let m;
  while ((m = re.exec(runText)) !== null) {
    const chunk = m[1].replace(/\\\n/g, ' ');
    for (let tok of chunk.split(/\s+/)) {
      tok = tok.replace(/[,']+/g, '');
      if (!tok || tok.startsWith('-')) continue;
      tok = tok.split(/[=/:@]/)[0];
      if (/^[a-z0-9][a-z0-9.+-]*$/i.test(tok)) pkgs.add(tok);
    }
  }
  return [...pkgs];
}

// Pull literal version(s) out of a setup action's `with` field. Values may be
// numbers, strings like "20.x" / "3.11", arrays, or ${{ }} expressions.
function extractVersionSpecs(value) {
  if (value == null) return [];
  const list = Array.isArray(value) ? value : [value];
  return list
    .map(v => {
      const s = String(v);
      const mm = s.match(/(\d+(?:\.\d+)*)/);
      return mm ? mm[1] : null;
    })
    .filter(Boolean);
}

function isExpression(value) {
  if (value == null) return false;
  const s = Array.isArray(value) ? value.join(',') : String(value);
  return s.includes('${{');
}

function osLabelsFor(job) {
  const runsOn = job['runs-on'] || job.runs_on;
  const result = { labels: [], matrix: false, unresolved: false };
  if (runsOn == null) return result;
  const candidates = Array.isArray(runsOn) ? runsOn : [runsOn];
  for (const c of candidates) {
    const s = String(c);
    if (s.includes('${{')) {
      const matrix = job.strategy && job.strategy.matrix;
      const expanded = expandMatrixOs(matrix);
      if (expanded.length) result.labels.push(...expanded);
      else result.unresolved = true;
      if (s.includes('matrix')) result.matrix = true;
    } else {
      result.labels.push(s);
    }
  }
  result.labels = [...new Set(result.labels)];
  return result;
}

function expandMatrixOs(matrix) {
  if (!matrix || !matrix.os) return [];
  const values = Array.isArray(matrix.os) ? matrix.os : [matrix.os];
  return values.map(String).filter(v => !v.includes('${{'));
}

function scanWorkflow(root, relFile) {
  const abs = path.join(root, relFile);
  const raw = fs.readFileSync(abs, 'utf8');
  const entry = { file: relFile.split(path.sep).join('/'), parseError: null, jobs: [] };
  let doc;
  try {
    doc = YAML.parse(raw);
  } catch (e) {
    entry.parseError = e.message;
    return entry;
  }
  if (!doc || typeof doc !== 'object' || !doc.jobs) {
    entry.parseError = 'no jobs found';
    return entry;
  }
  for (const [jobId, job] of Object.entries(doc.jobs)) {
    if (!job || typeof job !== 'object') continue;
    const os = osLabelsFor(job);
    const uses = [];
    const setups = [];
    const tools = [];
    const aptPackages = new Set();

    for (const step of job.steps || []) {
      if (step.uses) {
        const u = parseUses(step.uses);
        if (u.kind === 'action') {
          uses.push(u);
          if (/^actions\/setup-(node|python|java|go|dotnet)$/.test(u.repo)) {
            const tool = u.repo.split('-')[1];
            const w = (step.with || {});
            const specField = {
              node: ['node-version'],
              python: ['python-version'],
              java: ['java-version', 'distribution'],
              go: ['go-version'],
              dotnet: ['dotnet-version'],
            }[tool];
            let specs = [];
            for (const f of specField) {
              if (f === 'distribution') continue;
              specs.push(...extractVersionSpecs(w[f]));
            }
            const expr = specField.some(f => isExpression(w[f]));
            setups.push({ action: u.repo, major: u.major, tool, specs: [...new Set(specs)], expression: expr });
          }
        } else {
          uses.push(u);
        }
      }
      if (typeof step.run === 'string') {
        for (const t of detectTools(step.run)) tools.push(t);
        for (const p of detectAptPackages(step.run)) aptPackages.add(p);
      }
    }

    entry.jobs.push({
      id: jobId,
      name: job.name || jobId,
      osLabels: os.labels,
      osFromMatrix: os.matrix,
      osUnresolved: os.unresolved,
      container: typeof job.container === 'string' ? job.container
        : job.container && job.container.image ? job.container.image : null,
      uses,
      setups,
      tools: [...new Set(tools)],
      aptPackages: [...aptPackages],
    });
  }
  return entry;
}

function scanRepo(root) {
  const files = listWorkflowFiles(root);
  return { root, workflows: files.map(f => scanWorkflow(root, f)) };
}

module.exports = {
  scanRepo, scanWorkflow, listWorkflowFiles, parseUses,
  detectTools, detectAptPackages, extractVersionSpecs, osLabelsFor,
};
