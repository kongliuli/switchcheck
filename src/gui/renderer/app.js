'use strict';

// Renderer logic. Talks to the main process only through window.api
// (preload bridge; mock-api.js fakes it in a plain browser).

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

const L = window.SC_LABELS;
const SECTION_ZH = L.SECTION_ZH;
const STATUS_ZH = L.STATUS_ZH;
const STATUS_ORDER = L.STATUS_ORDER;
const VERDICT_ICON = L.VERDICT_ICON;
const KIND_ICON = L.KIND_ICON;

// The local Windows→Linux scan needs Windows PowerShell; on a mac/Linux
// desktop only the SSH mode makes sense, so hide the local target there.
const IS_WIN = /win/i.test(navigator.platform || '');

const state = {
  type: 'linux',
  target: 'local',
  profiles: [],
  safeStorage: true,
  result: null,
  filter: 'all',
  running: false,
  lastOpts: null, // what produced state.result — the trial button reuses it
};

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function rememberSelection() {
  try { localStorage.setItem('sc-last', JSON.stringify({ type: state.type, target: state.target })); } catch { /* ignore */ }
}

// ---------------------------------------------------------------- sidebar --

function syncRadios(groupSel, value) {
  const group = $(groupSel);
  if (!group) return;
  [...group.querySelectorAll('.choice')].forEach(c => {
    const on = c.dataset.type === value || c.dataset.target === value;
    c.classList.toggle('on', on);
    c.setAttribute('aria-checked', on ? 'true' : 'false');
  });
}

function setType(type) {
  state.type = type;
  syncRadios('#typeChoices', type);
  const repoLike = type === 'ci' || type === 'runtime';
  $('#linuxTargets').hidden = type !== 'linux';
  $('#ciTargets').hidden = !repoLike;
  $('#sshTargetHint').textContent = type === 'linux'
    ? '远程主机需为 Windows 并已启用 OpenSSH 服务器。'
    : '远程主机可以是 Windows 或 Linux，通过 SFTP 读取仓库文件。';
  if (type === 'linux' && !IS_WIN) {
    $('#linuxTargets .choice[data-target="local"]').hidden = true;
    if (state.target === 'local') state.target = 'ssh';
  } else {
    $('#linuxTargets .choice[data-target="local"]').hidden = false;
  }
  setTarget(state.target);
  $('#runBtn').textContent = type === 'ci' ? '开始 CI 体检'
    : type === 'runtime' ? '开始运行时体检' : '开始体检';
  rememberSelection();
}

function setTarget(target) {
  state.target = target;
  syncRadios(state.type === 'linux' ? '#linuxTargets' : '#ciTargets', target);
  $('#ciLocalBlock').hidden = !(state.type !== 'linux' && target === 'local');
  $('#ciRemoteBlock').hidden = !(state.type !== 'linux' && target === 'ssh');
  $('#sshBlock').hidden = target !== 'ssh';
  updateSecretRows();
  rememberSelection();
}

async function loadProfiles() {
  const { profiles, safeStorage } = await window.api.listProfiles();
  state.profiles = profiles;
  state.safeStorage = safeStorage;
  const sel = $('#profileSelect');
  const prev = sel.value;
  sel.textContent = '';
  if (!profiles.length) {
    sel.append(el('option', null, '（尚未配置连接）'));
  }
  for (const p of profiles) {
    const o = el('option', null, `${p.name}（${p.username}@${p.host}）`);
    o.value = p.id;
    sel.append(o);
  }
  if (prev && profiles.some(p => p.id === prev)) sel.value = prev;
  updateSecretRows();
}

function selectedProfile() {
  return state.profiles.find(p => p.id === $('#profileSelect').value) || null;
}

