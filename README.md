# SwitchCheck

**Pre-flight checks before you switch environments.** Scan what you have, diff it against the target environment, get a red / yellow / green report.

Two switches people are forced through right now — SwitchCheck covers both:

| Command | The switch | Deadline pressure |
|---|---|---|
| `switchcheck ci` | GitHub Actions `ubuntu-latest` flips to **Ubuntu 26.04** between **2026-10-19 and 2026-11-19** | High — the label silently changes under you |
| `switchcheck linux` | A Windows desktop moving to **Linux** | Personal — but nobody can answer "will *my* stuff work?" |

Both are the same machine underneath: `scan(source) × knowledge-base(target) → findings`.

## Install

```bash
npm install -g switchcheck   # or: npx switchcheck <command>
```

Requires Node.js ≥ 18. The `linux` command must run **on** the Windows machine being checked.

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
src/report/             terminal / markdown / html / json renderers
src/ci/                 workflow scanner, 26.04 rules, --trial PR generator
src/desktop/            Windows collector (PowerShell CIM/registry), Steam VDF parser, rules
data/                   the knowledge bases
```

## Roadmap

- Publish to npm + GitHub Action marketplace entry
- The same engine against the **Windows 2025** image flip and macOS runner changes
- `--fix` mode: emit the upgraded workflow YAML, not just advice
- Crowdsource KB coverage from anonymized `--json` output

## 中文说明

SwitchCheck（换环境体检）：在切换环境之前先做一次红黄绿体检。

- `switchcheck ci` — GitHub 官方在 2026-10-19 至 2026-11-19 之间把 `ubuntu-latest` 换成 Ubuntu 26.04。本工具扫描你的 workflows，对照官方新旧镜像清单（Node 22→24、Python 3.12→3.14、JDK 17→25、CMake 3→4、conda/Swift/Julia 整批移除……）给出报告；`--trial` 一键开 PR 先用 26.04 试跑。
- `switchcheck linux` — 在 Windows 上运行，读取已装软件、Steam 库存、显卡网卡和打印机，对照知识库判断每样东西在 Linux 上是原生能用、有替代品、需要 Wine，还是用不了（含微信/QQ/钉钉/WPS/税控开票等国内软件条目），生成可筛选的网页报告。

知识库都是 `data/` 下的纯 JSON，欢迎提 PR 补充。

## License

MIT
