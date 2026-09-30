'use strict';

// Shared core: every SwitchCheck module is the same shape —
//   scan a source (a repo, a machine) → emit Findings → render.
// A Finding is the only currency; statuses match a traffic light.

const STATUS_LEVEL = { red: 0, yellow: 1, green: 2, info: 3 };

function normalizeStatus(s) {
  return STATUS_LEVEL.hasOwnProperty(s) ? s : 'info';
}

function finding(status, title, detail, advice, extra) {
  const f = {
    status: normalizeStatus(status),
    title: String(title),
    detail: detail || '',
    advice: advice || '',
  };
  if (extra && typeof extra === 'object') Object.assign(f, extra);
  return f;
}

function worstStatus(findings) {
  let worst = null;
  for (const f of findings) {
    if (!worst || STATUS_LEVEL[f.status] < STATUS_LEVEL[worst]) worst = f.status;
  }
  return worst || 'green';
}

function countByStatus(findings) {
  const counts = { red: 0, yellow: 0, green: 0, info: 0 };
  for (const f of findings) counts[f.status]++;
  return counts;
}

// Overall verdict for a set of findings.
function verdict(findings) {
  const worst = worstStatus(findings);
  if (worst === 'red') {
    return { status: 'red', headline: 'Not ready — blocking issues found' };
  }
  if (worst === 'yellow') {
    return { status: 'yellow', headline: 'Probably fine — items need review' };
  }
  return { status: 'green', headline: 'Ready to switch' };
}

function sortFindings(findings) {
  return [...findings].sort((a, b) => STATUS_LEVEL[a.status] - STATUS_LEVEL[b.status]);
}

module.exports = { finding, worstStatus, countByStatus, verdict, sortFindings, STATUS_LEVEL };
