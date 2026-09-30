'use strict';

// Matches a collected machine (software / steam / hardware / printers from
// collect.js) against the Linux knowledge bases and produces findings.

const { finding } = require('../engine');

function loadKbs() {
  return {
    apps: require('../../data/linux-apps.json'),
    hardware: require('../../data/linux-hardware.json'),
    games: require('../../data/steam-games.json'),
  };
}

const norm = s => String(s || '').toLowerCase().replace(/[™®©]/g, '').trim();

function matchEntry(name, entries) {
  const n = norm(name);
  for (const e of entries) {
    if ((e.exclude || []).some(x => n.includes(norm(x)))) continue;
    if ((e.match || [norm(e.name)]).some(m => n.includes(norm(m)))) return e;
  }
  return null;
}

// Windows bookkeeping entries that are meaningless on Linux.
const SYSTEM_NOISE = /redistributable|update for|\bkb\d{5,}\b|runtime component|language pack|security update|system component|external package|application verifier|diagnosticshub|icecap_|iis |compatibility database|windows sdk|targeting pack|\.net framework|asp\.net|visual studio tools|directx runtime|wlcm |sdk setup/i;
const KIND_STATUS = { native: 'green', alternative: 'yellow', wine: 'yellow', proton: 'yellow', blocked: 'red' };

function appFinding(app, kb) {
  const entry = matchEntry(app.name, kb.apps.apps);
  const e = entry || { ...kb.apps.default, name: app.name };
  const status = KIND_STATUS[e.kind] || 'yellow';
  const title = `${app.name}${app.version ? ` (${app.version})` : ''}`;
  const detail = e.note || '';
  let advice = '';
  if (e.kind === 'native') advice = '';
  else if (e.kind === 'alternative') advice = e.alt ? `Use ${e.alt} instead.` : 'Look for a Linux equivalent.';
  else if (e.kind === 'wine') advice = `Runs under Wine (try Bottles or Lutris).${e.alt ? ` Native alternative: ${e.alt}.` : ''}`;
  else if (e.kind === 'proton') advice = 'Runs via Steam Proton — check the rating before switching.';
  else advice = e.alt ? `Closest options: ${e.alt}.` : 'No viable path on Linux.';
  const url = e.url || (entry ? undefined : 'https://flathub.org/');
  return finding(status, title, detail, advice, url ? { url } : {});
}

function gameFinding(game, kb) {
  const byId = kb.games.games.find(g => g.appid && g.appid === game.appid);
  const entry = byId || matchEntry(game.name, kb.games.games.filter(g => !g.appid));
  const e = entry || {
    ...kb.games.default,
    name: game.name,
    url: `https://www.protondb.com/search/${encodeURIComponent(game.name)}`,
  };
  const status = KIND_STATUS[e.kind] || 'yellow';
  const detail = e.note;
  let advice;
  if (e.kind === 'native') advice = 'Native Linux build — nothing to do.';
  else if (e.kind === 'blocked') advice = 'Anti-cheat blocks Linux; keep a Windows partition/VM for this one.';
  else advice = 'Enable Steam Play (Proton) for all titles; check the ProtonDB rating.';
  return finding(status, game.name, detail, advice, e.url ? { url: e.url } : {});
}

function hardwareFinding(kind, item, entries, fallback) {
  const e = matchEntry(item.name, entries) || { ...fallback, name: item.name };
  const status = KIND_STATUS[e.kind] || 'yellow';
  const title = `${e.name || item.name}${item.name && e.name !== item.name ? ` — ${item.name}` : ''}`;
  return finding(status, title, e.note || '', e.advice || '', e.url ? { url: e.url } : {});
}

function checkMachine(machine, kb = loadKbs()) {
  const sections = [];

  // ---- applications --------------------------------------------------------
  const findings = [];
  let noise = 0;
  for (const app of machine.software.items || []) {
    if (SYSTEM_NOISE.test(app.name)) { noise++; continue; }
    findings.push(appFinding(app, kb));
  }
  if (!(machine.software.items || []).length && !machine.software.ok) {
    findings.push(finding('info', 'Installed-software scan failed', machine.software.error || '',
      'Run from an account that can read the uninstall registry keys.'));
  }
  if (noise) {
    findings.push(finding('info', `${noise} Windows system components skipped`,
      'Runtimes, redistributables and updates are Windows plumbing with no Linux counterpart.', ''));
  }
  sections.push({ name: 'Applications', findings });

  // ---- steam ---------------------------------------------------------------
  const gameFindings = [];
  if (!machine.steam.installed) {
    gameFindings.push(finding('green', 'Steam is not installed', 'Nothing to check.', ''));
  } else if (!(machine.steam.games || []).length) {
    gameFindings.push(finding('green', 'Steam installed, no games found', 'Library is empty or manifests unreadable.', ''));
  } else {
    for (const g of machine.steam.games) gameFindings.push(gameFinding(g, kb));
  }
  sections.push({ name: 'Steam games', findings: gameFindings });

  // ---- hardware ------------------------------------------------------------
  const hwFindings = [];
  for (const gpu of machine.hardware.gpus || []) {
    hwFindings.push(hardwareFinding('gpu', gpu, kb.hardware.gpu, {
      kind: 'alternative', name: gpu.name,
      note: 'Unknown GPU — search "<model> linux support" before switching.', advice: '',
    }));
  }
  for (const nic of machine.hardware.nics || []) {
    hwFindings.push(hardwareFinding('nic', nic, kb.hardware.nic, {
      kind: 'alternative', name: nic.name,
      note: 'Unknown network adapter.', advice: 'Search "<model> linux" to confirm.',
    }));
  }
  if (!(machine.hardware.gpus || []).length) {
    hwFindings.push(finding('info', 'No GPU detected via CIM', 'Verify graphics support manually.', ''));
  }
  if (!machine.hardware.ok) {
    hwFindings.push(finding('info', 'Hardware scan failed', machine.hardware.error || '', ''));
  }
  sections.push({ name: 'Hardware', findings: hwFindings });

  // ---- printers ------------------------------------------------------------
  const prFindings = [];
  if (!(machine.printers.items || []).length) {
    prFindings.push(finding('green', 'No printers configured', 'Nothing to check.', ''));
  } else {
    for (const p of machine.printers.items) {
      const f = hardwareFinding('printer', { name: p.name }, kb.hardware.printer, kb.hardware.defaultPrinter);
      if (p.network) {
        f.detail += ' Network printer — driverless IPP printing applies.';
      }
      prFindings.push(f);
    }
  }
  if (!machine.printers.ok) {
    prFindings.push(finding('info', 'Printer scan failed', machine.printers.error || '', ''));
  }
  sections.push({ name: 'Printers', findings: prFindings });

  return sections;
}

module.exports = { checkMachine, matchEntry, appFinding, gameFinding, loadKbs, SYSTEM_NOISE };
