'use strict';

// Collects what a Windows machine actually has: installed software, Steam
// games, GPU / network hardware, printers. Read-only; everything goes through
// PowerShell CIM/registry queries.
//
// Every collector takes a "runner" describing how to touch the machine:
//   runPs(script)   → { ok, data | error }  PowerShell script, JSON on stdout
//   exists(p) / readFile(p) / readdir(p)    filesystem access (Steam manifests)
//   join(...parts)  → path string           (local: backslashes, SSH: slashes)
//   hostname() / platform()
// The default runner is the local machine; src/ssh.js builds an equivalent
// runner over an OpenSSH connection so the GUI can scan a remote host.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const { parseLibraryFolders, parseAppManifest } = require('./vdf');
const { psResult } = require('./ps');

const UTF8 = '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;';

const localRunner = {
  runPs(script) {
    const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', UTF8 + script], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    });
    return psResult({ code: r.status, stdout: r.stdout, stderr: r.stderr });
  },
  exists: p => fs.existsSync(p),
  readFile: p => fs.readFileSync(p, 'utf8'),
  readdir: p => fs.readdirSync(p),
  join: (...parts) => path.join(...parts),
  hostname: () => os.hostname(),
  platform: () => os.platform(),
};

// Collectors are async so local and SSH runners share one code path —
// awaiting a plain value (local runner) is a no-op.

async function collectSoftware(runner = localRunner) {
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
  const res = await runner.runPs(script);
  const items = res.ok
    ? res.data.map(x => ({
      name: String(x.DisplayName || '').trim(),
      version: String(x.DisplayVersion || '').trim(),
      publisher: String(x.Publisher || '').trim(),
    })).filter(x => x.name)
    : [];
  return { ok: res.ok, error: res.error, items };
}

async function findSteamRoot(runner = localRunner) {
  const res = await runner.runPs(
    `Write-Output (ConvertTo-Json (Get-ItemProperty 'HKCU:\\Software\\Valve\\Steam' -ErrorAction SilentlyContinue).SteamPath)`
  );
  let p = '';
  if (res.ok && res.data) {
    const s = Array.isArray(res.data) ? res.data[0] : res.data;
    if (typeof s === 'string') p = s.trim().replace(/^"|"$/g, '');
  }
  const candidates = [p, 'C:\\Program Files (x86)\\Steam', 'C:\\Program Files\\Steam'].filter(Boolean);
  for (const c of candidates) {
    if (runner.exists(runner.join(c, 'steamapps', 'libraryfolders.vdf'))) return c;
  }
  return null;
}

async function collectSteam(runner = localRunner) {
  const root = await findSteamRoot(runner);
  if (!root) return { ok: true, installed: false, games: [] };
  const vdfPath = runner.join(root, 'steamapps', 'libraryfolders.vdf');
  let libraries = [];
  try {
    libraries = parseLibraryFolders(await runner.readFile(vdfPath));
  } catch {
    libraries = [root];
  }
  const games = [];
  const seen = new Set();
  for (const lib of libraries) {
    const appsDir = runner.join(lib, 'steamapps');
    let files = [];
    try {
      files = (await runner.readdir(appsDir)).filter(f => /^appmanifest_.*\.acf$/i.test(f));
    } catch {
      continue;
    }
    for (const f of files) {
      try {
        const m = parseAppManifest(await runner.readFile(runner.join(appsDir, f)));
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

async function collectHardware(runner = localRunner) {
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
  const res = await runner.runPs(script);
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

async function collectPrinters(runner = localRunner) {
  const script = `
    Get-CimInstance Win32_Printer -ErrorAction SilentlyContinue |
      Select-Object Name, DriverName, PortName |
      ConvertTo-Json -Compress
  `;
  const res = await runner.runPs(script);
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

// onStep('software'|'steam'|'hardware'|'printers', label) drives GUI progress.
// The four queries are independent — over SSH they run as parallel exec /
// SFTP channels (the local runner is spawnSync-based, so locally they stay
// sequential without harm). onStep still fires in a fixed order.
async function collectAll(runner = localRunner, onStep = () => {}) {
  onStep('software', '已安装软件');
  const pSoftware = collectSoftware(runner);
  onStep('steam', 'Steam 库');
  const pSteam = collectSteam(runner);
  onStep('hardware', '硬件');
  const pHardware = collectHardware(runner);
  onStep('printers', '打印机');
  const pPrinters = collectPrinters(runner);
  const [software, steam, hardware, printers] = await Promise.all([pSoftware, pSteam, pHardware, pPrinters]);
  return {
    host: await runner.hostname(),
    platform: await runner.platform(),
    software,
    steam,
    hardware,
    printers,
  };
}

module.exports = {
  collectSoftware, collectSteam, collectHardware, collectPrinters,
  collectAll, findSteamRoot, localRunner,
};
