'use strict';

// Terminal renderer. Respects NO_COLOR and non-TTY pipes.

const { countByStatus, verdict, sortFindings } = require('../engine');

const SYMBOL = { red: '✖', yellow: '⚠', green: '✔', info: 'ℹ' };
const ANSI = {
  red: s => `\x1b[31m${s}\x1b[0m`,
  yellow: s => `\x1b[33m${s}\x1b[0m`,
  green: s => `\x1b[32m${s}\x1b[0m`,
  info: s => `\x1b[36m${s}\x1b[0m`,
  dim: s => `\x1b[2m${s}\x1b[0m`,
  bold: s => `\x1b[1m${s}\x1b[0m`,
};

function useColor(stream = process.stdout) {
  if (process.env.NO_COLOR) return false;
  return stream && stream.isTTY;
}

function renderLine(f, color) {
  const mark = color ? ANSI[f.status](`${SYMBOL[f.status]} ${f.title}`) : `${SYMBOL[f.status]} ${f.title}`;
  const lines = [mark];
  if (f.detail) lines.push(color ? ANSI.dim(`    ${f.detail}`) : `    ${f.detail}`);
  if (f.advice) {
    const label = color ? ANSI.bold('    Fix: ') : '    Fix: ';
    lines.push(label + f.advice);
  }
  return lines.join('\n');
}

function render(title, sections, { color = null } = {}) {
  const c = color === null ? useColor() : color;
  const out = [];
  out.push(c ? ANSI.bold(title) : title);
  out.push('');

  const all = sections.flatMap(s => s.findings);
  for (const section of sections) {
    if (!section.findings.length) continue;
    out.push(c ? ANSI.bold(section.name) : section.name);
    for (const f of sortFindings(section.findings)) {
      out.push(renderLine(f, c));
    }
    out.push('');
  }

  const counts = countByStatus(all);
  out.push(c ? ANSI.bold('Summary') : 'Summary');
  out.push(
    `  ${SYMBOL.red} ${counts.red} blocking   ${SYMBOL.yellow} ${counts.yellow} review   ` +
    `${SYMBOL.green} ${counts.green} ok   ${SYMBOL.info} ${counts.info} info`
  );
  const v = verdict(all);
  const headline = c ? ANSI[v.status](`${SYMBOL[v.status]} ${v.headline}`) : `${SYMBOL[v.status]} ${v.headline}`;
  out.push(`  ${headline}`);
  return out.join('\n');
}

module.exports = { render, useColor, ANSI, SYMBOL };
