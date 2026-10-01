/**
 * #126：`stats.html` 資深夥伴範本——新增／刪除後畫面不再被快取舊清單蓋掉；確認框名稱與送出的編號同源。
 *
 * 🔴 **由來**（jdc-tw-migration#123 H1，2026-10-01）：`snLoad` 先畫快取舊清單 ⇒ 下拉被重設回第 0 則、
 *    `sn-msg` 被清掉 ⇒ 新增後沒有「已新增」、不跳到新則；刪除後沒有「已刪除。」；
 *    **確認框顯示的名稱可以與後端實際刪掉的那一則不同**。YU 因此新增 3 次、刪除 3 次。
 *
 * ⚠️ 這一檔**真的把頁面跑起來**（`helpers/page-stub.js`）：快取一律回「改動前的舊清單」，
 *    後端回最新清單——兩者刻意不同，否則「先畫快取」與「等最新清單」量起來一樣，這一輪什麼都沒測到。
 *
 * 檢核代號對照票上：
 *   K5 新增後下拉選到新則、顯示「已新增」；刪除後顯示「已刪除。」；快取舊清單不會把選取重設
 *   K6 確認框名稱＝送出的編號對應的標題（替身讓快取與最新清單不同時亦然）
 *   相容：舊版後端（回應沒有 ids、新增只回則次）這一頁照樣能用——gas 還沒部署時 liff 先上線不壞
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { runPage, settle, waitFor, execOnly, fakeEl } = require('./helpers/page-stub.js');

const FILE = 'stats.html';
async function drain() { for (let i = 0; i < 15; i++) await settle(); }
const qs = (u) => new URL(u).searchParams;

/** 一份 getSeniorNotice 回應。`ids` 給 null ＝ 舊版後端（沒有那一格）。 */
function notice(titles, ids) {
  const r = { ok: true, year: 2026, years: [2027, 2026], titles: titles.slice(),
    templates: titles.map((t) => t + '的內文'), audience: [], status: titles.map(() => 'unsent') };
  if (ids) r.ids = ids.slice();
  return r;
}

/**
 * 起一頁 stats，換上：依 id 記住的假 DOM、可排程的 fetch、**永遠回舊清單的快取**、不吃第二發。
 * 寫入動作的回應由 `plan[action]` 排；getSeniorNotice 的回應由 `latest()` 決定（呼叫當下的最新清單）。
 */
function boot({ stale, latest }) {
  const r = runPage({ file: FILE, search: '?t=STUBTOKEN&act=A1' });
  const { ctx, urls } = r;
  const plan = {};
  const confirms = [];
  ctx.fetch = (u) => {
    urls.push(String(u));
    const a = qs(String(u)).get('action');
    let body;
    if (a === 'getSeniorNotice') body = latest();
    else body = (plan[a] && plan[a].length) ? plan[a].shift() : { ok: false, msg: '測試替身' };
    return Promise.resolve({ text: () => Promise.resolve('cb(' + JSON.stringify(body) + ')') });
  };
  const els = {};
  ctx.document.getElementById = (id) => (els[id] = els[id] || fakeEl());
  const origSet = ctx.setTimeout;
  ctx.setTimeout = (fn, ms) => origSet(fn, (ms === 2000 || ms === 1500) ? 1 : ms);
  ctx.confirm = (t) => { confirms.push(String(t)); return true; };
  ctx.prompt = () => '測試-刪除用';
  return Object.assign(r, { plan, els, confirms, stale });
}
/** 頁面跑起來之後才換快取替身（換早了會被頁面自己的宣告蓋回去）。 */
function stubCache(h) {
  h.ctx.CACHE_READY = Promise.resolve();
  h.ctx.cacheGet = () => ({ value: h.stale, savedAt: 1 });
  h.ctx.cacheSave = () => Promise.resolve();
  h.ctx.pick2 = () => Promise.resolve(null);
  h.ctx.queueRead = (fn) => fn();
}
const sel = (h) => String(h.els['sn-idx'].value);
const msg = (h) => String(h.els['sn-msg'].textContent);
const sentOf = (h, action, from) => execOnly(h.urls).slice(from).filter((u) => qs(u).get('action') === action);

const STALE = notice(['表揚', '問卷', '截止'], ['legacy-0', 'legacy-1', 'legacy-2']);

/* ══ K5 新增 ═══════════════════════════════════════════════════════════ */