// Show the secret input only when the profile needs it at check time.
function updateSecretRows() {
  const p = selectedProfile();
  $('#sshPasswordRow').hidden = !(state.target === 'ssh' && p && p.authType === 'password' && !p.hasPassword);
  $('#sshPassphraseRow').hidden = !(state.target === 'ssh' && p && p.authType === 'key' && !p.hasKeyPassphrase);
}

// -------------------------------------------------------------- progress --

function progressLine(message, cls) {
  const panel = $('#progressPanel');
  panel.hidden = false;
  const t = new Date().toTimeString().slice(0, 8);
  const line = el('div', 'line' + (cls ? ` ${cls}` : ''));
  line.append(el('span', 'ts', `[${t}]`));
  line.append(el('span', null, message));
  $('#progressLog').append(line);
  panel.scrollIntoView({ block: 'nearest' });
  $('#progressLog').scrollTop = 1e9;
}

// ------------------------------------------------------------------- run --

async function run() {
  if (state.running) return;
  if (state.target === 'ssh' && !selectedProfile()) {
    return showError('请先在「SSH 连接」中选择一个连接配置（点「管理…」可新建）。');
  }
  if (state.type !== 'linux' && state.target === 'local' && !$('#ciPathInput').value.trim()) {
    return showError('请填写或选择本地仓库路径。');
  }
  hideError();
  state.running = true;
  const lockable = ['#exportHtml', '#exportMd', '#exportJson', '#trialBtn', '#historyBtn', '#manageBtn', '#ciBrowseBtn'];
  lockable.forEach(s => { $(s).disabled = true; });
  const btn = $('#runBtn');
  btn.disabled = true;
  btn.classList.add('running');
  btn.textContent = '体检中…';
  $('#progressLog').textContent = '';

  const opts = {
    type: state.type,
    target: state.target,
    profileId: $('#profileSelect').value,
    password: $('#sshPasswordInput').value,
    passphrase: $('#sshPassphraseInput').value,
    ciPath: $('#ciPathInput').value.trim(),
    remotePath: $('#remotePathInput').value.trim(),
  };
  state.lastOpts = opts;
  $('#diffBox').hidden = true;

  try {
    const result = await window.api.startCheck(opts);
    if (!result.ok) {
      showError(result.error || '体检失败');
    } else {
      progressLine('体检完成', 'ok');
      renderResult(result);
      $('#main').scrollTop = 0;
    }
  } catch (e) {
    showError(e.message || String(e));
  } finally {
    state.running = false;
    btn.disabled = false;
    btn.classList.remove('running');
    lockable.forEach(s => { $(s).disabled = false; });
    setRunLabel();
  }
}

function setRunLabel() {
  $('#runBtn').textContent = state.type === 'ci' ? '开始 CI 体检'
    : state.type === 'runtime' ? '开始运行时体检' : '开始体检';
}

// ---------------------------------------------------------------- result --

