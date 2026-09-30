# SwitchCheck UI 设计规范

**版本**:v0.1 草案 · 2026-09-30
**目标**:易用性 + 风格统一。本文档基于一次全量代码审计(43 项发现,见附录)和桌面开发工具 UI 惯例调研(GitHub Primer / VS Code / Linear / Lighthouse / NN/g),给出可执行的设计决策,按三个实施批次推进。

---

## 1. 设计原则

1. **单屏自足**:体检工具的核心循环是"改 → 重跑 → 对比"。保持"左侧配置 / 右侧结果"的单屏结构,不向多步向导演化;主视图应独立完成 80% 的任务(Linear 原则)。
2. **渐进披露,最多两级**:第 1 级 = 结论横幅 + 统计;第 2 级 = 可折叠分区。红灯/黄灯分区默认展开,绿灯折叠(Lighthouse 模式);分区标题诚实命名("应用软件 · 1 阻塞"),永远不用"更多…"。
3. **语义令牌,双主题同构**:组件只允许引用语义令牌,亮/暗主题只是值的替换。参考 GitHub Primer 的状态色四件套:前景 / 弱背景 / 强背景 / 边框。
4. **状态显式化**:loading / empty / error / partial(部分采集失败)四种状态都要有设计,partial 是最常漏掉的一种。
5. **中文优先的排版**:CJK 字体栈按平台排序,数字用等宽数字对齐,标点统一全角。

---

## 2. 现状审计结论(摘要)

全量审计发现 43 项问题(完整清单见附录 A),按严重度归组:

**A 组 · 可达性与安全(必须先修)**

- 主控组件 `.choice` 是 div + click,**键盘完全不可达**(index.html:24-72)——应用最主要的操作入口对键盘用户和屏幕阅读器是黑洞。
- 模态框无 `role="dialog"`、无焦点移入/陷阱/恢复、无 Esc 关闭。
- 危险操作(清空历史、删除连接)无确认;试跑 PR 这类"离开应用"的动作也没有后果说明。
- `#errorBox` 位于 main 最底部,而触发它的按钮在侧栏——**报错时用户根本看不到**(app.css:248)。
- 复制按钮 hover 才出现,无 `:focus-within`,键盘用户永远看不到。

**B 组 · 风格统一(一次 CSS 重构解决)**

