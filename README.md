# SwitchCheck

**Pre-flight checks before you switch environments.** Scan what you have, diff it against the target environment, get a red / yellow / green report.

Three ways to run the same engine:

| Interface | The switch | How it scans |
|---|---|---|
| Desktop app (`npm run gui`) | All of the below | Fully visual — click, filter, compare, export |
| `switchcheck ci` | GitHub Actions `ubuntu-latest` flips to **Ubuntu 26.04** between **2026-10-19 and 2026-11-19** | local repo |
| `switchcheck runtime` | Node 20 went **EOL 2026-04-30**; Python 3.10 follows **2026-10-31** | the versions your repo declares |
| `switchcheck linux` | A Windows desktop moving to **Linux** | the Windows machine it runs on |

All checks are the same machine underneath: `scan(source) × knowledge-base(target) → findings`.

## Install

```bash
npm install -g switchcheck   # or: npx switchcheck <command>
```

## Desktop app (GUI)

![SwitchCheck 主界面](docs/screenshot-home.png)

![CI 体检结果](docs/screenshot-ci.png)

```bash
npm install
npm run gui     # opens the SwitchCheck window (Electron)
```

A fully visual desktop app (Chinese UI, light/dark) on the same check engine as the CLI:

- **Three checks** — 🐧 Windows → Linux 迁移 / ⚙️ CI → Ubuntu 26.04 / ⏱️ 运行时 EOL
- **Pick a target** — this machine, a local folder, **or a remote host over SSH**
- One click → live progress log → 🔴/🟡/🟢/ℹ️ verdict banner, per-section counts, status filter chips
- **SSH connection manager** — save multiple hosts (password or private key; secrets are encrypted with the OS credential store, never plaintext), test connectivity, host-key fingerprint pinning (TOFU) with a hard stop on change, import/export (secrets excluded)
- **体检历史** — every check is saved locally; load an old report and diff it against the previous run (新增 / 已解决)
- **创建试跑 PR** — after a local CI check, one click reuses the CLI's `--trial` to open a PR pinning `ubuntu-26.04`
- Export the report as HTML / Markdown / JSON (HTML export is localized to Chinese)

### Distributing the app (Windows / macOS / Linux)

`electron-builder.yml` describes all three platforms; builds are per-OS:

```bash
npm run dist:win     # NSIS installer + portable exe
npm run dist:mac     # dmg + zip (x64 + arm64)
npm run dist:linux   # AppImage + deb
```

Or push a tag (`git tag v0.2.0 && git push --tags`) — [.github/workflows/release.yml](.github/workflows/release.yml) builds all three on GitHub Actions and attaches the installers to a draft GitHub Release.

Platform notes:

