/**
 * line.html「登入過期時依時機重新登入，且不弄丟勾選」的單元測試（jdc-tw-migration#114）。
 *
 * 守的是判斷與存取本身：
 *   ① `reloginPhase` 三種時機的每一格條件
 *   ② `onDeadCredential` 在 (a)／(b)／(c) 各做什麼（登出了沒、存了沒、面板出來沒）
 *   ③ 還原**用員編認人**（名單換序、少一人都要對），少還原的人要點名
 *   ④ 「哪些代號重登有用」只問 liff-relogin.js 那一份，本頁不另抄
 *
 * ⚠️ 這一層的 `liff.login` 不會真的導頁 ⇒「導走之後勾選還在不在」在這裡是恆真的，
 *    那一格只在 e2e（`tests/e2e/line-relogin.spec.js`）量得到。
 *
 * 手法同 `welfare-page-wiring.test.js`：**從 line.html 抽真的原始碼**跑，不另抄一份。
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const S = require('./helpers/source-scan.js');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'line.html'), 'utf8');
const RELOGIN_SRC = fs.readFileSync(path.join(ROOT, 'assets', 'liff-relogin.js'), 'utf8');

/** 抽一段頂層宣告（`var X = …;`）原樣執行，不在這裡抄值。 */
function declSrc(re, what) {
  const m = SRC.match(re);
  assert.ok(m, 'line.html 裡找不到 ' + what + '——改名了就要同步改這支測試');
  return m[0];
}

const 受測 = ['pickedList', 'newTitleValue', 'reloginPhase', 'snapshotDraft', 'saveDraft',
  'readDraft', 'dropDraft', 'onDeadCredential', 'showReloginPanel', 'refreshReloginPanel',
  'renderReloginPanel', 'syncReloginButton', 'onReloginClick', 'afterInitialLoad',
  'restoreDraft', 'applyDraft', 'isTplDirty', 'tplTitle', 'setNote',
  'markDraftLeaving', 'takeDraftMark', 'markReloginSent', 'sendOutcomeNow'];

/**
 * 一個會真的記住值的 storage。`broken` ＝寫入就拋（無痕視窗／封鎖儲存）；
 * `'lossy'` ＝**寫入不拋、但沒寫進去**（讀回來不同）——只有「讀回比對」接得住這一種。
 */
function memStore(broken) {
  const m = {};
  return {
    m,
    getItem: (k) => (Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null),
    setItem: (k, v) => {
      if (broken === 'lossy') return;
      if (broken) throw new Error('QuotaExceededError');
      m[k] = String(v);
    },
    removeItem: (k) => { delete m[k]; },
  };
}

