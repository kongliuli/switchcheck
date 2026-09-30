'use strict';

// Turns a scan + the runner-image knowledge base into findings. Every rule
// cites the image data it came from, so the report is auditable.

const { finding } = require('../engine');

const UBUNTU_RE = /^ubuntu-/;

function loadKb() {
  return require('../../data/ubuntu-images.json');
}

function checkScan(scan, kb = loadKb()) {
  const sections = [];
  for (const wf of scan.workflows) {
    const findings = checkWorkflow(wf, kb);
    sections.push({ name: wf.file, findings });
  }
  sections.push({ name: 'Rollout timeline', findings: rolloutFindings(kb, scan) });
  return sections;
}

function ubuntuJobs(wf) {
  return wf.jobs.filter(j => j.osLabels.some(UBUNTU_RE.test.bind(UBUNTU_RE)));
}

function checkWorkflow(wf, kb) {
  if (wf.parseError) {
    return [finding('red', 'Workflow could not be parsed', wf.parseError,
      'Fix the YAML syntax; SwitchCheck cannot judge a file it cannot read.')];
  }
  const findings = [];
  const jobs = ubuntuJobs(wf);
  if (!jobs.length) {
    const unresolved = wf.jobs.some(j => j.osUnresolved);
    if (unresolved) {
      findings.push(finding('info', 'runs-on uses an expression SwitchCheck could not resolve',
        'Check by hand which OS labels the matrix expands to.',
        'Look at strategy.matrix in this workflow.'));
    } else {
      findings.push(finding('green', 'No Ubuntu runner jobs in this workflow',
        'macOS/Windows jobs are not affected by the ubuntu-latest flip.', ''));
    }
    return findings;
  }

  // ---- runner labels ------------------------------------------------------
  const labelCount = new Map();
  for (const j of jobs) {
    for (const l of j.osLabels.filter(UBUNTU_RE.test.bind(UBUNTU_RE))) {
      labelCount.set(l, (labelCount.get(l) || 0) + 1);
    }
  }
  for (const [label, n] of labelCount) findings.push(...labelFindings(label, n, kb));
  if (jobs.some(j => j.osUnresolved)) {
    findings.push(finding('info', 'Some runs-on values are unresolvable expressions',
      'A matrix entry contains ${{ }} indirection; the labels above are the literal ones found.',
      'Verify manually which Ubuntu versions the matrix picks.'));
  }

  // ---- action runtimes ----------------------------------------------------
  findings.push(...actionRuntimeFindings(jobs, kb));

  // ---- pinned toolchains (setup-* with versions) ---------------------------
  findings.push(...pinnedToolchainFindings(jobs, kb));

  // ---- reliance on image defaults ------------------------------------------
  findings.push(...bareToolFindings(jobs, kb));

  // ---- tools removed from the 26.04 image ----------------------------------
  const removed = new Map();
  for (const j of jobs) {
    for (const t of j.tools) {
      if (kb.removedIn26Binaries.includes(t)) {
        removed.set(t, (removed.get(t) || 0) + 1);
      }
    }
  }
  if (removed.size) {
    const list = [...removed.keys()].join(', ');
    findings.push(finding('red', `Uses tool(s) removed from the 26.04 image: ${list}`,
      'Preinstalled on 24.04 but gone on 26.04: ' + kb.removedIn26.join(', ') + '.',
      'Install the tool explicitly in the workflow step (e.g. via its official setup action, pip/npm/apt), or run the job in a container.'));
  }

  // ---- apt packages --------------------------------------------------------
  const allApt = new Map();
  for (const j of jobs) for (const p of j.aptPackages) allApt.set(p, (allApt.get(p) || 0) + 1);
  const watched = [...allApt.keys()].filter(p => kb.aptWatch[p]);
  for (const p of watched) {
    findings.push(finding('yellow', `apt package "${p}" changes between 24.04 and 26.04`,
      kb.aptWatch[p], 'Test on ubuntu-26.04 before the flip (switchcheck ci --trial).'));
  }
  const rest = [...allApt.keys()].filter(p => !kb.aptWatch[p]);
  if (rest.length) {
    findings.push(finding('info', `${rest.length} other apt packages assumed available`,
      rest.join(', '), 'Ubuntu universe packages carry over; only major-version jumps matter.'));
  }

  // ---- container jobs -------------------------------------------------------
  const containerJobs = jobs.filter(j => j.container);
  if (containerJobs.length) {
    findings.push(finding('green', `${containerJobs.length} job(s) run in containers — insulated from host toolchain changes`,
      'Images: ' + [...new Set(containerJobs.map(j => j.container))].join(', ') +
      '. Only the Docker engine itself changes (28.0 → 29.4).',
      'No action needed for the 26.04 flip.'));
  }

  return dedupe(findings);
}