function renderResult(result, opts = {}) {
  state.result = result;
  $('#empty').hidden = true;
  $('#result').hidden = false;
  $('#diffBox').hidden = !opts.diffHtml;

  const v = result.verdict;
  const c = result.counts;
  const box = $('#verdictBanner');
  box.className = `verdict ${v.status}`;
  $('#verdictIcon').textContent = VERDICT_ICON[v.status] || '🚦';
  $('#verdictHead').textContent = v.headline;
  const target = opts.targetLabel
    || (state.target === 'ssh'
      ? `SSH:${selectedProfile() ? selectedProfile().name : result.host}`
      : result.host);
  $('#verdictSub').textContent =
    `${target} · ${opts.at ? '体检于 ' + opts.at.slice(0, 10) : '生成于 ' + result.meta.generatedAt}` +
    `${result.meta.kbDate ? ` · 知识库快照 ${result.meta.kbDate}` : ''}`;
  if (opts.diffHtml) {
    const d = $('#diffBox');
    d.textContent = '';
    d.append(opts.diffHtml);
  }

  const stats = $('#verdictStats');
  stats.textContent = '';
  for (const s of ['red', 'yellow', 'green', 'info']) {
    const pill = el('span', 'stat');
    pill.append(el('span', `dot ${s}`));
    pill.append(el('b', null, String(c[s] || 0)));
    pill.append(el('span', null, STATUS_ZH[s]));
    stats.append(pill);
  }
  updateChipCounts(c);

  $('#trialBtn').hidden = !(result.kind === 'ci' && state.target === 'local' && !opts.fromHistory);

  const wrap = $('#sections');
  wrap.textContent = '';
  const visible = result.sections.filter(s => s.findings.length);
  if (!visible.length) {
    wrap.append(el('div', 'empty-note', '体检完成 —— 没有发现任何条目。'));
  }
  for (const section of visible) {
    const sorted = [...section.findings].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
    const det = el('details', 'check-section');
    if (sorted.some(f => f.status === 'red' || f.status === 'yellow')) det.open = true;
    const counts = section.findings.reduce((m, f) => (m[f.status] = (m[f.status] || 0) + 1, m), {});
    const sum = el('summary', null, SECTION_ZH[section.name] || section.name);
    const sc = el('span', 'sec-counts');
    for (const s of ['red', 'yellow', 'green', 'info']) {
      if (!counts[s]) continue;
      const item = el('span', `sc ${s}`);
      item.append(el('i', `dot ${s}`));
      item.append(document.createTextNode(String(counts[s])));
      sc.append(item);
    }
    sum.append(sc);
    det.append(sum);
    const ul = el('ul', 'items');
    for (const f of sorted) ul.append(findingItem(f));
    det.append(ul);
    wrap.append(det);
  }
  setFilter('all');
}

function findingItem(f) {
  const li = el('li', 'item');
  li.dataset.status = f.status;
  li.append(el('span', `badge ${f.status}`, STATUS_ZH[f.status]));
  const body = el('div');
  const title = el('div', 't', f.title);
  if (f.url) {
    const a = el('a', null, '参考 ↗');
    a.href = f.url;
    a.addEventListener('click', ev => {
      ev.preventDefault();
      window.api.openExternal(f.url);
    });
    title.append(a);
  }
  body.append(title);
  if (f.detail) body.append(el('div', 'd', f.detail));
  if (f.advice) body.append(el('div', 'a', f.advice));
  li.append(body);
  const copy = el('button', 'ghost copy-btn', '⧉');
  copy.title = '复制这条建议';
  copy.setAttribute('aria-label', '复制这条建议');
  copy.addEventListener('click', async () => {
    const text = [f.title, f.detail, f.advice ? `建议：${f.advice}` : ''].filter(Boolean).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      copy.textContent = '✓';
      setTimeout(() => { copy.textContent = '⧉'; }, 900);
    } catch { /* clipboard denied */ }
  });
  li.append(copy);
  return li;
}

function updateChipCounts(c) {
  const total = (c.red || 0) + (c.yellow || 0) + (c.green || 0) + (c.info || 0);
  for (const b of $$('#filterChips button')) {
    const n = b.dataset.f === 'all' ? total : c[b.dataset.f] || 0;
    b.querySelector('.count').textContent = String(n);
  }
}

