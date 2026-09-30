'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { verdict, countByStatus } = require('./engine');
const terminal = require('./report/terminal');
const markdown = require('./report/markdown');
const html = require('./report/html');
const ciScan = require('./ci/scan');
const ciCheck = require('./ci/check');
const { runTrial } = require('./ci/trial');
const collect = require('./desktop/collect');
const { checkMachine, loadKbs } = require('./desktop/check');

const VERSION = require('../package.json').version;

function parseArgs(argv) {
  const flags = {};
  const positionals = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--trial') flags.trial = true;
    else if (a === '--dry-run') flags.dryRun = true;
    else if (a === '--json') flags.json = true;
    else if (a === '--md') flags.md = argv[++i];
    else if (a === '--html') flags.html = argv[++i];
    else if (a === '--open') flags.open = true;
    else if (a === '--from') flags.from = argv[++i];
    else if (a === '--fail-on') flags.failOn = argv[++i];
    else if (a === '--no-md') flags.noMd = true;
    else if (a === '--no-html') flags.noHtml = true;
    else if (!a.startsWith('-')) positionals.push(a);
    else flags[a] = true;
  }
  return { flags, positionals };
}

function writeReports(title, sections, meta, { mdPath, htmlPath }) {
  const written = [];
  if (mdPath) {
    fs.writeFileSync(mdPath, markdown.render(title, sections, meta));
    written.push(mdPath);
  }
  if (htmlPath) {
    fs.writeFileSync(htmlPath, html.render(title, sections, meta));
    written.push(htmlPath);
  }
  return written;
}

function jsonOut(cmd, sections, extra = {}) {
  const all = sections.flatMap(s => s.findings);
  process.stdout.write(JSON.stringify({
    tool: 'switchcheck', version: VERSION, command: cmd,
    generatedAt: new Date().toISOString(),
    verdict: verdict(all),
    counts: countByStatus(all),
    sections,
    ...extra,
  }, null, 2) + '\n');
}

function exitCodeFor(sections, failOn) {
  if (!failOn) return 0;
  const all = sections.flatMap(s => s.findings);
  const counts = countByStatus(all);
  if (failOn === 'red' && counts.red > 0) return 1;
  if (failOn === 'yellow' && (counts.red > 0 || counts.yellow > 0)) return 1;
  return 0;
}

function cmdCi(positionals, flags) {
  const root = path.resolve(positionals[0] || '.');
  if (!fs.existsSync(path.join(root, '.github', 'workflows'))) {
    process.stderr.write(`No .github/workflows directory found in ${root}\n`);
    return 2;
  }
  const kb = ciCheck.loadKb();
  const scan = ciScan.scanRepo(root);
  const sections = ciCheck.checkScan(scan, kb);
  const title = `SwitchCheck CI — Ubuntu 26.04 readiness (${kb.latestRollout.phaseStart} flip)`;
  const meta = { generatedAt: new Date().toISOString().slice(0, 10), kbDate: kb.snapshotDate };

  if (flags.json) {
    jsonOut('ci', sections);
  } else {
    process.stdout.write(terminal.render(title, sections) + '\n');
    if (!flags.noMd) {
      const mdPath = flags.md || path.join(process.cwd(), 'switchcheck-ci-report.md');
      writeReports(title, sections, meta, { mdPath });
      process.stdout.write(`\nMarkdown report written to ${mdPath}\n`);
    }
  }

  if (flags.trial) {
    const res = runTrial(root, { dryRun: flags.dryRun, log: m => process.stdout.write(m + '\n') });
    if (!res.ok && res.reason !== 'no-change') {
      process.stderr.write(`Trial failed: ${res.message}\n`);
      return 2;
    }
    if (res.message) process.stdout.write(`\n${res.message}\n`);
  }
  return exitCodeFor(sections, flags.failOn);
}

function cmdLinux(flags) {
  if (process.platform !== 'win32' && !flags.from) {
    process.stderr.write('`switchcheck linux` scans a Windows machine — run it on Windows, or pass --from <collection.json>.\n');
    return 2;
  }
  let machine;
  if (flags.from) {
    machine = JSON.parse(fs.readFileSync(path.resolve(flags.from), 'utf8'));
  } else {
    process.stderr.write('Collecting installed software, Steam library, hardware and printers…\n');
    machine = collect.collectAll();
  }
  const kbs = loadKbs();
  const sections = checkMachine(machine, kbs);
  const kbDate = [kbs.apps.updatedAt, kbs.hardware.updatedAt, kbs.games.updatedAt].sort().pop();
  const title = `SwitchCheck — Windows → Linux readiness${machine.host ? ` (${machine.host})` : ''}`;
  const meta = { generatedAt: new Date().toISOString().slice(0, 10), kbDate };

  if (flags.json) {
    jsonOut('linux', sections, { host: machine.host });
    return exitCodeFor(sections, flags.failOn);
  }
  process.stdout.write(terminal.render(title, sections) + '\n');
  const written = writeReports(title, sections, meta, {
    mdPath: flags.noMd ? null : (flags.md || path.join(process.cwd(), 'switchcheck-linux-report.md')),
    htmlPath: flags.noHtml ? null : (flags.html || path.join(process.cwd(), 'switchcheck-linux-report.html')),
  });
  if (written.length) process.stdout.write(`\nReport written to ${written.join(', ')}\n`);
  if (flags.open) {
    const htmlFile = written.find(f => f.endsWith('.html'));
    if (htmlFile) spawnSync('cmd', ['/c', 'start', '', htmlFile], { shell: false });
  }
  return exitCodeFor(sections, flags.failOn);
}

const HELP = `switchcheck ${VERSION} — pre-flight checks before you switch environments

Usage:
  switchcheck ci [path]        Scan GitHub Actions workflows for Ubuntu 26.04 readiness
    --trial                    Also create a branch (and PR via gh) pinning ubuntu-26.04
    --dry-run                  Preview the --trial rewrites without touching git
    --json                     Machine-readable JSON instead of terminal+markdown
    --md <file> / --no-md      Markdown report path / disable (default: ./switchcheck-ci-report.md)
    --fail-on red|yellow       Exit 1 when findings at this level exist

  switchcheck linux            Scan THIS Windows machine for Linux readiness
    --json                     Machine-readable JSON
    --md <file> / --html <file>  Report paths (defaults: ./switchcheck-linux-report.*)
    --open                     Open the HTML report in the browser
    --from <collection.json>   Re-check a saved collection instead of scanning
    --fail-on red|yellow       Exit 1 when findings at this level exist

  switchcheck help             Show this help

Knowledge bases live in data/ and are plain JSON — send corrections as PRs.
`;

function run(argv) {
  const { flags, positionals } = parseArgs(argv);
  const cmd = positionals.shift();
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    process.stdout.write(HELP);
    return 0;
  }
  if (cmd === 'version' || cmd === '--version' || cmd === '-v') {
    process.stdout.write(VERSION + '\n');
    return 0;
  }
  if (cmd === 'ci') return cmdCi(positionals, flags);
  if (cmd === 'linux') return cmdLinux(flags);
  process.stderr.write(`Unknown command "${cmd}". Run switchcheck help.\n`);
  return 2;
}

module.exports = { run, parseArgs };