- 无任何间距/圆角/字号刻度:23 种间距值、11 种圆角、16 种字号,其中 2.5px、10.5px、11.5px、13.5px、14.5px 等一次性值。
- 令牌外硬编码:`#runBtn` 的白色、hover 阴影的亮色 rgba 在暗色主题下不切换(app.css:164,396)、遮罩与弹窗阴影绕过令牌。
- `app.js:496` 保存按钮用了 `.primary` 类但 CSS 里**根本没定义**(只有 #runBtn 有主按钮样式);`#trialBtn` 无任何变体类;`.danger` 缺 hover 反馈。
- 控件圆角不统一:按钮 9px / 芯片 999px / 输入框 8px / 卡片 11px。

**C 组 · 易用性细节**

- 术语漂移:"体检 vs 检查"混用、半角/全角标点混用、路径占位符反斜杠与正斜杠不一致。
- 长文本不换行(超长主机名/标题会撑破卡片);窄宽(<940px)无响应式回退;`.exports` 按钮不换行。
- 首启动闪白:html 硬编码 `data-theme="light"`,深色系统用户每次启动先闪一下。
- 运行中只有 runBtn 禁用,导出/试跑/历史按钮仍可点。

---

## 3. 设计令牌(Design Tokens)

三层架构:原始值 → 语义角色 → 组件引用。**组件样式里禁止出现裸 hex/rgba**(审计第 1 类问题的根治)。

### 3.1 间距(4px 基准)

```css
--space-1: 4px;  --space-2: 8px;  --space-3: 12px; --space-4: 16px;
--space-5: 24px; --space-6: 32px; --space-7: 48px; --space-8: 64px;
```
现有 23 个值收敛到这 8 个;行内紧凑元素允许 `calc(var(--space-1) / 2)`(2px)。

### 3.2 字号与字体

```css
--text-xs: 12px;  --text-sm: 13px;  --text-md: 15px;  --text-lg: 20px;
--text-display: 54px;   /* 仅空状态 */
```
16 个字号收敛为 6 个;正文 13px(VS Code/Linear 密度基准,YaHei UI 在 12-13px 下专为小字号优化)。**数字一律 `font-variant-numeric: tabular-nums`**(统计药丸、计数、进度百分比——混排 CJK 时不抖动)。

字体栈(CJK 排版规范:拉丁字体在前保证数字/路径对齐):

```css
/* Windows */ "Segoe UI", "Microsoft YaHei UI", sans-serif;
/* macOS  */ -apple-system, "PingFang SC", "Hiragino Sans GB", sans-serif;
```
统一为一条 `--font-ui` 令牌,按 `@supports`/UA 平台切换。

### 3.3 圆角与阴影

```css
--radius-sm: 6px;   /* 输入框、小按钮 */
--radius-md: 10px;  /* 卡片、选项卡 */
--radius-lg: 14px;  /* 弹窗、结论横幅 */
--radius-pill: 999px;
```
11 种圆角收敛为 4 个;控件统一用 `--radius-sm`(修掉 9/8/11px 混用)。

```css
--shadow-1; --shadow-2;      /* 双层柔和阴影,仅浮动层使用 */
--overlay: rgba(0 0 0 / 45%);/* 遮罩,双主题共用 */
```
暗色主题的弱背景一律用 **alpha 叠加**(`color-mix(... transparent)`)而非预计算深色值(Primer 惯例)。

### 3.4 状态色四件套(核心)

每种状态一个四件套,双主题成对定义——这是红绿灯系统的骨架:

```css
--red-fg / --red-bg-muted / --red-bg-emphasis / --red-border;
--yellow-* / --green-* / --info-* 同构;
--on-accent: #fff;   /* 主按钮文字,替代硬编码白 */
```

| 用途 | 引用 |
|---|---|
| 徽章、弱底行 | `*-bg-muted` + `*-fg` |
| 统计药丸强调、主 CTA | `*-bg-emphasis` |
| 卡片左脊柱、边框提示 | `*-border` |

### 3.5 交互状态令牌

每种可交互组件必须有五个完整状态:`default / hover / active / focus-visible / disabled([disabled] 时 opacity .6 + cursor)`。加载中用 spinner 替换文本(参照 #runBtn.running 的既有实现)。

---

## 4. 组件规范

| 组件 | 规范要点 | 修复的审计项 |
|---|---|---|
| **Choice(类型/目标选择)** | 从 div 改为 `<button role="radio">` + `aria-checked`,放进 `role="radiogroup"`;键盘 ↑↓/Tab 可达 | #23, #36 |
| **Button** | 统一 4 变体:`primary`(渐变+阴影+spinner)/ `ghost` / `danger`(红 hover 底)/ `pill`(过滤芯片);统一 `--radius-sm` + 状态五件套 | #11-15 |
| **FindingCard** | 左脊柱 + 徽章 + 复制钮;`overflow-wrap: anywhere`;复制钮增加 `:focus-within` 显形 + `aria-label` | #16, #33, #39 |
| **Modal** | `role="dialog" aria-modal="true"`,打开移入焦点、Tab 循环陷阱、Esc 关闭、关闭后焦点还原;遮罩点击保留 | #27, #37 |
| **Progress** | 步骤区 + 日志区,`aria-live="polite"`;>10s 的远端扫描考虑确定性进度(后续) | #40 |
| **FilterChips** | `aria-pressed` 表达选中态;`.on` 态增强对比 | #28, #38 |
| **EmptyState** | 现有三步引导保留;所有分区皆空时结果区显示"没有发现任何条目"空态 | #32 |
| **ErrorBox** | 移到结论横幅上方或 `scrollIntoView`;`role="alert"` | #31, #40 |

---

## 5. 易用性改进清单(优先级)

**P0(与 PR-1 同批,半天)**
1. 错误可见性:errorBox 位置/滚动 + role=alert。
2. Esc 关闭模态 + 焦点管理。
3. 危险/外发操作确认对话框(清空历史、删除连接、创建 PR——后果写进按钮文案)。
4. 首启动主题闪烁:`<html data-theme>` 由内联脚本在渲染前按 localStorage/系统解析(同步,无闪烁)。
5. 运行中统一禁用导出/试跑/历史/管理按钮。

**P1(与 PR-2 同批,半天)**
6. 术语与文案规范(下表一次替换):

| 现状 | 统一为 |
|---|---|
| 检查类型/检查目标 | 体检类型/体检目标(动作一律"体检") |
| 半角标点混用 | 中文文案统一全角(代码/路径除外) |
| `D:\path\to\repo` vs `D:/Code/my-repo` | 占位符统一正斜杠(SSH 语义一致) |
| 载入 | 打开 |

7. 长文本溢出:`overflow-wrap: anywhere` 全局加在卡片与 meta 行。
8. 窄宽回退:<940px 侧栏收缩为顶部横条(或可折叠);`.exports` 允许换行;模态 2 列 → 1 列。
9. "测试连接"按钮加 loading/disabled。
10. 进度面板加"清除"小按钮。

**P2(后续迭代)**
11. 对比视图升级:两次结果的**结构化 diff 视图**(新/消失/状态变化三组),而不仅是标题匹配。
12. `Ctrl+K` 命令面板(Linear 模式):三种体检、切换目标、打开历史。
13. 超长结果列表虚拟化(>500 条时;Windows 全量软件清单可能触发)。
14. 首次运行"示例报告"预览(空态最佳实践:让用户先看到长相)。

---

## 6. 实施计划(三个批次)

| 批次 | 内容 | 风险 |
|---|---|---|
| **PR-1 令牌重构** | 第 3 节全部令牌落地 + 字体栈 + 对比度修复(#41)+ 暗色泄漏修复(#2,4,5,6)。纯 CSS 改动,视觉零位移(收敛到最近刻度) | 低 |
| **PR-2 语义与状态** | Choice→button、Modal a11y、确认框、错误位置、按钮变体统一、术语替换。触 JS/HTML | 中 |
| **PR-3 布局与状态** | 窄宽回退、溢出、空态、进度清理、更新 UX 打磨(补"下次启动安装"选项) | 中 |

每批次完成后跑一次双主题截图回归(现有浏览器 mock 流程 + 视觉验收)。

---

## 附录 A:审计发现(43 项,由子代理产出)

分组:1 令牌外取色(7 项)· 2 间距/圆角/字号无刻度(3 项)· 3 按钮变体(6 项)· 4 术语(6 项)· 5 交互状态缺失(6 项)· 6 布局/UX 缺口(7 项)· 7 可访问性(8 项)。原始编号 #1-#43 见审计记录;P0/P1/P2 的映射已在第 5 节给出。

## 附录 B:参考

GitHub Primer Color(语义状态色四件套)· VS Code Theme Color(按表面命名严重度)· Lighthouse 报告(失败展开/通过折叠)· GitHub Code Scanning(严重度分组 + 计数头)· Linear(单屏自足、键盘优先)· NN/g(响应时间预算、骨架屏、渐进披露)· CSSWG #3658 与中文 Web 字体栈(CJK 排版)· GitHub Desktop / electron-updater(更新就地 UX)