test('K5 新增後：下拉選到新則、顯示「已新增」（快取是舊清單也一樣）', async () => {
  let now = STALE;
  const h = boot({ stale: STALE, latest: () => now });
  try {
    await drain(); stubCache(h);
    h.ctx.renderSenior(STALE);                       // 畫面上是舊清單
    h.plan.addSeniorTemplate = [{ ok: true, id: 'uuid-new', idx: 3 }];
    now = notice(['表揚', '問卷', '截止', '測試-刪除用'], ['legacy-0', 'legacy-1', 'legacy-2', 'uuid-new']);
    h.ctx.snAddTpl();
    assert.ok(await waitFor(() => /已新增/.test(msg(h))), '沒有出現「已新增」（實際：' + msg(h) + '）');
    await drain();
    assert.strictEqual(sel(h), 'uuid-new', '下拉沒有選到新那一則');
    assert.match(msg(h), /已新增/, '「已新增」被之後的重繪清掉了');
  } finally { h.cleanup(); }
});

test('K5 刪除後：顯示「已刪除。」、清單是最新的（快取是舊清單也一樣）', async () => {
  let now = STALE;
  const h = boot({ stale: STALE, latest: () => now });
  try {
    await drain(); stubCache(h);
    h.ctx.renderSenior(STALE);
    h.els['sn-idx'].value = 'legacy-1';
    h.plan.removeSeniorTemplate = [{ ok: true }];
    now = notice(['表揚', '截止'], ['legacy-0', 'legacy-2']);
    h.ctx.snDelTpl();
    assert.ok(await waitFor(() => msg(h) === '已刪除。'), '沒有出現「已刪除。」（實際：' + msg(h) + '）');
    await drain();
    assert.strictEqual(msg(h), '已刪除。', '「已刪除。」被之後的重繪清掉了');
    assert.deepStrictEqual(Array.from(h.ctx.SN.ids), ['legacy-0', 'legacy-2'], '畫面上的清單不是最新的');
  } finally { h.cleanup(); }
});

test('K5 快取舊清單不會把選取重設：兩段繪製之間選取以編號保住', async () => {
  const h = boot({ stale: STALE, latest: () => STALE });
  try {
    await drain();
    h.ctx.renderSenior(STALE);                       // 第一段：快取
    h.els['sn-idx'].value = 'legacy-2';              // 使用者選了「截止」
    // 第二段：最新清單順序不同（有人在表上調了排序、或中間那則被刪了）
    h.ctx.renderSenior(notice(['新的', '截止', '表揚'], ['uuid-x', 'legacy-2', 'legacy-0']));
    assert.strictEqual(sel(h), 'legacy-2', '重繪把選取換成別則了');
    assert.strictEqual(h.ctx.snCur().title, '截止');
  } finally { h.cleanup(); }
});

/* ══ K6 確認框名稱＝送出的編號對應的標題 ════════════════════════════════ */

test('K6 新增後立刻刪除：確認框是新那一則的名稱，送出的編號與標題也是它（H1 的情境）', async () => {
  let now = STALE;
  const h = boot({ stale: STALE, latest: () => now });
  try {
    await drain(); stubCache(h);
    h.ctx.renderSenior(STALE);
    h.plan.addSeniorTemplate = [{ ok: true, id: 'uuid-new', idx: 3 }];
    now = notice(['表揚', '問卷', '截止', '測試-刪除用'], ['legacy-0', 'legacy-1', 'legacy-2', 'uuid-new']);
    h.ctx.snAddTpl();
    await waitFor(() => /已新增/.test(msg(h)));
    await drain();
    h.plan.removeSeniorTemplate = [{ ok: true }];
    const from = execOnly(h.urls).length;
    h.ctx.snDelTpl();
    await waitFor(() => sentOf(h, 'removeSeniorTemplate', from).length >= 1);
    const sent = sentOf(h, 'removeSeniorTemplate', from);
    assert.strictEqual(sent.length, 1);
    const p = qs(sent[0]);
    assert.strictEqual(h.confirms[h.confirms.length - 1], '刪除「測試-刪除用」？',
      '確認框的名稱不是剛新增的那一則');
    assert.strictEqual(p.get('id'), 'uuid-new', '送出的編號不是剛新增的那一則');
    assert.strictEqual(p.get('title'), '測試-刪除用', '送出的標題與確認框不同');
  } finally { h.cleanup(); }
});

test('K6 快取與最新清單不同時：確認框名稱＝送出編號在最新清單裡的標題', async () => {
  const LATEST = notice(['新的', '截止', '表揚'], ['uuid-x', 'legacy-2', 'legacy-0']);
  const h = boot({ stale: STALE, latest: () => LATEST });
  try {
    await drain();
    h.ctx.renderSenior(STALE);
    h.els['sn-idx'].value = 'legacy-2';
    h.ctx.renderSenior(LATEST);
    h.plan.removeSeniorTemplate = [{ ok: true }];
    const from = execOnly(h.urls).length;
    h.ctx.snDelTpl();
    await waitFor(() => sentOf(h, 'removeSeniorTemplate', from).length >= 1);
    const p = qs(sentOf(h, 'removeSeniorTemplate', from)[0]);
    const k = LATEST.ids.indexOf(p.get('id'));
    assert.ok(k >= 0, '送出的編號不在最新清單裡：' + p.get('id'));
    assert.strictEqual(h.confirms[h.confirms.length - 1], '刪除「' + LATEST.titles[k] + '」？');
    assert.strictEqual(p.get('title'), LATEST.titles[k]);
    assert.strictEqual(p.get('id'), 'legacy-2', '使用者選的是「截止」');
  } finally { h.cleanup(); }
});