function labelFindings(label, count, kb) {
  const n = count === 1 ? '1 job' : `${count} jobs`;
  switch (label) {
    case 'ubuntu-latest':
      return [finding('yellow', `${n} run on ubuntu-latest — silently becomes 26.04 during rollout`,
        `GitHub flips the ubuntu-latest label to 26.04 in batches between ${kb.latestRollout.phaseStart} and ${kb.latestRollout.completeBy}. Default Python 3.12→${kb.images['ubuntu-26.04'].defaultPython}, Node ${kb.images['ubuntu-24.04'].defaultNode.split('.')[0]}→${kb.images['ubuntu-26.04'].defaultNode.split('.')[0]}, JDK ${kb.images['ubuntu-24.04'].javaDefault}→${kb.images['ubuntu-26.04'].javaDefault}, CMake 3→4, Java 8 gone.`,
        'Pin ubuntu-24.04 today to freeze behavior; run `switchcheck ci --trial` to open a PR that tests ubuntu-26.04.')];
    case 'ubuntu-24.04':
      return [finding('green', `${n} pin ubuntu-24.04 — unaffected by the flip`,
        'ubuntu-latest moves to 26.04; the ubuntu-24.04 label keeps pointing at the 24.04 image (supported until the 28.04 era).',
        'Nothing required now; schedule a 26.04 migration at your own pace.')];
    case 'ubuntu-22.04':
      return [finding('yellow', `${n} pin ubuntu-22.04 — oldest image, retirement is next`,
        'GitHub keeps only the two newest GA Ubuntu images once 26.04 reaches GA; 22.04 follows 20.04 into retirement.',
        'Move to ubuntu-24.04 (safe) or ubuntu-26.04 (latest) before retirement is announced.')];
    case 'ubuntu-20.04':
      return [finding('red', `${n} pin ubuntu-20.04 — image already retired`,
        'The 20.04 image was retired; these jobs fail to start.',
        'Switch to ubuntu-24.04 or ubuntu-26.04 immediately.')];
    case 'ubuntu-26.04':
    case 'ubuntu-26.04-arm':
      return [finding('green', `${n} already run on ${label}`,
        'You are ahead of the rollout; nothing changes for you on the flip dates.', '')];
    default:
      if (/-arm$/.test(label)) {
        return [finding('green', `${n} run on ${label}`,
          'Arm images follow the same lifecycle as their x64 siblings.', '')];
      }
      return [finding('info', `${n} run on ${label}`, 'Unknown label; no rule matched.', 'Verify manually.')];
  }
}

function actionRuntimeFindings(jobs, kb) {
  const kbActions = kb.actionsRuntime.actions;
  const seen = new Map(); // "repo@major" -> count
  const unknown = new Map();
  for (const j of jobs) {
    for (const u of j.uses) {
      if (u.kind !== 'action' || !u.major) continue;
      const key = `${u.repo}@${u.major}`;
      if (kbActions[u.repo]) seen.set(key, (seen.get(key) || 0) + 1);
      else unknown.set(u.repo, (unknown.get(u.repo) || 0) + 1);
    }
  }
  const findings = [];
  for (const [key, n] of seen) {
    const [repo, major] = key.split('@');
    const meta = kbActions[repo];
    const runtime = meta.runtime[major];
    const where = `${key} (${n} use${n === 1 ? '' : 's'})`;
    if (runtime === 'node24') {
      findings.push(finding('green', `${key} runs on the node24 runtime`,
        `Current major is ${meta.latest}; this one is fine.`, ''));
    } else if (runtime === 'node20') {
      findings.push(finding('yellow', `${where} run on the node20 runtime — end of life 2026-04-30`,
        `GitHub is migrating actions off node20 the way it forced node16 out in 2024; the 26.04-image era is the deadline everyone targets.`,
        `Upgrade to ${repo}@${meta.latest} (check its release notes for inputs that changed).`));
    } else {
      findings.push(finding('red', `${where} run on the node16 runtime — already force-failed`,
        `node16 actions were switched off by the runner in 2024.`,
        `Upgrade to ${repo}@${meta.latest}.`));
    }
  }
  if (unknown.size) {
    const list = [...unknown.keys()].map(r => `${r}@${unknown.get(r)}`).join(', ');
    findings.push(finding('info', `${unknown.size} action(s) not covered by the runtime knowledge base`,
      list, 'Check their action.yml `using:` field — node24 is the supported runtime now.'));
  }
  return findings;
}

