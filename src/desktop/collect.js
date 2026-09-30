'use strict';

// Collects what a Windows machine actually has: installed software, Steam
// games, GPU / network hardware, printers. Read-only; everything goes through
// PowerShell CIM/registry queries.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const { parseLibraryFolders, parseAppManifest } = require('./vdf');

const UTF8 = '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;';

function powershell(script) {
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', UTF8 + script], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (r.status !== 0) {
    const errText = ((r.stderr || '') + (r.stdout || '')).trim();
    if (errText) return { ok: false, error: errText.split('\n')[0] };
    return { ok: false, error: `powershell exited ${r.status}` };
  }
  const out = (r.stdout || '').trim();
  if (!out) return { ok: true, data: [] };
  try {
    const parsed = JSON.parse(out);
    return { ok: true, data: Array.isArray(parsed) ? parsed : [parsed] };
  } catch (e) {
    return { ok: false, error: 'unparseable PowerShell output' };
  }
}

function collectSoftware() {
  const script = `
    $paths = @(
      'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
      'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
      'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'
    )
    Get-ItemProperty $paths -ErrorAction SilentlyContinue |
      Where-Object { $_.DisplayName } |
      Select-Object DisplayName, DisplayVersion, Publisher, InstallDate |
      Sort-Object DisplayName -Unique |
      ConvertTo-Json -Compress
  `;
  const res = powershell(script);
  const items = res.ok
    ? res.data.map(x => ({
      name: String(x.DisplayName || '').trim(),
      version: String(x.DisplayVersion || '').trim(),
      publisher: String(x.Publisher || '').trim(),
    })).filter(x => x.name)
    : [];
  return { ok: res.ok, error: res.error, items };
}

function findSteamRoot() {
  const res = powershell(
    `Write-Output (ConvertTo-Json (Get-ItemProperty 'HKCU:\\Software\\Valve\\Steam' -ErrorAction SilentlyContinue).SteamPath)`
  );
  let p = '';
  if (res.ok && res.data) {
    const s = Array.isArray(res.data) ? res.data[0] : res.data;
    if (typeof s === 'string') p = s.trim().replace(/^"|"$/g, '');
  }
  const candidates = [p, 'C:\\Program Files (x86)\\Steam', 'C:\\Program Files\\Steam'].filter(Boolean);
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'steamapps', 'libraryfolders.vdf'))) return c;
  }
  return null;
}

function collectSteam() {
  const root = findSteamRoot();
  if (!root) return { ok: true, installed: false, games: [] };
  const vdfPath = path.join(root, 'steamapps', 'libraryfolders.vdf');
  let libraries = [];
  try {
    libraries = parseLibraryFolders(fs.readFileSync(vdfPath, 'utf8'));
  } catch {
    libraries = [root];
  }
  const games = [];
  const seen = new Set();
  for (const lib of libraries) {
    const appsDir = path.join(lib, 'steamapps');
    let files = [];
    try {
      files = fs.readdirSync(appsDir).filter(f => /^appmanifest_.*\.acf$/i.test(f));
    } catch {
      continue;
    }
    for (const f of files) {
      try {
        const m = parseAppManifest(fs.readFileSync(path.join(appsDir, f), 'utf8'));
        if (m.appid && m.name && !seen.has(m.appid)) {
          seen.add(m.appid);
          games.push({ appid: m.appid, name: m.name });
        }
      } catch {
        /* skip unreadable manifest */
      }
    }
  }
  return { ok: true, installed: true, games };
}

function collectHardware() {
  const script = `
    $gpu = Get-CimInstance Win32_VideoController -ErrorAction SilentlyContinue |
      Select-Object Name, DriverVersion, AdapterCompatibility |
      ConvertTo-Json -Compress
    $nic = Get-CimInstance Win32_NetworkAdapter -Filter 'PhysicalAdapter=true' -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -notmatch 'Bluetooth|Virtual|Tunnel|VPN|TAP|Remote NDIS|WAN Miniport' } |
      Select-Object Name, Manufacturer |
      ConvertTo-Json -Compress
    $audio = Get-CimInstance Win32_SoundDevice -ErrorAction SilentlyContinue |
      Select-Object Name, Manufacturer |
      ConvertTo-Json -Compress
    @{ gpu = $gpu; nic = $nic; audio = $audio } | ConvertTo-Json -Compress
  `;
  const res = powershell(script);
  if (!res.ok) return { ok: false, error: res.error, gpus: [], nics: [], audio: [] };
  const d = res.data[0] || {};
  const list = j => {
    if (!j) return [];
    try {
      const p = JSON.parse(j);
      return Array.isArray(p) ? p : [p];
    } catch {
      return [];
    }
  };
  return {
    ok: true,
    gpus: list(d.gpu).map(x => ({ name: String(x.Name || '').trim() })),
    nics: list(d.nic).map(x => ({ name: String(x.Name || '').trim(), manufacturer: String(x.Manufacturer || '').trim() })),
    audio: list(d.audio).map(x => ({ name: String(x.Name || '').trim() })),
  };
}

function collectPrinters() {
  const script = `
    Get-CimInstance Win32_Printer -ErrorAction SilentlyContinue |
      Select-Object Name, DriverName, PortName |
      ConvertTo-Json -Compress
  `;
  const res = powershell(script);
  const items = res.ok
    ? res.data.map(x => ({
      name: String(x.Name || '').trim(),
      driver: String(x.DriverName || '').trim(),
      port: String(x.PortName || '').trim(),
      network: /(\d+\.\d+\.\d+\.\d+|_tcp|ip_)/i.test(String(x.PortName || '')),
    })).filter(x => x.name)
    : [];
  return { ok: res.ok, error: res.error, items };
}

function collectAll() {
  return {
    host: os.hostname(),
    platform: os.platform(),
    software: collectSoftware(),
    steam: collectSteam(),
    hardware: collectHardware(),
    printers: collectPrinters(),
  };
}

module.exports = { collectSoftware, collectSteam, collectHardware, collectPrinters, collectAll, findSteamRoot };