function ctxWith(o) {
  o = o || {};
  const els = {};
  const el = (id) => (els[id] = els[id] || {
    id, value: '', textContent: '', className: '', hidden: false, disabled: false, checked: false,
  });
  const calls = { logout: 0, login: 0, select: [], edited: 0, bump: 0, openUnit: 0 };
  const store = memStore(o.brokenStore);
  const local = memStore(false);
  const ctx = {
    console, JSON, Math, Date, Object, Array, String, Number, Promise,
    document: { getElementById: el, body: { appendChild() {} }, createElement: () => ({ setAttribute() {} }) },
    sessionStorage: store,
    localStorage: local,
    location: { href: 'https://x/line.html?probe=1' },
    ROWS: [], TEMPLATES: {}, TPL_ORDER: [], CURRENT_TPL: '', SAVED_TPL_TEXT: '',
    OPEN_UNIT: '', UNIT_IDX: {},
    OTP_STATE: { armed: false }, OTP_IN_FLIGHT: false, SEND_IN_FLIGHT: false, CANCEL_NONCE: '',
    selectTemplate: (id) => {
      calls.select.push(id); ctx.CURRENT_TPL = id;
      const t = (ctx.TEMPLATES[id] || {}).text || '';
      el('wf-tpl').value = t; ctx.SAVED_TPL_TEXT = t;
    },
    onTplEdited: () => { calls.edited++; },
    bumpUiGen: () => { calls.bump++; },
    renderPickedCount: () => {},
    UI_GEN: 0, LAST_STATUS: null,
    renderStatus: () => { calls.status = (ctx.LAST_STATUS || {}).stateLabel || ''; },
    applyOpenUnit: () => { calls.openUnit++; },
    liff: {
      logout: () => { calls.logout++; },
      login: () => { calls.login++; },
    },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(RELOGIN_SRC, ctx, { filename: 'liff-relogin.js' });
  vm.runInContext(declSrc(/^var STATUS_WHY = \{[\s\S]*?\n\};/m, 'STATUS_WHY'), ctx);
  vm.runInContext(declSrc(/^var DRAFT_KEY = '[^']+';/m, 'DRAFT_KEY'), ctx);
  vm.runInContext(declSrc(/^var DRAFT_TTL_MS = [^;]+;/m, 'DRAFT_TTL_MS'), ctx);
  vm.runInContext(declSrc(/^var DRAFT_MARK_KEY = '[^']+';/m, 'DRAFT_MARK_KEY'), ctx);
  vm.runInContext(declSrc(/^var RELOGIN_UNKNOWN_MSG = '[^']+';/m, 'RELOGIN_UNKNOWN_MSG'), ctx);
  vm.runInContext('var RELOGIN_PANEL = false, RELOGIN_SAVED = false, RELOGIN_HAD_OTP = false,'
    + ' SEND_OUTCOME = null, RELOGIN_OTP_MAYBE = false;', ctx);
  受測.forEach((n) => vm.runInContext(S.fnSrc(n), ctx, { filename: n }));
  if (o.tried) store.setItem(ctx.RELOGIN_FLAG_KEY, '1');
  return { ctx, els, el, calls, store, local };
}

/** 名單：三個可發送、一個未綁定。**全部是假的**（本 repo 公開）。 */
const 名單 = () => [
  { empNo: 'E001', name: '測試甲', unit: '工務', status: 'ok' },
  { empNo: 'E002', name: '測試乙', unit: '工務', status: 'ok' },
  { empNo: 'E003', name: '測試丙', unit: '總務', status: 'ok' },
  { empNo: 'E004', name: '測試丁', unit: '總務', status: 'unbound' },
];

/** 把 ROWS 畫成 checkbox（id＝cb-<索引>，與 renderAudience 同一個約定）。 */
function 畫名單(t, rows, 勾) {
  t.ctx.ROWS = rows;
  rows.forEach((r, i) => {
    const cb = t.el('cb-' + i);
    cb.disabled = r.status !== 'ok';
    cb.checked = !cb.disabled && (勾 || []).indexOf(r.empNo) >= 0;
  });
}
const 勾了誰 = (t) => t.ctx.ROWS.filter((r, i) => t.el('cb-' + i).checked).map((r) => r.empNo).sort();

const 死憑證 = { ok: false, transport: false, reason: 'line_bad_token', msg: '後端原文：請聯絡資訊人員' };

/* ══ ① reloginPhase：每一格條件 ══════════════════════════════════════ */

test('reloginPhase：什麼都沒動 ⇒ (a)', () => {
  const t = ctxWith();
  畫名單(t, 名單(), []);
  t.ctx.TPL_ORDER = ['T1', 'T2']; t.ctx.CURRENT_TPL = 'T1';
  assert.equal(t.ctx.reloginPhase('getWelfareAudience'), 'a');
});

test('reloginPhase：(b) 的四種條件各自成立', () => {
  const 情境 = {
    勾了人: (t) => { t.el('cb-0').checked = true; },
    未存內容: (t) => { t.el('wf-tpl').value = '改過'; },
    換過範本: (t) => { t.ctx.CURRENT_TPL = 'T2'; },
    新範本標題: (t) => { t.el('tpl-new-title').value = '端午'; },
  };
  Object.keys(情境).forEach((k) => {
    const t = ctxWith();
    畫名單(t, 名單(), []);
    t.ctx.TPL_ORDER = ['T1', 'T2']; t.ctx.CURRENT_TPL = 'T1';
    情境[k](t);
    assert.equal(t.ctx.reloginPhase('saveWelfareTemplate'), 'b', k + ' 沒有被判成 (b)');
  });
});

test('reloginPhase：(c) 輸碼中／送出中／反悔窗口', () => {
  const 情境 = {
    輸碼中: (c) => { c.OTP_STATE = { armed: true }; },
    送出中: (c) => { c.SEND_IN_FLIGHT = true; },
    反悔窗口: (c) => { c.CANCEL_NONCE = 'n1'; },
  };
  Object.keys(情境).forEach((k) => {
    const t = ctxWith();
    畫名單(t, 名單(), []);
    情境[k](t.ctx);
    assert.equal(t.ctx.reloginPhase('getWelfareStatus'), 'c', k + ' 沒有被判成 (c)');
  });
});

test('reloginPhase：寄碼中收到別支的死憑證 ⇒ (c)；寄碼那一發自己 ⇒ 照勾選判 (b)', () => {
  const t = ctxWith();
  畫名單(t, 名單(), ['E001']);
  t.ctx.OTP_IN_FLIGHT = true;
  assert.equal(t.ctx.reloginPhase('getWelfareStatus'), 'c',
    '寄碼還在路上，不知道信寄出去沒有 ⇒ 不可以自動導走');
  assert.equal(t.ctx.reloginPhase('requestWelfareOtp'), 'b',
    '守門擋下寄碼那一發 ＝ 信沒寄出 ⇒ 屬於「還沒送 OTP」');
});

/* ══ ② onDeadCredential：三種時機的處置 ═════════════════════════════ */

test('⬛ 對照：不是死憑證的回應原樣交還、什麼都不做', () => {
  const t = ctxWith();
  畫名單(t, 名單(), ['E001']);
  const ok = { ok: true, rows: [] };
  assert.strictEqual(t.ctx.onDeadCredential(ok, 'getWelfareAudience', {}), ok);
  const 沒用 = { ok: false, reason: 'role_mismatch', msg: 'x' };
  assert.strictEqual(t.ctx.onDeadCredential(沒用, 'saveWelfareTemplate', {}), 沒用);
  assert.equal(t.calls.logout, 0);
  assert.equal(t.store.getItem(t.ctx.DRAFT_KEY), null, '重登沒用的代號也存了暫存');
});

test('(a) 什麼都沒動 ⇒ 自動登出＋登入，不存暫存', () => {
  const t = ctxWith();
  畫名單(t, 名單(), []);
  t.ctx.onDeadCredential(死憑證, 'getWelfareAudience', {});
  assert.equal(t.calls.logout, 1);
  assert.equal(t.calls.login, 1);
  assert.equal(t.store.getItem(t.ctx.DRAFT_KEY), null);
});

test('(b) 勾了人 ⇒ 先存再自動重登；存下的是員編與姓名', () => {
  const t = ctxWith();
  畫名單(t, 名單(), ['E001', 'E003']);
  t.ctx.TPL_ORDER = ['T1']; t.ctx.CURRENT_TPL = 'T1';
  t.ctx.onDeadCredential(死憑證, 'saveWelfareTemplate', {});
  const d = JSON.parse(t.store.getItem(t.ctx.DRAFT_KEY));
  assert.deepEqual(d.picked.map((p) => p.empNo).sort(), ['E001', 'E003']);
  assert.equal(d.picked[0].name, '測試甲');
  assert.equal(t.calls.logout, 1, '(b) 存好了卻沒自動重登');
  assert.ok(!(t.els['relogin-box'] && t.els['relogin-box'].hidden === false), '(b) 自動那條不該出面板');
});

test('(b) 存不進去 ⇒ 不導走，出面板並明講不會還原', () => {
  const t = ctxWith({ brokenStore: true });
  畫名單(t, 名單(), ['E001']);
  const out = t.ctx.onDeadCredential(死憑證, 'saveWelfareTemplate', {});
  assert.equal(t.calls.logout, 0, '東西存不起來還整頁導走 ⇒ 勾選被洗掉');
  assert.equal(t.el('relogin-box').hidden, false);
  assert.match(t.el('relogin-msg').textContent, /不會還原/);
  assert.match(out.msg, /重新登入/);
});

test('(b) 這個分頁已經自動重登過 ⇒ 不蓋覆蓋層、改給鈕（勾選還看得到）', () => {
  const t = ctxWith({ tried: true });
  畫名單(t, 名單(), ['E001']);
  t.ctx.onDeadCredential(死憑證, 'saveWelfareTemplate', {});
  assert.equal(t.calls.logout, 0);
  assert.equal(t.el('relogin-box').hidden, false);
  assert.match(t.el('relogin-msg').textContent, /已保存你的勾選（1 人）/);
});

test('(c) 輸碼中 ⇒ 不導走；存了、面板講驗證碼要重寄；後端原文換成實話', () => {
  const t = ctxWith();
  畫名單(t, 名單(), ['E001', 'E002']);
  t.ctx.OTP_STATE = { armed: true };
  const out = t.ctx.onDeadCredential(死憑證, 'sendWelfareBroadcast', { otp: '123456' });
  assert.equal(t.calls.logout, 0, '(c) 自動導走了');
  assert.equal(t.calls.login, 0);
  const d = JSON.parse(t.store.getItem(t.ctx.DRAFT_KEY));
  assert.equal(d.otpArmed, true);
  assert.equal(d.picked.length, 2);
  assert.match(t.el('relogin-msg').textContent, /已保存你的勾選（2 人）/);
  assert.match(t.el('relogin-msg').textContent, /驗證碼回來之後不能再用/);
  assert.ok(out.msg.indexOf('資訊人員') < 0, '面板在旁邊還叫她找資訊人員：' + out.msg);
  assert.equal(out.reason, 'line_bad_token', '改寫訊息時把 reason 丟了');
  assert.equal(死憑證.msg, '後端原文：請聯絡資訊人員', '改到了原物件（應該是淺拷貝）');
});

test('(c) 反悔窗口的取消被擋 ⇒ 講「會照常送出」、鈕在送出回來前停用', () => {
  const t = ctxWith();
  畫名單(t, 名單(), ['E001']);
  t.ctx.CANCEL_NONCE = 'n1'; t.ctx.SEND_IN_FLIGHT = true;
  const out = t.ctx.onDeadCredential(死憑證, 'sendWelfareBroadcast', { cancel: '1' });
  assert.match(out.msg, /取消沒有送達.*照常送出/);
  assert.equal(t.el('btn-relogin').disabled, true, '送出中就能按 ⇒ 導走後看不到這一批的結果');
  assert.match(t.el('relogin-wait').textContent, /不會取消/);
  t.ctx.SEND_IN_FLIGHT = false;
  t.ctx.syncReloginButton();
  assert.equal(t.el('btn-relogin').disabled, false, '送出回來了鈕還是按不動');
});

test('(c) 按鈕：先重存現況、再登出＋登入', () => {
  const t = ctxWith();
  畫名單(t, 名單(), ['E001']);
  t.ctx.OTP_STATE = { armed: true };
  t.ctx.onDeadCredential(死憑證, 'sendWelfareBroadcast', {});
  t.ctx.OTP_STATE = { armed: false };      // showServerReject 之後會 disarm
  t.el('cb-1').checked = true;             // 面板出現後她又多勾一個
  t.ctx.onReloginClick();
  const d = JSON.parse(t.store.getItem(t.ctx.DRAFT_KEY));
  assert.deepEqual(d.picked.map((p) => p.empNo).sort(), ['E001', 'E002'], '按鈕沒有重存現況');
  assert.equal(d.otpArmed, true, '重存時把「手上有過驗證碼」弄丟了');
  assert.equal(t.calls.logout, 1);
  assert.equal(t.calls.login, 1);
});

/* ══ ③ 還原 ══════════════════════════════════════════════════════════ */

function 種暫存(t, d) {
  t.store.setItem(t.ctx.DRAFT_KEY, JSON.stringify(Object.assign({
    v: 1, at: Date.now(), phase: 'b', picked: [], templateId: '', templateTitle: '',
    text: '', dirty: false, baseText: '', openUnit: '', newTitle: '', otpArmed: false,
  }, d)));
}

test('🔴 還原用員編認人：名單換了順序也還原成同一批人', () => {
  const t = ctxWith();
  種暫存(t, { picked: [{ empNo: 'E001', name: '測試甲' }, { empNo: 'E003', name: '測試丙' }] });
  畫名單(t, 名單().reverse(), []);          // [E004,E003,E002,E001]
  t.ctx.afterInitialLoad(true);
  assert.deepEqual(勾了誰(t), ['E001', 'E003'], '用位置對回的話會勾到別人');
  assert.match(t.el('restore-note').textContent, /已還原.*2 人/);
  assert.equal(t.store.getItem(t.ctx.DRAFT_KEY), null, '還原完沒有移除暫存（下次開頁會再還原一次）');
});

test('🔴 少還原的人要點名，不可以靜默少人', () => {
  const t = ctxWith();
  種暫存(t, { picked: [{ empNo: 'E001', name: '測試甲' }, { empNo: 'E009', name: '測試壬' },
                      { empNo: 'E004', name: '測試丁' }] });
  畫名單(t, 名單(), []);
  t.ctx.afterInitialLoad(true);
  assert.deepEqual(勾了誰(t), ['E001']);
  const n = t.el('restore-note');
  assert.match(n.textContent, /勾了 3 人，只還原了 1 人/);
  assert.match(n.textContent, /測試壬（不在名單上）/);
  assert.match(n.textContent, /測試丁（尚未綁定 LINE）/);
  assert.match(n.className, /err/);
});

test('還原範本與編到一半的文字；伺服器版本被改過要講', () => {
  const t = ctxWith();
  t.ctx.TEMPLATES = { T1: { title: '甲', text: 'A' }, T2: { title: '乙', text: 'B2' } };
  t.ctx.TPL_ORDER = ['T1', 'T2'];
  t.ctx.selectTemplate('T1');
  種暫存(t, { templateId: 'T2', templateTitle: '乙', text: '編到一半', dirty: true, baseText: 'B' });
  畫名單(t, 名單(), []);
  t.ctx.afterInitialLoad(true);
  assert.equal(t.ctx.CURRENT_TPL, 'T2');
  assert.equal(t.el('wf-tpl').value, '編到一半');
  assert.equal(t.calls.edited, 1, '放回文字卻沒走 onTplEdited（碼不失效、按鈕不同步）');
  assert.match(t.el('restore-note').textContent, /離開期間被改過/);
});

test('範本已不在可用清單 ⇒ 明說，並把編到一半的原文放進提示', () => {
  const t = ctxWith();
  t.ctx.TEMPLATES = { T1: { title: '甲', text: 'A' } };
  t.ctx.TPL_ORDER = ['T1'];
  t.ctx.selectTemplate('T1');
  種暫存(t, { templateId: 'T9', templateTitle: '已停用那則', text: '她打的字', dirty: true, baseText: '' });
  畫名單(t, 名單(), []);
  t.ctx.afterInitialLoad(true);
  assert.equal(t.el('wf-tpl').value, 'A', '把她的字塞進了另一則範本');
  assert.match(t.el('restore-note').textContent, /已停用那則.*不在可用清單/);
  assert.match(t.el('restore-note').textContent, /她打的字/);
});

test('名單或範本沒載到 ⇒ 不動暫存，並講「還沒還原」', () => {
  const t = ctxWith();
  種暫存(t, { picked: [{ empNo: 'E001', name: '測試甲' }] });
  t.ctx.afterInitialLoad(false);
  assert.notEqual(t.store.getItem(t.ctx.DRAFT_KEY), null, '沒載到就把暫存用掉了 ⇒ 重新整理也救不回來');
  assert.match(t.el('restore-note').textContent, /還沒還原/);
});

test('⬛ 對照：沒有暫存 ⇒ 還原什麼都不說', () => {
  const t = ctxWith();
  畫名單(t, 名單(), []);
  t.ctx.afterInitialLoad(true);
  assert.equal(t.el('restore-note').textContent, '');
});

test('超過期限的暫存 ⇒ 丟掉但講出來', () => {
  const t = ctxWith();
  種暫存(t, { at: Date.now() - t.ctx.DRAFT_TTL_MS - 60000, picked: [{ empNo: 'E001', name: '測試甲' }] });
  畫名單(t, 名單(), []);
  t.ctx.afterInitialLoad(true);
  assert.deepEqual(勾了誰(t), []);
  assert.match(t.el('restore-note').textContent, /超過 30 分鐘/);
  assert.equal(t.store.getItem(t.ctx.DRAFT_KEY), null);
});

test('存了就讀得回來（來回）；storage 拋例外 ⇒ saveDraft 回 false', () => {
  const t = ctxWith();
  畫名單(t, 名單(), ['E002']);
  assert.equal(t.ctx.saveDraft('b', false), true);
  const r = t.ctx.readDraft();
  assert.equal(r.status, 'ok');
  assert.deepEqual(r.draft.picked, [{ empNo: 'E002', name: '測試乙' }]);
  const b = ctxWith({ brokenStore: true });
  畫名單(b, 名單(), ['E002']);
  assert.equal(b.ctx.saveDraft('b', false), false);
});

/* ══ ⑤ 第三方驗證的補修（#114 🟡2／🟡3／🟡4／🟡5）══════════════════════ */

test('🔴 🟡4 寫進去卻讀回不同（不拋例外）⇒ saveDraft 回 false、(b) 不導走（突變 D：不讀回比對）', () => {
  const t = ctxWith({ brokenStore: 'lossy' });
  畫名單(t, 名單(), ['E001']);
  assert.equal(t.ctx.saveDraft('b', false), false, '沒存到卻回 true ⇒ 呼叫端會放心導走');
  t.ctx.onDeadCredential(死憑證, 'saveWelfareTemplate', {});
  assert.equal(t.calls.logout, 0, '沒存到還整頁導走 ⇒ 勾選被洗掉、而且一句話都沒有');
  assert.match(t.el('relogin-msg').textContent, /不會還原/);
  // ⬛ 對照：同一條路、storage 正常 ⇒ 會導走（證明上面的 0 不是這條路本來就不導）
  const ok = ctxWith();
  畫名單(ok, 名單(), ['E001']);
  ok.ctx.onDeadCredential(死憑證, 'saveWelfareTemplate', {});
  assert.equal(ok.calls.logout, 1);
});

test('🔴 🟡2 面板開著時送出成功 ⇒ 面板與回來的提示都講「已送出，不要重寄」，不叫她重寄', () => {
  const t = ctxWith();
  畫名單(t, 名單(), ['E001', 'E002']);
  t.ctx.OTP_STATE = { armed: true };
  t.ctx.CANCEL_NONCE = 'n1'; t.ctx.SEND_IN_FLIGHT = true;
  t.ctx.onDeadCredential(死憑證, 'sendWelfareBroadcast', { cancel: '1' });
  assert.match(t.el('relogin-msg').textContent, /驗證碼回來之後不能再用/, '⬛ 零點：送出回來前本來就是這句');
  t.ctx.OTP_STATE = { armed: false };      // onSend 成功分支先 disarmOtp
  t.ctx.markReloginSent('sent', t.ctx.UI_GEN);
  t.ctx.SEND_IN_FLIGHT = false;
  const m = t.el('relogin-msg').textContent;
  assert.match(m, /這一批已送出，不要重寄/);
  assert.doesNotMatch(m, /寄驗證碼/, '已送出還叫她重寄：' + m);
  const d = JSON.parse(t.store.getItem(t.ctx.DRAFT_KEY));
  assert.equal(d.sent, true);
  assert.equal(d.otpArmed, false);
  t.ctx.onReloginClick();
  const back = ctxWith();
  back.store.setItem(back.ctx.DRAFT_KEY, t.store.getItem(t.ctx.DRAFT_KEY));
  畫名單(back, 名單(), []);
  back.ctx.afterInitialLoad(true);
  const n = back.el('restore-note').textContent;
  assert.match(n, /這一批已送出，不要重寄/);
  assert.doesNotMatch(n, /重新寄一次/, '還原提示在引導重發：' + n);
});

test('🔴 送出回 transport（狀態不明）⇒ 面板與回來的提示講「可能已經送出，不要重寄」，不叫她重寄', () => {
  const t = ctxWith();
  畫名單(t, 名單(), ['E001', 'E002']);
  t.ctx.OTP_STATE = { armed: true };
  t.ctx.CANCEL_NONCE = 'n1'; t.ctx.SEND_IN_FLIGHT = true;
  t.ctx.onDeadCredential(死憑證, 'sendWelfareBroadcast', { cancel: '1' });
  assert.match(t.el('relogin-msg').textContent, /寄驗證碼/, '⬛ 零點：送出回來前本來會叫她重寄');
  t.ctx.OTP_STATE = { armed: false };      // transport 分支也先 disarmOtp
  t.ctx.markReloginSent('unknown', t.ctx.UI_GEN);
  t.ctx.SEND_IN_FLIGHT = false;
  const m = t.el('relogin-msg').textContent;
  assert.match(m, /送出狀態不明，可能已經送出.*不要重寄/);
  assert.doesNotMatch(m, /寄驗證碼/, '狀態不明還叫她重寄：' + m);
  assert.doesNotMatch(m, /已送出，不要重寄/, '不明被講成確定已送出');
  const d = JSON.parse(t.store.getItem(t.ctx.DRAFT_KEY));
  assert.equal(d.unknown, true);
  assert.equal(d.otpArmed, false);
  const back = ctxWith();
  back.store.setItem(back.ctx.DRAFT_KEY, t.store.getItem(t.ctx.DRAFT_KEY));
  畫名單(back, 名單(), []);
  back.ctx.afterInitialLoad(true);
  const n = back.el('restore-note').textContent;
  assert.match(n, /可能已經送出.*不要重寄/);
  assert.doesNotMatch(n, /重新寄一次/, '還原提示在引導重發：' + n);
});

test('🔴 面板沒開時送出成功、同一批緊接著過期 ⇒ 暫存帶「已送出」，回來提示與狀態列照講（#114 重驗 W5）', () => {
  const t = ctxWith();
  畫名單(t, 名單(), ['E001', 'E002']);
  t.ctx.CURRENT_TPL = 't1'; t.ctx.TPL_ORDER = ['t1']; t.ctx.TEMPLATES = { t1: { title: '範本一', text: 'x' } };
  t.ctx.LAST_STATUS = { templateId: 't1', state: 'sent', stateLabel: '已發送（測試）', lastSentAt: '' };
  t.ctx.markReloginSent('sent', t.ctx.UI_GEN);      // 面板沒開
  assert.equal(t.ctx.RELOGIN_PANEL, false, '⬛ 零點：面板確實沒開');
  t.ctx.onDeadCredential(死憑證, 'getWelfareStatus', {});   // 送出後緊接的狀態查詢過期 ⇒ (b)
  assert.equal(t.calls.logout, 1, '⬛ 零點：走的是 (b) 自動導走');
  const d = JSON.parse(t.store.getItem(t.ctx.DRAFT_KEY));
  assert.equal(d.sent, true, '🔴 同一批已送出，暫存卻沒帶 ⇒ 回來同一批人勾好、狀態列寫「沒有發送紀錄」');
  assert.equal(d.sentStatus.templateId, 't1');
  const back = ctxWith();
  back.store.setItem(back.ctx.DRAFT_KEY, t.store.getItem(t.ctx.DRAFT_KEY));
  back.ctx.CURRENT_TPL = 't1'; back.ctx.TPL_ORDER = ['t1']; back.ctx.TEMPLATES = t.ctx.TEMPLATES;
  畫名單(back, 名單(), []);
  back.ctx.afterInitialLoad(true);
  assert.match(back.el('restore-note').textContent, /這一批已送出，不要重寄/);
  assert.equal(back.ctx.LAST_STATUS && back.ctx.LAST_STATUS.state, 'sent', '狀態列沒放回「已發送」');
  assert.equal(back.calls.status, '已發送（測試）');
});

test('⬛ 對照：送出之後她改過勾選（UI_GEN 變了）⇒ 那是另一批，不帶「已送出」', () => {
  const t = ctxWith();
  畫名單(t, 名單(), ['E001']);
  t.ctx.markReloginSent('sent', t.ctx.UI_GEN);
  t.ctx.UI_GEN++;                                    // 改勾選＝bumpUiGen
  t.ctx.OTP_STATE = { armed: true };
  t.ctx.onDeadCredential(死憑證, 'sendWelfareBroadcast', {});
  assert.doesNotMatch(t.el('relogin-msg').textContent, /已送出/);
  const d = JSON.parse(t.store.getItem(t.ctx.DRAFT_KEY));
  assert.equal(d.sent, false);
  assert.equal(d.sentStatus, null);
});

test('🔴 🟡a 寄碼那一發**自己**回死憑證 ⇒ 不講「驗證碼可能已寄出」（守門擋下＝沒寄出；突變 X6）', () => {
  const t = ctxWith({ tried: true });               // 已試過的分頁 ⇒ (b) 改出面板，才看得到文字
  畫名單(t, 名單(), ['E001']);
  t.ctx.OTP_IN_FLIGHT = true;
  t.ctx.onDeadCredential(死憑證, 'requestWelfareOtp', {});
  assert.equal(t.el('relogin-box').hidden, false, '⬛ 零點：面板要真的出來');
  assert.doesNotMatch(t.el('relogin-msg').textContent, /可能已寄出/);
});

test('🔴 🟡3 導走時寫記號（只有時間戳）；回來暫存不見了 ⇒ 明說「沒能保留」', () => {
  const t = ctxWith();
  畫名單(t, 名單(), ['E001']);
  t.ctx.onDeadCredential(死憑證, 'saveWelfareTemplate', {});
  assert.equal(t.calls.logout, 1, '⬛ 零點：(b) 要真的導走');
  const mark = t.local.getItem(t.ctx.DRAFT_MARK_KEY);
  assert.match(String(mark), /^\d+$/, '記號只准是時間戳，不可以帶任何內容：' + mark);
  // 導回來：sessionStorage 沒活下來（全新的一份），localStorage 還在
  const back = ctxWith();
  back.local.setItem(back.ctx.DRAFT_MARK_KEY, mark);
  畫名單(back, 名單(), []);
  back.ctx.afterInitialLoad(true);
  assert.match(back.el('restore-note').textContent, /剛才的勾選與內容沒能保留，請重新勾選/);
  assert.equal(back.local.getItem(back.ctx.DRAFT_MARK_KEY), null, '記號沒刪 ⇒ 下次開頁又誤報');
});

test('⬛ 🟡3 對照：沒有記號／記號過期 ⇒ 什麼都不說；暫存還在 ⇒ 正常還原並刪記號', () => {
  const none = ctxWith();
  畫名單(none, 名單(), []);
  none.ctx.afterInitialLoad(true);
  assert.equal(none.el('restore-note').textContent, '');
  const old = ctxWith();
  old.local.setItem(old.ctx.DRAFT_MARK_KEY, String(Date.now() - old.ctx.DRAFT_TTL_MS - 60000));
  畫名單(old, 名單(), []);
  old.ctx.afterInitialLoad(true);
  assert.equal(old.el('restore-note').textContent, '');
  assert.equal(old.local.getItem(old.ctx.DRAFT_MARK_KEY), null);
  const ok = ctxWith();
  種暫存(ok, { picked: [{ empNo: 'E001', name: '測試甲' }] });
  ok.local.setItem(ok.ctx.DRAFT_MARK_KEY, String(Date.now()));
  畫名單(ok, 名單(), []);
  ok.ctx.afterInitialLoad(true);
  assert.match(ok.el('restore-note').textContent, /已還原重新登入前的勾選 1 人/);
  assert.doesNotMatch(ok.el('restore-note').textContent, /沒能保留/);
  assert.equal(ok.local.getItem(ok.ctx.DRAFT_MARK_KEY), null);
});

test('⬛ 🟡3 對照：(c) 只是出面板、還沒按鈕 ⇒ 不寫記號；按了才寫', () => {
  const t = ctxWith();
  畫名單(t, 名單(), ['E001']);
  t.ctx.OTP_STATE = { armed: true };
  t.ctx.onDeadCredential(死憑證, 'sendWelfareBroadcast', {});
  assert.equal(t.local.getItem(t.ctx.DRAFT_MARK_KEY), null);
  t.ctx.onReloginClick();
  assert.match(String(t.local.getItem(t.ctx.DRAFT_MARK_KEY)), /^\d+$/);
});

test('🔴 🟡5 寄碼中、另一發先回死憑證 ⇒ 面板講「驗證碼可能已寄出」', () => {
  const t = ctxWith();
  畫名單(t, 名單(), ['E001']);
  t.ctx.OTP_IN_FLIGHT = true;
  t.ctx.onDeadCredential(死憑證, 'getWelfareStatus', {});
  assert.equal(t.calls.logout, 0);
  assert.match(t.el('relogin-msg').textContent, /驗證碼可能已寄出/);
  // ⬛ 對照：寄碼沒在路上、同樣走到面板（這個分頁已試過）⇒ 不講
  const c = ctxWith({ tried: true });
  畫名單(c, 名單(), ['E001']);
  c.ctx.onDeadCredential(死憑證, 'getWelfareStatus', {});
  assert.equal(c.el('relogin-box').hidden, false, '⬛ 零點：對照組也要真的出面板');
  assert.doesNotMatch(c.el('relogin-msg').textContent, /可能已寄出/);
});

/* ══ ④ 白名單只有一份 ════════════════════════════════════════════════ */

test('🔴 line.html 不另抄「重登有用的代號」，一律經 reloginVerdict', () => {
  const 字面值 = /['"]line_(bad|no)_token['"]/;
  assert.ok(字面值.test(RELOGIN_SRC), '⬛ 對照：這個掃法連 liff-relogin.js 那一份都掃不到 ⇒ 下面恆綠');
  assert.equal(字面值.test(S.stripComments(SRC)), false,
    'line.html 自己寫了代號字面值 ⇒ 白名單多了一份副本，後端改代號時這裡不會跟');
  assert.match(S.fnSrc('onDeadCredential'), /reloginVerdict\(/);
});

test('🔴 liff-relogin.js 要載在頁內 script 之前（否則 onDeadCredential 叫不到它）', () => {
  const a = SRC.indexOf('<script src="assets/liff-relogin.js"></script>');
  const b = SRC.indexOf('var GAS_URL=');
  assert.ok(a > 0, '沒有載 liff-relogin.js');
  assert.ok(b > 0, '⬛ 找不到頁內 script 的開頭 ⇒ 下面的比較沒意義');
  assert.ok(a < b);
});

test('🔴 wfCall 的解析出口接了 onDeadCredential（所有 action 都經過它）', () => {
  // ⚠️ 用 indexOf 不用含「function 空白」的正規式：`source-scan-tripwire` 會把那種字面量當成手寫抽取式。
  const wf = S.stripComments(S.fnSrc('wfCall'));
  assert.ok(wf.indexOf('return onDeadCredential(r, action, params);') >= 0,
    'wfCall 的解析出口沒接 onDeadCredential ⇒ 死憑證又回到那句死路紅字');
});