function pinnedToolchainFindings(jobs, kb) {
  const findings = [];
  const img24 = kb.images['ubuntu-24.04'];
  const img26 = kb.images['ubuntu-26.04'];
  const nodeAgg = new Map();
  for (const j of jobs) {
    for (const s of j.setups) {
      if (s.tool === 'node') {
        if (s.expression) {
          nodeAgg.set('expression', (nodeAgg.get('expression') || 0) + 1);
          continue;
        }
        for (const spec of s.specs) nodeAgg.set(spec, (nodeAgg.get(spec) || 0) + 1);
      }
    }
  }
  for (const [spec, n] of nodeAgg) {
    if (spec === 'expression') {
      findings.push(finding('info', 'Node version comes from a matrix expression',
        'SwitchCheck cannot see which majors the matrix expands to.',
        'Both images toolcache Node ' + kb.images['ubuntu-26.04'].toolcacheNode.join(' & ') + '; anything older is unsupported.'));
      continue;
    }
    const major = parseInt(spec, 10);
    const where = n === 1 ? 'One job' : `${n} jobs`;
    if (major === 22 || major === 24) {
      findings.push(finding('green', `${where} pin Node ${spec} — present on both images`,
        `Toolcache on 24.04 and 26.04 both carry Node ${img24.toolcacheNode.join(' & ')}.`, ''));
    } else if (major === 20) {
      findings.push(finding('yellow', `${where} pin Node ${spec} — EOL since 2026-04-30, absent from 26.04`,
        'setup-node can still download it, but it is unsupported and no longer in the runner toolcache.',
        'Move to Node 22 (LTS) or 24 (current); run your test matrix on both.'));
    } else if (major <= 19) {
      findings.push(finding('red', `${where} pin Node ${spec} — long past end-of-life`,
        'Node ' + spec + ' has been unsupported for years; downstream binaries (npm >= 11, ES modules tooling) are dropping it.',
        'Upgrade to Node 22 or 24.'));
    } else {
      findings.push(finding('yellow', `${where} pin Node ${spec} — non-LTS release line`,
        'Odd-numbered Node lines live ~6 months; the images only cache LTS 22 and current 24.',
        'Prefer 22 or 24 for CI.'));
    }
  }

  const pyAgg = new Map();
  for (const j of jobs) {
    for (const s of j.setups) {
      if (s.tool !== 'python') continue;
      if (s.expression) { pyAgg.set('expression', (pyAgg.get('expression') || 0) + 1); continue; }
      for (const spec of s.specs) pyAgg.set(spec, (pyAgg.get(spec) || 0) + 1);
    }
  }
  for (const [spec, n] of pyAgg) {
    if (spec === 'expression') {
      findings.push(finding('info', 'Python version comes from a matrix expression',
        'Both images toolcache Python ' + img26.toolcachePython.join(', ') + '.', ''));
      continue;
    }
    const minor = parseInt(spec.split('.')[1] !== undefined ? spec.split('.')[1] : spec, 10);
    const where = n === 1 ? 'One job' : `${n} jobs`;
    if (img26.toolcachePython.some(v => v === spec || spec.startsWith(v + '.'))) {
      findings.push(finding('green', `${where} pin Python ${spec} — cached on both images`,
        `Default system python still moves ${img24.defaultPython} → ${img26.defaultPython}, but setup-python pins are unaffected.`, ''));
    } else if (minor < 10) {
      findings.push(finding('yellow', `${where} pin Python ${spec} — EOL, not in the 26.04 toolcache`,
        'setup-python downloads it from python-versions, which still serves old builds — for now.',
        'Plan a move to 3.10+ (3.14 is the 26.04 default).'));
    } else {
      findings.push(finding('info', `${where} pin Python ${spec}`,
        `Toolcache on 26.04: ${img26.toolcachePython.join(', ')}; setup-python will fetch it if missing.`, ''));
    }
  }

  for (const j of jobs) {
    for (const s of j.setups) {
      if (s.tool === 'java' && s.specs.some(x => x.startsWith('8'))) {
        findings.push(finding('yellow', 'Pinned Java 8 — no longer on the 26.04 image',
          `The 26.04 image ships JDK ${img26.javaVersions.join(', ')} (default ${img26.javaDefault}); Java 8 was dropped.`,
          'setup-java still installs JDK 8 from Temurin, but treat it as a compatibility tail — test on JDK 11+.'));
      }
    }
  }
  return findings;
}