- The **Windows → Linux local scan stays Windows-only**. On a mac or Linux desktop the app hides the "this machine" target and checks remote Windows PCs over SSH instead (that's the point of SSH mode — the app itself runs anywhere).
- **macOS builds are unsigned** by default. Users need right-click → Open on first launch. To distribute cleanly, set `CSC_LINK` / `CSC_KEY_PASSWORD` (Apple Developer ID) in the release workflow to sign and notarize.
- Windows builds are self-signed only (SmartScreen will warn); buy a code-signing certificate to remove the warning.

### Checking a remote machine over SSH

- **Windows → Linux check**: the SSH target must be a **Windows** host with OpenSSH Server enabled. The same PowerShell collectors run remotely (`-EncodedCommand`, no quoting surprises); the Steam library is read over SFTP. Non-Windows targets are detected and rejected with a clear message.
- **CI check**: point it at a repo path on any SSH host (Windows or Linux); workflow files are read over SFTP.
- Auth: password, or private key file (with optional passphrase).

Requires Node.js ≥ 18. The CLI `linux` check must still run **on** the Windows machine being checked (or use the GUI's SSH mode).

## `switchcheck ci [path]` — Ubuntu 26.04 readiness

Scans `.github/workflows/` and compares what your CI actually uses against the official [runner-images](https://github.com/actions/runner-images) manifests for Ubuntu 24.04 vs 26.04 (snapshot in `data/ubuntu-images.json`, dated).

What it flags:

- **Runner labels** — `ubuntu-latest` (flips mid-rollout), `ubuntu-22.04` (next in line for retirement), `ubuntu-20.04` (already dead)
- **Action runtimes** — actions still on the `node16`/`node20` runtime (node16 is already force-failed; node20 hit EOL 2026-04-30)
- **Image-default toolchains** — bare `node`/`npm`, `python3`/`pip`, `java`, `ruby`, `cmake`, `gcc` used *without* a setup action. Defaults move: Node 22.23.2→24.21.0, npm 10.9.8→11.19.0, Python 3.12.3→3.14.4, JDK 17→25 (Java 8 removed), CMake 3.31→**4.4** (major), GCC 13→**15** (much stricter), Compose 2.38→**5.1**
- **Pinned versions** — e.g. `node-version: 20` (EOL, gone from the 26.04 toolcache), Python < 3.10
- **Tools removed from the 26.04 image** — conda/Miniconda, Swift, Julia, fastlane, hg, lerna, newman, pulumi, mediainfo, parcel…
- **apt packages** that change majors between releases

Output: terminal report + `switchcheck-ci-report.md`. `--json` for machines, `--fail-on red` for CI.

### One-click trial

```bash
switchcheck ci --trial
```

Creates a branch that pins every Ubuntu job to `ubuntu-26.04` and opens a PR (via `gh` when available) so CI itself proves the migration before the flip. `--dry-run` previews the rewrite.

### As a GitHub Action

```yaml
- uses: <you>/switchcheck@v0.1
  with: {}
```

Or once published to npm, simply: `npx --yes switchcheck ci . --fail-on red`

## `switchcheck runtime [path]` — runtime EOL readiness

Scans what runtime versions the project itself declares — `package.json` (`engines.node` / `volta.node`), `.nvmrc`, `.node-version`, `.python-version`, `pyproject.toml` (`requires-python`) — and checks the **baseline** version (the minimum you claim to support) against the EOL schedule in `data/runtime-eol.json`:

- 🔴 **EOL passed** — e.g. Node 20 (EOL 2026-04-30), Python 3.9 (2025-10-31): no more security patches
- 🟡 **EOL within 90 days** — e.g. Python 3.10 (2026-10-31): time to schedule the upgrade
- 🟢 supported — with the maintenance end date

Output: terminal + `switchcheck-runtime-report.md/html`. The same files can be scanned over SSH from the GUI (any host, via SFTP).

## `switchcheck linux` — Windows → Linux readiness

Runs on the Windows machine (read-only): installed software (registry), the Steam library (`libraryfolders.vdf` + app manifests), GPU / network adapters, printers. Everything is matched against knowledge bases in `data/`:

- **Applications** → native build / good alternative / runs under Wine / blocked. Includes Chinese desktop staples (WeChat, QQ, DingTalk, WPS, 税控/网银控件…) alongside global ones — with Windows bookkeeping noise (redistributables, SDKs) filtered out
- **Steam games** → native, Proton, or anti-cheat-blocked, with a ProtonDB lookup for unlisted titles
- **Hardware** → NVIDIA (proprietary driver caveats) / AMD / Intel GPUs, Wi-Fi adapters (incl. the Broadcom pain), printers via vendor + driverless IPP
- **Hard blockers** get called out honestly: tax-control plugins, bank USB keys, kernel anti-cheat games

Output: terminal + `switchcheck-linux-report.md` + a self-contained **HTML report** with status filters (`--open` to view). `--from collection.json` re-checks a saved scan.

## Knowledge bases are data, not code

`data/*.json` are plain, dated, and sourced:

- `ubuntu-images.json` — from the runner-images Ubuntu 24.04/26.04 readmes + action runtime checks (`action.yml` `using:` field per major)
- `runtime-eol.json` — EOL dates from the official Node.js / Python release schedules
- `linux-apps.json`, `linux-hardware.json`, `steam-games.json` — curated, community-extendable

Found something wrong or missing? The best PR is a JSON edit.

## Verdicts & exit codes

Every finding is 🔴 blocking / 🟡 review / 🟢 ok / ℹ info. The overall verdict is the worst finding. `--fail-on red` (or `yellow`) makes the process exit 1 — use it in CI.

## Development

```bash
npm install
npm test        # node:test, no extra dev deps
```

```
bin/switchcheck.js      CLI entry
src/engine.js           finding model + verdicts (shared core)
src/labels.js           shared zh/en display labels (CLI renderer + GUI)
src/report/             terminal / markdown / html / json renderers
src/ci/                 workflow scanner, 26.04 rules, --trial PR generator
src/runtime/            runtime-declaration scanner + EOL rules
src/checks.js           target resolution + orchestration for all checks
src/desktop/            Windows collector (PowerShell CIM/registry), Steam VDF parser, rules
src/ssh.js              SSH transport: host-key TOFU, op timeouts, remote PowerShell + SFTP
src/gui/                Electron app (main + preload + renderer + profile store)
data/                   the knowledge bases
```

## Roadmap

- Publish to npm + GitHub Action marketplace entry
- The same engine against the **Windows 2025** image flip and macOS runner changes
- `--fix` mode: emit the upgraded workflow YAML, not just advice
- Auto-update via electron-updater (needs a published repo + signed macOS builds)
- Crowdsource KB coverage from anonymized `--json` output

## 中文说明

SwitchCheck（换环境体检）：在切换环境之前先做一次红黄绿体检。

- **桌面应用（推荐）** — `npm install && npm run gui`。全中文可视化界面：三种检查（🐧 Windows→Linux 迁移 / ⚙️ CI→Ubuntu 26.04 / ⏱️ 运行时 EOL）→ 选目标（本机 / 本地文件夹 / **SSH 远程主机**）→ 一键体检 → 红黄绿结论、分区统计、状态过滤、导出中文 HTML/Markdown/JSON，支持亮/暗主题。**体检历史**自动保存，可载入旧报告并与上次对比（新增/已解决）。SSH 连接管理器保存多台主机（密码或私钥，系统级加密存储），支持连通性测试、**主机密钥指纹绑定（TOFU，变更即拦截）**、导入导出（不含密钥）。本地 CI 体检完成后可一键「创建试跑 PR」。
- **分发安装包** — `npm run dist:win`（NSIS 安装器 + 便携版）/ `dist:mac`（dmg，x64+arm64）/ `dist:linux`（AppImage + deb）；或直接推 `v*` 标签，GitHub Actions 会三平台自动构建、冒烟并挂到 Release 草稿。mac/Linux 版本不支持"本机体检"，通过 SSH 模式体检远程 Windows 电脑。
- `switchcheck ci` — GitHub 官方在 2026-10-19 至 2026-11-19 之间把 `ubuntu-latest` 换成 Ubuntu 26.04。本工具扫描你的 workflows，对照官方新旧镜像清单（Node 22→24、Python 3.12→3.14、JDK 17→25、CMake 3→4、conda/Swift/Julia 整批移除……）给出报告；`--trial` 一键开 PR 先用 26.04 试跑。
- `switchcheck runtime` — 扫描仓库声明的运行时版本（package.json engines、.nvmrc、.node-version、.python-version、pyproject.toml），对照 EOL 时间表：Node 20 已于 2026-04-30 停止安全维护（红），Python 3.10 还有不到 90 天（黄）。
- `switchcheck linux` — 在 Windows 上运行，读取已装软件、Steam 库存、显卡网卡和打印机，对照知识库判断每样东西在 Linux 上是原生能用、有替代品、需要 Wine，还是用不了（含微信/QQ/钉钉/WPS/税控开票/深信服 VPN/输入法/字体等国内软件条目），生成可筛选的网页报告。

知识库都是 `data/` 下的纯 JSON，欢迎提 PR 补充。

## License

MIT
