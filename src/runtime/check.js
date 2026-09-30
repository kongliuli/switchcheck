'use strict';

// Matches scanned runtime declarations against the EOL knowledge base.
// red = EOL passed, yellow = EOL within the warning window, green = supported.

const { finding } = require('../engine');

const DAY = 24 * 60 * 60 * 1000;
const WARN_DAYS = 90;

function loadKb() {
  return require('../../data/runtime-eol.json');
}

function versionFinding(tool, version, from, kb, now) {
  const runtime = kb.runtimes[tool];
  const label = runtime ? runtime.label : tool;
  const title = `${label} ${version || '?'}`;
  const extra = { runtime: tool, version, from };
  if (!runtime || !version) {
    return finding('info', `${title}（无法识别的版本）`, `声明来自 ${from}，但解析不出可比对的版本号。`, '', extra);
  }
  const entry = runtime.majors[version];
  if (!entry) {
    return finding('info', `${title}（知识库未收录）`, `该主版本的维护时间表不在快照 ${kb.snapshotDate} 中。`, '', extra);
  }
  const eolAt = new Date(entry.eol + 'T00:00:00Z').getTime();
  const days = Math.round((eolAt - now.getTime()) / DAY);
  if (days < 0) {
    return finding('red', `${title} 已停止安全维护`,
      `EOL ${entry.eol}（已是 ${-days} 天前）— 不再发布安全补丁。`,
      `把 ${from} 升到受支持的${label}版本。`, extra);
  }
  if (days <= WARN_DAYS) {
    return finding('yellow', `${title} 即将停止维护`,
      `EOL ${entry.eol}（还剩 ${days} 天）。`,
      `提前安排升级：更新 ${from} 并在 CI 里先试跑新版本。`, extra);
  }
  return finding('green', `${title} 受支持`, `维护至 ${entry.eol}。`, '', extra);
}

function checkScan(scan, kb = loadKb(), now = new Date()) {
  const sections = [];
  for (const f of scan.files) {
    const findings = [];
    if (f.parseError) {
      findings.push(finding('info', 'package.json 解析失败', '文件不是合法 JSON，跳过其中的版本声明。', ''));
    }
    for (const s of f.specs) {
      findings.push(versionFinding(f.tool, s.version, s.from, kb, now));
    }
    if (findings.length) sections.push({ name: f.file, findings });
  }
  if (!sections.length) {
    sections.push({
      name: 'Runtime',
      findings: [finding('info', '没有找到运行时版本声明',
        '检查过 package.json（engines.node / volta.node）、.nvmrc、.node-version、.python-version 和 pyproject.toml（requires-python）。',
        '在 engines 或 requires-python 里声明版本后重查。', {})],
    });
  }
  return sections;
}

module.exports = { checkScan, loadKb, versionFinding };