function bareToolFindings(jobs, kb) {
  const findings = [];
  const img24 = kb.images['ubuntu-24.04'];
  const img26 = kb.images['ubuntu-26.04'];
  const agg = new Map();
  for (const j of jobs) {
    if (j.container) continue; // container isolates defaults
    const has = t => j.tools.includes(t);
    const hasSetup = t => j.setups.some(s => s.tool === t);
    if ((has('node') || has('npm') || has('npx')) && !hasSetup('node')) agg.set('node', (agg.get('node') || 0) + 1);
    if ((has('python') || has('pip')) && !hasSetup('python')) agg.set('python', (agg.get('python') || 0) + 1);
    if (has('java') && !hasSetup('java')) agg.set('java', (agg.get('java') || 0) + 1);
    if (has('ruby')) agg.set('ruby', (agg.get('ruby') || 0) + 1);
    if (has('cmake')) agg.set('cmake', (agg.get('cmake') || 0) + 1);
    if (has('gcc')) agg.set('gcc', (agg.get('gcc') || 0) + 1);
    if (has('docker-compose')) agg.set('docker-compose', (agg.get('docker-compose') || 0) + 1);
  }
  const n = c => c === 1 ? '1 job' : `${c} jobs`;
  if (agg.has('node')) {
    findings.push(finding('yellow', `${n(agg.get('node'))} use node/npm without setup-node — image default flips`,
      `Default Node ${img24.defaultNode} → ${img26.defaultNode}, npm ${img24.defaultNpm} → ${img26.defaultNpm}. npm 11 is stricter about engines and lockfile v3+.`,
      'Add actions/setup-node with an explicit node-version.'));
  }
  if (agg.has('python')) {
    findings.push(finding('yellow', `${n(agg.get('python'))} use python3/pip without setup-python — image default flips`,
      `Default python3 ${img24.defaultPython} → ${img26.defaultPython}, pip ${img24.defaultPip} → ${img26.defaultPip}. Deprecation warnings and removed stdlib shims surface on 3.14.`,
      'Add actions/setup-python with an explicit python-version.'));
  }
  if (agg.has('java')) {
    findings.push(finding('yellow', `${n(agg.get('java'))} use java/maven/gradle without setup-java — default JDK flips`,
      `Default JDK ${img24.javaDefault} → ${img26.javaDefault}; Java 8 is gone from the image entirely.`,
      'Add actions/setup-java and pin the distribution + version.'));
  }
  if (agg.has('ruby')) {
    findings.push(finding('yellow', `${n(agg.get('ruby'))} use ruby without setup-ruby — image default flips`,
      `Default ruby ${img24.defaultRuby} → ${img26.defaultRuby}.`,
      'Add ruby/setup-ruby with a pinned version.'));
  }
  if (agg.has('cmake')) {
    findings.push(finding('yellow', `${n(agg.get('cmake'))} invoke cmake — major version jump on the image`,
      `CMake ${img24.cmake} → ${img26.cmake}. CMake 4 rejects projects declaring cmake_minimum_required below 3.5.`,
      'Bump cmake_minimum_required, or install cmake 3.x explicitly in the job.'));
  }
  if (agg.has('gcc')) {
    findings.push(finding('yellow', `${n(agg.get('gcc'))} compile with gcc/g++ — default compiler jumps 2 majors`,
      `Default gcc ${img24.gccDefault} → ${img26.gccDefault}. GCC 14/15 turn many old warnings into errors; -Werror builds break.`,
      'Build once on ubuntu-26.04 before the flip and fix warnings, or pin gcc-13 via apt.'));
  }
  if (agg.has('docker-compose')) {
    findings.push(finding('yellow', `${n(agg.get('docker-compose'))} use docker compose — major version jump`,
      `Docker Compose ${img24.dockerCompose} → ${img26.dockerCompose}, engine ${img24.docker} → ${img26.docker}.`,
      'Check deprecated compose flags (e.g. `--compatibility`) in your scripts.'));
  }
  return findings;
}

function rolloutFindings(kb, scan) {
  const r = kb.latestRollout;
  const findings = [finding('info',
    `ubuntu-latest flips to 26.04 between ${r.phaseStart} and ${r.completeBy}`,
    `Today the label means ${r.current} (default Node ${kb.images[r.current].defaultNode}, Python ${kb.images[r.current].defaultPython}). After the flip: ${r.target} (Node ${kb.images[r.target].defaultNode}, Python ${kb.images[r.target].defaultPython}).`,
    'Run `switchcheck ci --trial` to open a PR that pins ubuntu-26.04 and proves your build survives.')];
  const hasLatest = scan.workflows.some(wf => wf.jobs.some(j => j.osLabels.includes('ubuntu-latest')));
  if (!hasLatest) {
    findings.push(finding('green', 'No ubuntu-latest usage — the flip cannot surprise you',
      'All Ubuntu jobs are pinned explicitly.', ''));
  }
  return findings;
}

function dedupe(findings) {
  const seen = new Set();
  return findings.filter(f => {
    const key = f.status + '|' + f.title;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

module.exports = { checkScan, checkWorkflow, loadKb };