function setFilter(f) {
  state.filter = f;
  $$('#filterChips button').forEach(b => {
    const on = b.dataset.f === f;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  for (const li of $$('#sections li.item')) {
    li.hidden = !(f === 'all' || li.dataset.status === f);
  }
}

function showError(msg) {
  const box = $('#errorBox');
  box.textContent = `⚠️ ${msg}`;
  box.hidden = false;
}

function hideError() {
  $('#errorBox').hidden = true;
}

// ---------------------------------------------------------------- export --

async function exportReport(format) {
  const r = state.result;
  if (!r) return;
  const suggested = `switchcheck-${r.kind}-report-${r.meta.generatedAt}`;
  const path = await window.api.saveReport({
    format, title: r.title, sections: r.sections, meta: r.meta, suggestedName: suggested,
  });
  if (path) progressLine(`已导出：${format.toUpperCase()} → ${path}`, 'ok');
}

async function runTrialFromGui() {
  if (!state.lastOpts || state.lastOpts.type !== 'ci') return;
  const ok = await confirmDialog({
    title: '创建试跑 PR',
    message: '将在仓库中创建一个分支（把 Ubuntu job 钉到 ubuntu-26.04），并尝试通过 gh 打开 PR，让 CI 先用 26.04 试跑。继续吗？',
    confirmText: '创建 PR',
  });
  if (!ok) return;
  await window.api.runTrial({
    ciPath: state.lastOpts.ciPath || '.',
    dryRun: false,
  });
}

// ------------------------------------------------------- history + diff --

function diffAgainst(prevResult, curResult) {
  const key = f => `${f.title}`;
  const curAll = curResult.sections.flatMap(s => s.findings);
  const prevMap = new Map(prevResult.sections.flatMap(s => s.findings).map(f => [key(f), f]));
  const curMap = new Map(curAll.map(f => [key(f), f]));
  const fresh = curAll.filter(f => (f.status === 'red' || f.status === 'yellow') && !prevMap.has(key(f)));
  const resolved = [...prevMap.values()].filter(f => (f.status === 'red' || f.status === 'yellow') && !curMap.has(key(f)));
  return { fresh, resolved };
}

function diffHtml(prevAt, diff) {
  const box = el('div');
  box.append(el('div', 'diff-head',
    `与上次体检（${prevAt.slice(0, 10)}）对比:新增 ${diff.fresh.length} 项 · 已解决 ${diff.resolved.length} 项`));
  const list = el('div', 'diff-list');
  for (const f of diff.fresh.slice(0, 10)) {
    const row = el('div', 'diff-row');
    row.append(el('span', `badge ${f.status}`, STATUS_ZH[f.status]));
    row.append(el('span', null, `新增:${f.title}`));
    list.append(row);
  }
  for (const f of diff.resolved.slice(0, 10)) {
    const row = el('div', 'diff-row resolved');
    row.append(el('span', null, `✓ ${f.title}`));
    list.append(row);
  }
  if (diff.fresh.length || diff.resolved.length) box.append(list);
  return box;
}

async function loadHistoryEntry(id) {
  const cur = await window.api.historyGet(id);
  if (!cur) return;
  const list = await window.api.historyList();
  const idx = list.findIndex(e => e.id === id);
  const prevSameKind = list.slice(idx + 1).find(e => e.kind === cur.entry.kind);
  let diffHtmlOut = null;
  if (prevSameKind) {
    const prev = await window.api.historyGet(prevSameKind.id);
    if (prev) diffHtmlOut = diffHtml(prevSameKind.at, diffAgainst(prev.result, cur.result));
  }
  hideError();
  $('#main').scrollTop = 0;
  renderResult(cur.result, {
    targetLabel: cur.entry.host,
    at: cur.entry.at,
    fromHistory: true,
    diffHtml: diffHtmlOut || undefined,
  });
}

async function openHistory() {
  const modal = el('div');
  modal.append(el('h3', null, '体检历史'));

  const listWrap = el('div');
  modal.append(listWrap);

  const actions = el('div', 'actions');
  const clearBtn = el('button', 'ghost danger', '清空历史');
  clearBtn.addEventListener('click', async () => {
    if (!(await confirmDialog({
      title: '清空体检历史',
      message: '所有历史记录将被删除，且无法恢复。',
      confirmText: '清空',
      danger: true,
    }))) return;
    await window.api.historyClear();
    await renderList();
  });
  const closeBtn = el('button', null, '关闭');
  closeBtn.addEventListener('click', closeModal);
  actions.append(clearBtn, closeBtn);
  modal.append(actions);
  openModal(modal);

  async function renderList() {
    listWrap.textContent = '';
    const entries = await window.api.historyList();
    if (!entries.length) {
      listWrap.append(el('div', 'hint', '还没有体检记录。跑一次体检后可以在这里回顾和对比。'));
    }
    for (const e of entries) {
      const row = el('div', 'profile-row');
      const meta = el('div', 'meta');
      meta.append(el('div', 'n', `${KIND_ICON[e.kind] || '🚦'} ${L.KIND_ZH[e.kind] || e.kind} — ${e.host}`));
      meta.append(el('div', 'h', `${e.at.slice(0, 16).replace('T', ' ')}`));
      row.append(meta);
      const pill = el('span', `badge ${e.verdict}`, STATUS_ZH[e.verdict] || e.verdict);
      row.append(pill);
      const load = el('button', 'ghost', '打开');
      load.addEventListener('click', async () => {
        closeModal();
        await loadHistoryEntry(e.id);
      });
      row.append(load);
      listWrap.append(row);
    }
  }

  renderList();
}

// ----------------------------------------------------------------- modal --

// ------------------------------------------------- modal infrastructure --

let modalKeyHandler = null;
let lastFocused = null;

function openModal(modal) {
  closeModal();
  lastFocused = document.activeElement;
  modal.classList.add('modal');
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  const mask = el('div', 'modal-mask');
  mask.addEventListener('mousedown', e => { if (e.target === mask) closeModal(); });
  mask.append(modal);
  $('#modalRoot').append(mask);
  const first = modal.querySelector('button, input, select, textarea, [tabindex]:not([tabindex="-1"])');
  if (first) first.focus();
  modalKeyHandler = e => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeModal();
    } else if (e.key === 'Tab') {
      const items = [...modal.querySelectorAll('button, input, select, textarea, [tabindex]:not([tabindex="-1"])')]
        .filter(x => !x.disabled && x.offsetParent !== null);
      if (!items.length) return;
      const at = items.indexOf(document.activeElement);
      if (e.shiftKey && (at === 0 || at === -1)) { e.preventDefault(); items[items.length - 1].focus(); }
      else if (!e.shiftKey && at === items.length - 1) { e.preventDefault(); items[0].focus(); }
    }
  };
  document.addEventListener('keydown', modalKeyHandler);
}