test('K6 發送：確認框的名稱＝送出的編號對應的標題', async () => {
  const LATEST = notice(['新的', '截止', '表揚'], ['uuid-x', 'legacy-2', 'legacy-0']);
  const h = boot({ stale: STALE, latest: () => LATEST });
  try {
    await drain();
    h.ctx.renderSenior(STALE);
    h.els['sn-idx'].value = 'legacy-0';
    h.ctx.renderSenior(LATEST);
    h.ctx.document.querySelectorAll = (s) => (s === '.sn-ck:checked' ? [{ dataset: { uid: 'U1' }, checked: true }] : []);
    h.plan.sendSeniorNotice = [{ ok: true, sent: 1, failed: 0, failures: [] }];
    const from = execOnly(h.urls).length;
    h.ctx.snSend();
    await waitFor(() => sentOf(h, 'sendSeniorNotice', from).length >= 1);
    const p = qs(sentOf(h, 'sendSeniorNotice', from)[0]);
    assert.strictEqual(p.get('id'), 'legacy-0');
    assert.strictEqual(p.get('idx'), '2', '則次與編號不是同一則');
    assert.match(h.confirms[h.confirms.length - 1], /^把「表揚」發給/);
  } finally { h.cleanup(); }
});

test('刪除失敗 ⇒ 不重載、顯示後端的訊息（「範本已變動，請重新整理。」）', async () => {
  const h = boot({ stale: STALE, latest: () => STALE });
  try {
    await drain(); stubCache(h);
    h.ctx.renderSenior(STALE);
    h.els['sn-idx'].value = 'legacy-1';
    h.plan.removeSeniorTemplate = [{ ok: false, msg: '範本已變動，請重新整理。' }];
    h.ctx.snDelTpl();
    assert.ok(await waitFor(() => msg(h) === '範本已變動，請重新整理。'), '實際：' + msg(h));
  } finally { h.cleanup(); }
});

test('🔴 改動後讀不到最新清單 ⇒ 清掉 SN（不可以再拿改動前的清單刪或發）、講明要重新整理', async () => {
  let now = STALE;
  const h = boot({ stale: STALE, latest: () => now });
  try {
    await drain(); stubCache(h);
    h.ctx.renderSenior(STALE);
    h.els['sn-idx'].value = 'legacy-1';
    h.plan.removeSeniorTemplate = [{ ok: true }];
    now = { ok: false, msg: 'hub 掛了' };
    h.ctx.snDelTpl();
    assert.ok(await waitFor(() => /重新整理/.test(msg(h))), '實際：' + msg(h));
    assert.match(msg(h), /^已刪除。/, '刪除其實成功了，要講');
    assert.strictEqual(h.ctx.SN, null);
  } finally { h.cleanup(); }
});

/* ══ 相容：舊版後端（gas 還沒部署）════════════════════════════════════ */

test('相容：舊版後端（沒有 ids、新增只回則次）⇒ 新增後選到新則、刪除送則次', async () => {
  const OLD = notice(['表揚', '問卷', '截止'], null);
  let now = OLD;
  const h = boot({ stale: OLD, latest: () => now });
  try {
    await drain(); stubCache(h);
    h.ctx.renderSenior(OLD);
    assert.strictEqual(sel(h), '0');
    h.plan.addSeniorTemplate = [{ ok: true, idx: 3 }];
    now = notice(['表揚', '問卷', '截止', '測試-刪除用'], null);
    h.ctx.snAddTpl();
    assert.ok(await waitFor(() => /已新增/.test(msg(h))));
    await drain();
    assert.strictEqual(sel(h), '3');
    h.plan.removeSeniorTemplate = [{ ok: true }];
    const from = execOnly(h.urls).length;
    h.ctx.snDelTpl();
    await waitFor(() => sentOf(h, 'removeSeniorTemplate', from).length >= 1);
    const p = qs(sentOf(h, 'removeSeniorTemplate', from)[0]);
    assert.strictEqual(p.get('idx'), '3');
    assert.strictEqual(p.get('title'), '測試-刪除用');
    assert.strictEqual(h.confirms[h.confirms.length - 1], '刪除「測試-刪除用」？');
  } finally { h.cleanup(); }
});