function closeModal() {
  if (modalKeyHandler) {
    document.removeEventListener('keydown', modalKeyHandler);
    modalKeyHandler = null;
  }
  $('#modalRoot').textContent = '';
  if (lastFocused && lastFocused.focus) { lastFocused.focus(); lastFocused = null; }
}

// Promise-based confirmation for destructive / outward-facing actions.
function confirmDialog({ title, message, confirmText = '确定', danger = false }) {
  return new Promise(resolve => {
    const modal = el('div');
    modal.append(
      el('h3', null, title),
      el('p', 'confirm-msg', message),
    );
    const actions = el('div', 'actions');
    const cancelBtn = el('button', null, '取消');
    const okBtn = el('button', danger ? 'primary danger' : 'primary', confirmText);
    const done = v => { closeModal(); resolve(v); };
    cancelBtn.addEventListener('click', () => done(false));
    okBtn.addEventListener('click', () => done(true));
    actions.append(cancelBtn, okBtn);
    modal.append(actions);
    openModal(modal);
    okBtn.focus();
  });
}

function openManager() {
  const modal = el('div');
  modal.append(el('h3', null, 'SSH 连接管理'));

  const list = el('div');
  modal.append(list);

  const form = el('div', 'grid');
  form.hidden = true;

  const f = {};
  const field = (key, label, cls, ...rest) => {
    const wrap = el('label', 'field' + (cls === 'full' ? ' full' : ''));
    wrap.append(el('span', null, label));
    if (rest[0] === 'select') {
      f[key] = el('select');
      for (const [v, t] of [['password', '密码'], ['key', '私钥文件']]) {
        const o = el('option', null, t);
        o.value = v;
        f[key].append(o);
      }
    } else if (rest[0] === 'checkbox') {
      f[key] = el('input');
      f[key].type = 'checkbox';
      const row = el('span', null);
      row.append(f[key]);
      row.append(document.createTextNode(rest[1] || ''));
      wrap.textContent = '';
      wrap.append(el('span', null, label), row);
    } else {
      f[key] = el('input');
      f[key].type = rest[0] === 'password' ? 'password' : 'text';
      if (rest[1]) f[key].placeholder = rest[1];
    }
    wrap.append(f[key]);
    return wrap;
  };

  form.append(
    field('name', '名称', null, 'text', '办公室台式机'),
    field('host', '主机地址', null, 'text', '192.168.1.23 或 build.example.com'),
    field('port', '端口', null, 'text', '22'),
    field('username', '用户名', null, 'text', 'Administrator'),
    field('authType', '认证方式', null, 'select'),
    (() => {
      const wrap = el('label', 'field');
      wrap.append(el('span', null, '私钥文件路径'));
      const row = el('div', 'row');
      f.keyPath = el('input');
      f.keyPath.type = 'text';
      f.keyPath.placeholder = 'C:\\Users\\me\\.ssh\\id_ed25519';
      const browse = el('button', 'ghost', '浏览…');
      browse.addEventListener('click', async () => {
        const p = await window.api.pickKeyFile();
        if (p) f.keyPath.value = p;
      });
      row.append(f.keyPath, browse);
      wrap.append(row);
      return wrap;
    })(),
    field('password', '密码', null, 'password'),
    field('keyPassphrase', '私钥口令（可选）', null, 'password'),
    field('rememberPassword', '把密码/口令加密保存在本机', 'full', 'checkbox'),
  );

  const formActions = el('div', 'actions');
  const saveBtn = el('button', 'primary', '保存连接');
  const cancelBtn = el('button', null, '取消');
  cancelBtn.addEventListener('click', () => { form.hidden = true; });
  saveBtn.addEventListener('click', async () => {
    try {
      await window.api.saveProfile({
        id: form.dataset.editId || undefined,
        name: f.name.value.trim(),
        host: f.host.value.trim(),
        port: Number(f.port.value) || 22,
        username: f.username.value.trim(),
        authType: f.authType.value,
        keyPath: f.keyPath.value.trim(),
        password: f.password.value,
        keyPassphrase: f.keyPassphrase.value,
        rememberPassword: f.rememberPassword.checked,
      });
      form.hidden = true;
      await loadProfiles();
      await renderList();
    } catch (e) {
      testResult.className = 'test-fail';
      testResult.textContent = e.message;
    }
  });
  formActions.append(cancelBtn, saveBtn);
  form.append(formActions);
  modal.append(form);

  const testResult = el('div');
  testResult.className = 'test-fail';

  const actions = el('div', 'actions');
  const importBtn = el('button', 'ghost', '导入…');
  const exportBtn = el('button', 'ghost', '导出…');
  const newBtn = el('button', 'ghost', '＋ 新建连接');
  const closeBtn = el('button', null, '关闭');
  importBtn.addEventListener('click', async () => {
    const r = await window.api.importProfiles();
    if (r) {
      testResult.className = 'test-ok';
      testResult.textContent = `已导入 ${r.added} 个连接${r.skipped ? `，跳过重复 ${r.skipped} 个` : ''}。`;
      await loadProfiles();
      await renderList();
    }
  });
  exportBtn.addEventListener('click', async () => {
    const path = await window.api.exportProfiles();
    if (path) {
      testResult.className = 'test-ok';
      testResult.textContent = `已导出（不含密钥）→ ${path}`;
    }
  });
  newBtn.addEventListener('click', () => {
    delete form.dataset.editId;
    for (const k of Object.keys(f)) {
      if (f[k].type === 'checkbox') f[k].checked = false;
      else if (f[k].tagName !== 'SELECT') f[k].value = '';
      else f[k].value = 'password';
    }
    f.port.value = '22';
    form.hidden = false;
    testResult.textContent = '';
  });
  closeBtn.addEventListener('click', closeModal);
  actions.append(newBtn, importBtn, exportBtn, closeBtn);
  modal.append(testResult, actions);
  openModal(modal);

  async function renderList() {
    list.textContent = '';
    const { profiles } = await window.api.listProfiles();
    state.profiles = profiles;
    if (!profiles.length) {
      list.append(el('div', 'hint', '还没有连接配置。点「＋ 新建连接」添加一台远程主机。'));
    }
    for (const p of profiles) {
      const row = el('div', 'profile-row');
      const meta = el('div', 'meta');
      meta.append(el('div', 'n', p.name));
      const secretNote = p.authType === 'key' ? '私钥' : '密码';
      const stored = p.hasPassword || p.hasKeyPassphrase ? ' · 已存密' : '';
      meta.append(el('div', 'h', `${p.username}@${p.host}:${p.port} · ${secretNote}${stored}`));
      if (p.hostFingerprint) {
        meta.append(el('div', 'h fp', `🔑 ${p.hostFingerprint}`));
      }
      row.append(meta);
      const status = el('span');
      status.setAttribute('aria-live', 'polite');
      const test = el('button', 'ghost', '测试');
      test.addEventListener('click', async () => {
        status.textContent = '测试中…';
        status.className = '';
        test.disabled = true;
        try {
          const r = await window.api.sshTest({
            profileId: p.id,
            password: form.hidden ? '' : f.password.value,
            passphrase: form.hidden ? '' : f.keyPassphrase.value,
          });
          status.className = r.ok ? 'test-ok' : 'test-fail';
          status.textContent = r.ok
            ? { windows: '✓ 可连接（Windows）', unix: '✓ 可连接（Linux/Unix）' }[r.platform] || '✓ 可连接'
            : `✗ ${r.error}`;
        } finally {
          test.disabled = false;
        }
      });
      const edit = el('button', 'ghost', '编辑');
      edit.addEventListener('click', () => {
        form.dataset.editId = p.id;
        f.name.value = p.name;
        f.host.value = p.host;
        f.port.value = String(p.port || 22);
        f.username.value = p.username;
        f.authType.value = p.authType;
        f.keyPath.value = p.keyPath || '';
        f.password.value = p.password || '';
        f.keyPassphrase.value = p.keyPassphrase || '';
        f.rememberPassword.checked = false;
        form.hidden = false;
        testResult.textContent = '';
      });
      const del = el('button', 'ghost danger', '删除');
      del.addEventListener('click', async () => {
        if (!(await confirmDialog({
          title: `删除「${p.name}」`,
          message: '连接配置将被删除，保存在本机的密码/口令也会一并清除。',
          confirmText: '删除',
          danger: true,
        }))) return;
        await window.api.deleteProfile(p.id);
        await loadProfiles();
        await renderList();
      });
      row.append(status, test, edit, del);
      list.append(row);
    }
  }

  renderList();
}

// ----------------------------------------------------------------- theme --

const THEMES = ['system', 'light', 'dark'];
const THEME_LABEL = { system: '🌗 跟随系统', light: '☀️ 浅色', dark: '🌙 深色' };
const schemeMq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

let theme = 'system';

function applyTheme() {
  const effective = theme === 'system' ? (schemeMq && schemeMq.matches ? 'dark' : 'light') : theme;
  document.documentElement.dataset.theme = effective;
  $('#themeBtn').textContent = THEME_LABEL[theme];
}

function cycleTheme() {
  theme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
  try { localStorage.setItem('sc-theme', theme); } catch { /* private mode */ }
  applyTheme();
}

// ----------------------------------------------------------------- update --

let updateState = null;

function applyUpdateStatus(msg) {
  if (!msg) return;
  updateState = msg.state;
  const pill = $('#updatePill');
  if (msg.state === 'available') {
    pill.textContent = `⬇️ 新版本 v${msg.version} 下载中…`;
    pill.hidden = false;
  } else if (msg.state === 'downloading') {
    pill.textContent = `⬇️ 下载中 ${msg.percent}%`;
    pill.hidden = false;
  } else if (msg.state === 'downloaded') {
    pill.textContent = `✅ v${msg.version} 已就绪，点击重启更新`;
    pill.hidden = false;
  } else if (msg.state === 'error' || msg.state === 'none') {
    pill.hidden = true;
  }
}

// ------------------------------------------------------------------ init --

function bind() {
  $('#typeChoices').addEventListener('click', e => {
    const c = e.target.closest('.choice');
    if (c) setType(c.dataset.type);
  });
  $('#linuxTargets').addEventListener('click', e => {
    const c = e.target.closest('.choice');
    if (c) setTarget(c.dataset.target);
  });
  $('#ciTargets').addEventListener('click', e => {
    const c = e.target.closest('.choice');
    if (c) setTarget(c.dataset.target);
  });
  $('#profileSelect').addEventListener('change', updateSecretRows);
  $('#manageBtn').addEventListener('click', openManager);
  $('#historyBtn').addEventListener('click', openHistory);
  $('#ciBrowseBtn').addEventListener('click', async () => {
    const p = await window.api.pickFolder();
    if (p) $('#ciPathInput').value = p;
  });
  $('#runBtn').addEventListener('click', run);
  $('#trialBtn').addEventListener('click', runTrialFromGui);
  $('#filterChips').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (b) setFilter(b.dataset.f);
  });
  $('#exportHtml').addEventListener('click', () => exportReport('html'));
  $('#exportMd').addEventListener('click', () => exportReport('markdown'));
  $('#exportJson').addEventListener('click', () => exportReport('json'));
  $('#themeBtn').addEventListener('click', cycleTheme);
  if (schemeMq && schemeMq.addEventListener) schemeMq.addEventListener('change', applyTheme);
  // in-app update pill (only fires in packaged builds)
  window.api.onUpdateStatus(msg => applyUpdateStatus(msg));
  $('#updatePill').addEventListener('click', () => {
    if (updateState === 'downloaded') window.api.updateInstall();
    else window.api.updateCheck();
  });
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      run();
      return;
    }
    // radiogroup arrow navigation for the choice cards
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      const group = e.target.closest && e.target.closest('[role="radiogroup"]');
      if (!group) return;
      const items = [...group.querySelectorAll('.choice')].filter(c => !c.hidden);
      const at = items.indexOf(document.activeElement);
      if (at === -1) return;
      const dir = (e.key === 'ArrowDown' || e.key === 'ArrowRight') ? 1 : -1;
      const next = items[(at + dir + items.length) % items.length];
      e.preventDefault();
      next.focus();
      next.click();
    }
  });
  $('#clearProgressBtn').addEventListener('click', () => {
    $('#progressLog').textContent = '';
    $('#progressPanel').hidden = true;
  });
  window.api.onProgress(msg => progressLine(msg.message));

  try { theme = localStorage.getItem('sc-theme') || 'system'; } catch { theme = 'system'; }
  applyTheme();

  try {
    const last = JSON.parse(localStorage.getItem('sc-last') || 'null');
    if (last && ['linux', 'ci', 'runtime'].includes(last.type)) {
      setType(last.type);
      if (['local', 'ssh'].includes(last.target)) setTarget(last.target);
      return; // restored — skip the default setType below
    }
  } catch { /* ignore */ }
  setType('linux');
}

async function init() {
  bind();
  await loadProfiles();
  const v = await window.api.version();
  $('#versionFoot').textContent = `SwitchCheck v${v} · 与 CLI 同一体检引擎`;
}

init();
