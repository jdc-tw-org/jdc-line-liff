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
function boot({ stale, latest, html }) {
  const r = runPage({ file: FILE, search: '?t=STUBTOKEN&act=A1', html: html == null ? null : html });
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

test('K6 走真 snLoad 兩段繪製（快取與最新順序不同）：刪除確認框名稱＝送出編號在最新清單的標題', async () => {
  // 🔴 驗證軌 #126 L5 補的（2026-10-01）：上面幾條不是沒換快取替身、就是快取那個位置剛好是空的，
  //    「確認框名稱改從快取取」會退回正確的標題而活下來。這一條讓快取那一份在**同一個位置**有**別的**標題。
  const LATEST = notice(['新的', '截止', '表揚'], ['uuid-x', 'legacy-2', 'legacy-0']);
  const h = boot({ stale: STALE, latest: () => LATEST });
  try {
    await drain(); stubCache(h);
    let cacheReads = 0;
    h.ctx.cacheGet = () => { cacheReads++; return { value: STALE, savedAt: 1 }; };
    h.ctx.snLoad();
    assert.ok(await waitFor(() => h.ctx.SN && h.ctx.SN.ids && h.ctx.SN.ids[0] === 'uuid-x'), '最新清單沒有畫上去');
    await drain();
    assert.ok(cacheReads >= 1, '⬛ 前提不成立：快取那一段沒有被讀到 ⇒ 這一條量不到「從快取取」');
    h.els['sn-idx'].value = 'legacy-2';              // 使用者在最新清單上選「截止」（最新第 1 位；快取第 1 位是「問卷」）
    h.plan.removeSeniorTemplate = [{ ok: true }];
    const from = execOnly(h.urls).length;
    h.ctx.snDelTpl();
    await waitFor(() => sentOf(h, 'removeSeniorTemplate', from).length >= 1);
    const sent = sentOf(h, 'removeSeniorTemplate', from);
    assert.strictEqual(sent.length, 1);
    const p = qs(sent[0]);
    const k = LATEST.ids.indexOf(p.get('id'));
    assert.strictEqual(p.get('id'), 'legacy-2');
    assert.strictEqual(p.get('idx'), '1');
    assert.strictEqual(p.get('title'), '截止');
    assert.strictEqual(h.confirms[h.confirms.length - 1], '刪除「' + LATEST.titles[k] + '」？',
      '確認框名稱不是送出編號在最新清單裡的標題（H1 的形狀）');
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

/* ══ #127 已停用清單＋恢復 ══════════════════════════════════════════════
 *
 * jdc-tw-migration#127（2026-10-01）：#126 起刪除＝停用，但恢復只能到試算表改狀態欄。
 * 這一段釘「已停用的訊息」清單、「恢復」鈕與確認框文案。
 *   #127 K5 已停用清單正確、恢復後畫面選到該則並顯示「已恢復。」；確認框文案含「可恢復」
 *   相容：舊版後端（回應沒有 `disabled`）⇒ 整塊收起來、確認框不講做不到的事、恢復鈕不送任何請求
 * ═════════════════════════════════════════════════════════════════════ */

/** notice() 再加一格 disabled（新版後端）。 */
function noticeD(titles, ids, disabled) {
  return Object.assign(notice(titles, ids), { disabled: disabled.map((x) => Object.assign({}, x)) });
}
const D_OLD = { id: 'uuid-d', title: '舊的', disabledAt: '2026-10-01T04:38:18.000Z' };
const D_TWO = { id: 'uuid-e', title: '另一則', disabledAt: '2026-09-30T23:05:00.000Z' };
const click = (h, k) => h.ctx.snDisClick({ target: { getAttribute: (n) => (n === 'data-k' ? String(k) : null) } });
const disHtml = (h) => String(h.els['sn-dis-list'].innerHTML);

test('#127 K5 已停用清單：列出標題、停用時間（台北時間）與「恢復」鈕，區塊顯示', async () => {
  const h = boot({ stale: STALE, latest: () => STALE });
  try {
    await drain();
    h.ctx.renderSenior(noticeD(['表揚', '截止'], ['legacy-0', 'legacy-2'], [D_OLD, D_TWO]));
    assert.strictEqual(h.els['sn-dis-box'].hidden, false, '新版後端有回清單，區塊卻收著');
    const html = disHtml(h);
    assert.match(html, /舊的/); assert.match(html, /另一則/);
    assert.match(html, /10\/1 12:38/, '停用時間沒換成台北時間');
    assert.match(html, /10\/1 07:05/, '跨日的那一則沒換成台北的日期');
    assert.strictEqual((html.match(/>恢復</g) || []).length, 2, '每一則要一顆恢復鈕');
    assert.ok(html.indexOf('data-k="0"') >= 0 && html.indexOf('data-k="1"') >= 0);
  } finally { h.cleanup(); }
});

test('#127 K5 已停用清單是空的 ⇒ 仍顯示區塊與「目前沒有」（她要知道刪掉的救得回來）', async () => {
  const h = boot({ stale: STALE, latest: () => STALE });
  try {
    await drain();
    h.ctx.renderSenior(noticeD(['表揚'], ['legacy-0'], []));
    assert.strictEqual(h.els['sn-dis-box'].hidden, false);
    assert.match(disHtml(h), /目前沒有停用的訊息/);
  } finally { h.cleanup(); }
});

test('#127 K5 恢復：送編號＋標題，等最新清單回來才畫、選到恢復的那則、顯示「已恢復。」', async () => {
  const BEFORE = noticeD(['表揚', '截止'], ['legacy-0', 'legacy-2'], [D_OLD]);
  let now = BEFORE;
  // 快取一律是恢復前的舊清單（刻意與最新不同：先畫快取的話選取會落到別則、訊息會被清掉）
  const h = boot({ stale: BEFORE, latest: () => now });
  try {
    await drain(); stubCache(h);
    h.ctx.renderSenior(BEFORE);
    assert.strictEqual(sel(h), 'legacy-0', '前提：選取在第一則');
    h.plan.restoreSeniorTemplate = [{ ok: true, id: 'uuid-d', idx: 1 }];
    now = noticeD(['表揚', '舊的', '截止'], ['legacy-0', 'uuid-d', 'legacy-2'], []);
    const from = execOnly(h.urls).length;
    click(h, 0);
    assert.ok(await waitFor(() => msg(h) === '已恢復。'), '沒有出現「已恢復。」（實際：' + msg(h) + '）');
    const sent = sentOf(h, 'restoreSeniorTemplate', from);
    assert.strictEqual(sent.length, 1);
    assert.strictEqual(qs(sent[0]).get('id'), 'uuid-d');
    assert.strictEqual(qs(sent[0]).get('title'), '舊的', '沒帶標題 ⇒ 後端核對不了');
    assert.ok(qs(sent[0]).get('nonce'), '沒帶 nonce');
    await drain();
    assert.strictEqual(sel(h), 'uuid-d', '下拉沒有選到恢復的那一則');
    assert.strictEqual(msg(h), '已恢復。', '「已恢復。」被之後的重繪清掉了');
    assert.deepStrictEqual(Array.from(h.ctx.SN.ids), ['legacy-0', 'uuid-d', 'legacy-2'], '畫面上的清單不是最新的');
    assert.match(disHtml(h), /目前沒有停用的訊息/, '恢復的那則還留在已停用清單');
  } finally { h.cleanup(); }
});

test('#127 K5 恢復鈕取的是畫面上那份清單：快取與最新的已停用清單順序不同時，送出的是最新那份的第 k 則', async () => {
  const CACHED = noticeD(['表揚'], ['legacy-0'], [D_OLD, D_TWO]);
  const LATEST = noticeD(['表揚'], ['legacy-0'], [D_TWO, D_OLD]);
  const h = boot({ stale: CACHED, latest: () => LATEST });
  try {
    await drain(); stubCache(h);
    h.ctx.snLoad();
    assert.ok(await waitFor(() => h.ctx.SN && h.ctx.SN.disabled && h.ctx.SN.disabled[0].id === 'uuid-e'), '最新清單沒有畫上去');
    await drain();
    h.plan.restoreSeniorTemplate = [{ ok: true, id: 'uuid-e', idx: 1 }];
    const from = execOnly(h.urls).length;
    click(h, 0);                                       // 畫面上第 0 則＝最新清單的「另一則」
    await waitFor(() => sentOf(h, 'restoreSeniorTemplate', from).length >= 1);
    const p = qs(sentOf(h, 'restoreSeniorTemplate', from)[0]);
    assert.strictEqual(p.get('id'), 'uuid-e');
    assert.strictEqual(p.get('title'), '另一則', '編號與標題不是畫面上同一則');
  } finally { h.cleanup(); }
});

test('#127 恢復失敗（如已達上限）⇒ 顯示後端的訊息、不重載', async () => {
  const BEFORE = noticeD(['表揚'], ['legacy-0'], [D_OLD]);
  const h = boot({ stale: BEFORE, latest: () => BEFORE });
  try {
    await drain(); stubCache(h);
    h.ctx.renderSenior(BEFORE);
    h.plan.restoreSeniorTemplate = [{ ok: false, msg: '啟用中已經 12 則（上限），請先刪除一則不用的再恢復。' }];
    const from = execOnly(h.urls).length;
    click(h, 0);
    assert.ok(await waitFor(() => /上限/.test(msg(h))), '實際：' + msg(h));
    await drain();
    assert.strictEqual(sentOf(h, 'getSeniorNotice', from).length, 0, '失敗了還重載');
  } finally { h.cleanup(); }
});

test('#127 K5 刪除確認框：新版後端（有已停用清單）⇒ 文案含「可恢復」', async () => {
  const LATEST = noticeD(['表揚', '截止'], ['legacy-0', 'legacy-2'], []);
  const h = boot({ stale: LATEST, latest: () => LATEST });
  try {
    await drain(); stubCache(h);
    h.ctx.renderSenior(LATEST);
    h.els['sn-idx'].value = 'legacy-2';
    h.plan.removeSeniorTemplate = [{ ok: true }];
    h.ctx.snDelTpl();
    await waitFor(() => h.confirms.length >= 1);
    const c = h.confirms[h.confirms.length - 1];
    assert.ok(c.startsWith('刪除「截止」？'), '確認框名稱不對：' + c);
    assert.match(c, /可恢復/, '確認框沒講可以恢復 ⇒ 她以為刪了就沒了');
    assert.match(c, /已停用的訊息/, '沒講去哪裡找');
  } finally { h.cleanup(); }
});

test('#127 相容：舊版後端（沒有 disabled）⇒ 區塊收起、確認框不講「可恢復」、恢復鈕不送任何請求', async () => {
  const OLD = notice(['表揚', '截止'], ['legacy-0', 'legacy-2']);
  const h = boot({ stale: OLD, latest: () => OLD });
  try {
    await drain(); stubCache(h);
    h.ctx.renderSenior(OLD);
    assert.strictEqual(h.els['sn-dis-box'].hidden, true, '舊版後端沒有清單，卻顯示了（會顯示一句不實的「目前沒有」）');
    const from = execOnly(h.urls).length;
    click(h, 0);
    await drain();
    assert.strictEqual(sentOf(h, 'restoreSeniorTemplate', from).length, 0);
    h.plan.removeSeniorTemplate = [{ ok: true }];
    h.ctx.snDelTpl();
    await waitFor(() => h.confirms.length >= 1);
    assert.strictEqual(h.confirms[h.confirms.length - 1], '刪除「表揚」？', '舊版後端沒有恢復入口，確認框卻說可恢復');
  } finally { h.cleanup(); }
});

/* ══ #128 處理中…＋鎖按鈕 ═══════════════════════════════════════════════
 *
 * jdc-tw-migration#128（2026-10-01）：#126 起改動後等最新清單回來才重畫（刻意的），等待期間數秒、
 * 遇 404 重試更久，畫面沒有回饋、按鈕仍可按 ⇒ 以為沒反應而重按（#123 H1 實測重按 3 次）。
 *   #128 K1 後端延遲回應：按下後「處理中…」立即出現、相關按鈕 disabled；回應前再按不會送出第二發（請求計數＝1）
 *   #128 K2 成功與失敗（伺服器拒絕、逾時）三種結局都解鎖，且不殘留「處理中…」
 * ⚠️ 替身讓**寫入**與**之後的重載**都可以分別卡住：鎖要撐到「最新清單重畫完成」，不是寫入回來就放。
 * ═════════════════════════════════════════════════════════════════════ */

const LOCK_IDS = ['sn-add', 'sn-del', 'sn-save', 'sn-send', 'sn-idx', 'sn-year'];
const lockedAll = (h) => LOCK_IDS.every((id) => h.els[id] && h.els[id].disabled === true);
const lockedNone = (h) => LOCK_IDS.every((id) => !(h.els[id] && h.els[id].disabled));

/** 在 boot 的 fetch 外面再包一層：被 hold 的 action 卡住，直到 release／fail；所有 action 都計數。 */
function gated(h) {
  const inner = h.ctx.fetch;
  const held = new Set(), waiting = {}, counts = {}, rejecting = new Set();
  h.ctx.fetch = (u) => {
    const a = qs(String(u)).get('action');
    counts[a] = (counts[a] || 0) + 1;
    if (rejecting.has(a)) { h.urls.push(String(u)); return Promise.reject(new Error('net')); }
    if (!held.has(a)) return inner(u);
    h.urls.push(String(u));
    return new Promise((res) => { (waiting[a] = waiting[a] || []).push(res); });
  };
  const body = (b) => ({ text: () => Promise.resolve('cb(' + JSON.stringify(b) + ')') });
  return {
    counts, hold: (a) => held.add(a), reject: (a) => rejecting.add(a),
    pending: (a) => (waiting[a] || []).length,
    release: (a, b) => { held.delete(a); (waiting[a] || []).splice(0).forEach((res) => res(body(b))); },
  };
}

/** 四個入口各自怎麼按、後端成功時回什麼、之後的最新清單長怎樣。 */
const OPS = {
  add: { action: 'addSeniorTemplate', press: (h) => h.ctx.snAddTpl(), ok: { ok: true, id: 'uuid-new', idx: 3 },
    after: noticeD(['表揚', '問卷', '截止', '測試-刪除用'], ['legacy-0', 'legacy-1', 'legacy-2', 'uuid-new'], [D_OLD]), okMsg: /已新增/ },
  del: { action: 'removeSeniorTemplate', press: (h) => h.ctx.snDelTpl(), ok: { ok: true },
    after: noticeD(['問卷', '截止'], ['legacy-1', 'legacy-2'], [D_OLD]), okMsg: /^已刪除。$/ },
  save: { action: 'saveSeniorTemplate', press: (h) => h.ctx.snSaveTpl(), ok: { ok: true, id: 'legacy-0' },
    after: noticeD(['表揚', '問卷', '截止'], ['legacy-0', 'legacy-1', 'legacy-2'], [D_OLD]), okMsg: /^已儲存。$/ },
  restore: { action: 'restoreSeniorTemplate', press: (h) => click(h, 0), ok: { ok: true, id: 'uuid-d', idx: 1 },
    after: noticeD(['表揚', '舊的', '問卷', '截止'], ['legacy-0', 'uuid-d', 'legacy-1', 'legacy-2'], []), okMsg: /^已恢復。$/ },
};
const BEFORE_D = noticeD(['表揚', '問卷', '截止'], ['legacy-0', 'legacy-1', 'legacy-2'], [D_OLD]);

async function bootBusy() {
  let now = BEFORE_D;
  const h = boot({ stale: BEFORE_D, latest: () => now });
  await drain(); stubCache(h);
  h.ctx.renderSenior(BEFORE_D);
  const g = gated(h);
  return { h, g, setLatest: (x) => { now = x; } };
}

Object.keys(OPS).forEach((name) => {
  const op = OPS[name];
  test('#128 K1 ' + name + '：後端延遲 ⇒「處理中…」立即出現、相關按鈕全鎖；回應前再按任何入口都不送第二發', async () => {
    const { h, g, setLatest } = await bootBusy();
    try {
      g.hold(op.action);
      op.press(h);
      await drain();
      assert.strictEqual(g.pending(op.action), 1, '前提：寫入已送出、卡在後端');
      assert.strictEqual(msg(h), '處理中…', '按下後沒有「處理中…」（實際：' + msg(h) + '）');
      assert.ok(lockedAll(h), '有按鈕或下拉沒鎖：' + LOCK_IDS.filter((id) => !(h.els[id] && h.els[id].disabled)).join(','));
      // 重畫已停用清單時，恢復鈕也要是鎖住的
      h.ctx.snRenderDisabled(BEFORE_D);
      assert.match(disHtml(h), /data-k="0" disabled>恢復/, '處理中重畫出來的恢復鈕沒有鎖');
      // 回應前再按：同一顆、以及其他每一個入口
      op.press(h);
      Object.keys(OPS).forEach((k) => OPS[k].press(h));
      await drain();
      Object.keys(OPS).forEach((k) => {
        const a = OPS[k].action;
        assert.strictEqual(g.counts[a] || 0, a === op.action ? 1 : 0, a + ' 送了 ' + (g.counts[a] || 0) + ' 發（處理中應該只有第一發）');
      });
      // 寫入回來了，但最新清單還沒回來 ⇒ 仍然鎖著（鎖要撐到重畫完成）
      g.hold('getSeniorNotice');
      setLatest(op.after);
      g.release(op.action, op.ok);
      await drain();
      assert.ok(g.pending('getSeniorNotice') >= 1, '前提：重載已送出、卡在後端');
      assert.ok(lockedAll(h), '寫入一回來就解鎖了，最新清單還沒畫上去');
      g.release('getSeniorNotice', op.after);
      assert.ok(await waitFor(() => op.okMsg.test(msg(h))), '沒有出現成功訊息（實際：' + msg(h) + '）');
      await drain();
      assert.ok(lockedNone(h), '成功後沒有解鎖：' + LOCK_IDS.filter((id) => h.els[id].disabled).join(','));
      assert.match(msg(h), op.okMsg, '成功訊息被清掉或殘留「處理中…」');
      assert.strictEqual(g.counts[op.action], 1);
    } finally { h.cleanup(); }
  });
});

test('#128 K2 伺服器拒絕 ⇒ 解鎖、顯示後端訊息、不殘留「處理中…」、不重載', async () => {
  const { h, g } = await bootBusy();
  try {
    g.hold('removeSeniorTemplate');
    h.ctx.snDelTpl();
    await drain();
    assert.ok(lockedAll(h), '前提：處理中是鎖著的');
    g.release('removeSeniorTemplate', { ok: false, msg: '範本已變動，請重新整理。' });
    assert.ok(await waitFor(() => msg(h) === '範本已變動，請重新整理。'), '實際：' + msg(h));
    await drain();
    assert.ok(lockedNone(h), '被拒絕後沒有解鎖');
    assert.strictEqual(g.counts.getSeniorNotice || 0, 0, '被拒絕還重載');
  } finally { h.cleanup(); }
});

test('#128 K2 逾時／斷線（傳輸失敗）⇒ 解鎖、顯示連線錯誤、不殘留「處理中…」', async () => {
  const { h, g } = await bootBusy();
  try {
    g.reject('saveSeniorTemplate');
    h.ctx.snSaveTpl();
    assert.ok(await waitFor(() => /連線/.test(msg(h))), '實際：' + msg(h));
    await drain();
    assert.ok(lockedNone(h), '傳輸失敗後沒有解鎖');
    assert.notStrictEqual(msg(h), '處理中…');
  } finally { h.cleanup(); }
});

test('#128 K2 寫入成功但最新清單讀不到 ⇒ 解鎖、講明要重新整理、不殘留「處理中…」', async () => {
  const { h, g, setLatest } = await bootBusy();
  try {
    setLatest({ ok: false, msg: 'hub 掛了' });
    h.plan.restoreSeniorTemplate = [{ ok: true, id: 'uuid-d', idx: 1 }];
    click(h, 0);
    assert.ok(await waitFor(() => /重新整理/.test(msg(h))), '實際：' + msg(h));
    await drain();
    assert.ok(lockedNone(h), '重載失敗後沒有解鎖');
    assert.match(msg(h), /^已恢復。但/, '恢復其實成功了，要講');
  } finally { h.cleanup(); }
});

test('#128 K2 處理途中拋例外 ⇒ 仍然解鎖、不殘留「處理中…」', async () => {
  const { h } = await bootBusy();
  try {
    h.plan.addSeniorTemplate = [{ ok: true, id: 'uuid-new', idx: 3 }];
    h.ctx.snReload = () => { throw new Error('boom'); };
    h.ctx.snAddTpl();
    assert.ok(await waitFor(() => lockedNone(h) && msg(h) !== '處理中…'), '例外之後鎖住或殘留（實際：' + msg(h) + '）');
    assert.match(msg(h), /重新整理/);
  } finally { h.cleanup(); }
});

test('#128 取消（prompt 按取消／confirm 按否）⇒ 不上鎖、不顯示「處理中…」', async () => {
  const { h } = await bootBusy();
  try {
    h.ctx.prompt = () => null;
    h.ctx.snAddTpl();
    h.ctx.confirm = () => false;
    h.ctx.snDelTpl();
    await drain();
    assert.ok(lockedNone(h));
    assert.notStrictEqual(msg(h), '處理中…');
    assert.strictEqual(h.ctx.SN_BUSY, false);
  } finally { h.cleanup(); }
});

/* ══ #129 寫入回應附清單 ⇒ 不再打 getSeniorNotice ═══════════════════════
 *
 * jdc-tw-migration#129（2026-10-01）：每次新增／刪除／儲存／恢復都是兩發串接的 GAS 呼叫，第二發
 * `getSeniorNotice` 要讀名冊、使用者清單、巢狀打 hub，只為了拿最新範本清單。gas 起四支寫入的成功回應附
 * `list`（`{ids,titles,templates,disabled}`，與 getSeniorNotice 同名同形），前端只重畫範本下拉與停用清單。
 *   #129 K1 四個動作各只發 1 次後端呼叫，getSeniorNotice 計數＝0
 *   #129 K2 下拉選到該則、成功訊息照舊、清單＝回應清單；名冊與勾選不重畫；發送狀態依編號沿用
 *   #129 K3 舊版後端（回應沒有清單）⇒ 退回 snReload，行為同現行
 *   （#128 的鎖與「處理中…」在新路徑上不退化；狀態對不到時寧可退回重讀，不可顯示成「未發送」）
 * ⚠️ 替身裡 getSeniorNotice 的「最新清單」刻意與回應清單**不同**——兩條路畫出來一樣的話，這一段什麼都沒測到。
 * ═════════════════════════════════════════════════════════════════════ */

const listOf = (n) => ({ ids: n.ids.slice(), titles: n.titles.slice(), templates: n.templates.slice(),
  disabled: (n.disabled || []).map((x) => Object.assign({}, x)) });
/** 畫面原本那份：第 2 則（問卷）發過、第 3 則（截止）狀態不明；停用清單有「舊的」。名冊有一個人。 */
function before129() {
  const r = noticeD(['表揚', '問卷', '截止'], ['legacy-0', 'legacy-1', 'legacy-2'], [D_OLD]);
  r.status = ['unsent', 'sent', 'unknown'];
  r.audience = [{ status: 'ok', userId: 'U1', name: '己', unit: '工務', years: 5 }];
  return r;
}
/** 四個動作成功後的回應（附清單）與對應的期望。`after` 是寫入後的範本清單。 */
const OPS129 = {
  add: { action: 'addSeniorTemplate', press: (h) => h.ctx.snAddTpl(),
    after: noticeD(['表揚', '問卷', '截止', '測試-刪除用'], ['legacy-0', 'legacy-1', 'legacy-2', 'uuid-new'], [D_OLD]),
    res: { ok: true, id: 'uuid-new', idx: 3 }, sel: 'uuid-new', okMsg: /^已新增，內容還是空的。$/,
    status: ['unsent', 'sent', 'unknown', 'unsent'] },
  del: { action: 'removeSeniorTemplate', press: (h) => { h.els['sn-idx'].value = 'legacy-1'; h.ctx.snDelTpl(); },
    after: noticeD(['表揚', '截止'], ['legacy-0', 'legacy-2'], [D_OLD, { id: 'legacy-1', title: '問卷', disabledAt: '2026-10-01T05:00:00.000Z' }]),
    res: { ok: true }, sel: 'legacy-0', okMsg: /^已刪除。$/, status: ['unsent', 'unknown'] },
  save: { action: 'saveSeniorTemplate', press: (h) => { h.els['sn-idx'].value = 'legacy-2'; h.els['sn-tpl'].value = '改過'; h.ctx.snSaveTpl(); },
    after: (() => { const n = noticeD(['表揚', '問卷', '截止'], ['legacy-0', 'legacy-1', 'legacy-2'], [D_OLD]); n.templates[2] = '改過'; return n; })(),
    res: { ok: true, id: 'legacy-2' }, sel: 'legacy-2', okMsg: /^已儲存。$/, status: ['unsent', 'sent', 'unknown'] },
};

async function boot129(html) {
  // getSeniorNotice 若被打到，回的是一份**與回應清單不同**的清單（多一則「重讀才有」）
  const RELOAD = noticeD(['重讀才有'], ['uuid-reload'], []);
  const h = boot({ stale: before129(), latest: () => RELOAD, html });
  await drain(); stubCache(h);
  const saved = [];
  h.ctx.cacheSave = (_t, name, obj) => { saved.push({ name, obj: JSON.parse(JSON.stringify(obj)) }); return Promise.resolve(); };
  h.ctx.renderSenior(before129());
  h.els['sn-people'].innerHTML = 'PEOPLE-MARK';   // 名冊被重畫就會被換掉
  const g = gated(h);
  return { h, g, saved };
}
const reloads = (g) => g.counts.getSeniorNotice || 0;

Object.keys(OPS129).forEach((name) => {
  const op = OPS129[name];
  test('#129 K1＋K2 ' + name + '：只發 1 次（getSeniorNotice＝0），選取／訊息／清單／狀態對，名冊不重畫', async () => {
    const { h, g, saved } = await boot129();
    try {
      h.plan[op.action] = [Object.assign({ list: listOf(op.after) }, op.res)];
      op.press(h);
      assert.ok(await waitFor(() => op.okMsg.test(msg(h))), '沒有成功訊息（實際：' + msg(h) + '）');
      await drain();
      assert.strictEqual(g.counts[op.action], 1, '寫入送了 ' + g.counts[op.action] + ' 發');
      assert.strictEqual(reloads(g), 0, '寫入回應已附清單，還打了 getSeniorNotice');
      assert.strictEqual(sel(h), op.sel, '下拉沒有選到該則');
      assert.match(msg(h), op.okMsg, '成功訊息被清掉');
      assert.deepStrictEqual(Array.from(h.ctx.SN.ids), op.after.ids, '畫面清單不是回應附的那份');
      assert.deepStrictEqual(Array.from(h.ctx.SN.templates), op.after.templates);
      assert.deepStrictEqual(h.ctx.SN.disabled.map((x) => x.id), op.after.disabled.map((x) => x.id), '停用清單不是回應附的那份');
      assert.deepStrictEqual(Array.from(h.ctx.SN.status), op.status, '發送狀態沒有依編號沿用');
      assert.strictEqual(String(h.els['sn-people'].innerHTML), 'PEOPLE-MARK', '名冊被重畫了（勾選會被清掉）');
      assert.strictEqual(h.ctx.SN.audience.length, 1, '名冊資料被換掉');
      assert.ok(lockedNone(h), '畫完沒有解鎖');
      assert.ok(saved.length >= 1 && saved[saved.length - 1].obj.ids.join() === op.after.ids.join(),
        '下次開頁的快取不是寫入後的清單');
    } finally { h.cleanup(); }
  });
  test('#129 K3 ' + name + '：舊版後端（回應沒有清單）⇒ 退回 snReload 重讀整區（同現行）', async () => {
    const { h, g } = await boot129();
    try {
      h.plan[op.action] = [op.res];
      op.press(h);
      assert.ok(await waitFor(() => op.okMsg.test(msg(h))), '實際：' + msg(h));
      await drain();
      assert.strictEqual(reloads(g), 1, '沒有清單卻沒重讀 ⇒ 畫面停在改動前的清單');
      assert.deepStrictEqual(Array.from(h.ctx.SN.ids), ['uuid-reload'], '畫的不是重讀回來的清單');
    } finally { h.cleanup(); }
  });
});

test('#129 K1＋K2 恢復（刪除後同一個畫面裡恢復，H1 的情境）：只發 1 次、選到它、狀態沿用刪除前讀到的「發過」', async () => {
  const { h, g } = await boot129();
  try {
    // 先刪「問卷」（發過的那則）
    h.plan.removeSeniorTemplate = [{ ok: true, list: listOf(OPS129.del.after) }];
    OPS129.del.press(h);
    assert.ok(await waitFor(() => msg(h) === '已刪除。'));
    await drain();
    // 再從已停用清單恢復它（停用清單第 1 個位置）
    const after = noticeD(['表揚', '問卷', '截止'], ['legacy-0', 'legacy-1', 'legacy-2'], [D_OLD]);
    h.plan.restoreSeniorTemplate = [{ ok: true, id: 'legacy-1', idx: 1, list: listOf(after) }];
    click(h, 1);
    assert.ok(await waitFor(() => msg(h) === '已恢復。'), '實際：' + msg(h));
    await drain();
    assert.strictEqual(g.counts.restoreSeniorTemplate, 1);
    assert.strictEqual(reloads(g), 0, '兩個動作加起來還打了 getSeniorNotice');
    assert.strictEqual(sel(h), 'legacy-1');
    assert.deepStrictEqual(Array.from(h.ctx.SN.status), ['unsent', 'sent', 'unknown'], '恢復的那則「發過」被弄丟了');
    assert.strictEqual(h.ctx.snCur().status, 'sent');
  } finally { h.cleanup(); }
});

test('#129 🔴 恢復的那則在這個畫面裡從沒讀過狀態（開頁前就停用了）⇒ 退回重讀，不顯示成「未發送」', async () => {
  const { h, g } = await boot129();
  try {
    const after = noticeD(['表揚', '舊的', '問卷', '截止'], ['legacy-0', 'uuid-d', 'legacy-1', 'legacy-2'], []);
    h.plan.restoreSeniorTemplate = [{ ok: true, id: 'uuid-d', idx: 1, list: listOf(after) }];
    click(h, 0);
    assert.ok(await waitFor(() => /已恢復/.test(msg(h))), '實際：' + msg(h));
    await drain();
    assert.strictEqual(reloads(g), 1, '狀態不明卻沒重讀 ⇒ 會被顯示成「未發送」');
    assert.deepStrictEqual(Array.from(h.ctx.SN.ids), ['uuid-reload']);
  } finally { h.cleanup(); }
});

test('#129 新增時 hub 上次讀不到（why）⇒ 新那則是「不明」不是「未發送」（與重讀整區的結果一致）', async () => {
  const { h } = await boot129();
  try {
    const b = before129(); b.why = 'hub_down';
    h.ctx.renderSenior(b);
    h.plan.addSeniorTemplate = [{ ok: true, id: 'uuid-new', idx: 3, list: listOf(OPS129.add.after) }];
    h.ctx.snAddTpl();
    assert.ok(await waitFor(() => /已新增/.test(msg(h))));
    await drain();
    assert.strictEqual(h.ctx.SN.status[3], 'unknown');
  } finally { h.cleanup(); }
});

test('#129 回應清單形狀不對（長度對不上／少一格）⇒ 退回重讀', async () => {
  for (const bad of [{ ids: ['a'], titles: [], templates: [], disabled: [] },
                     { ids: ['legacy-0'], titles: ['表揚'], templates: ['x'] }]) {
    const { h, g } = await boot129();
    try {
      h.plan.saveSeniorTemplate = [{ ok: true, id: 'legacy-0', list: bad }];
      h.ctx.snSaveTpl();
      assert.ok(await waitFor(() => /已儲存/.test(msg(h))));
      await drain();
      assert.strictEqual(reloads(g), 1, JSON.stringify(bad));
    } finally { h.cleanup(); }
  }
});

test('#129 #128 不退化：新路徑上「處理中…」立即出現、全鎖、回應前再按不送第二發；畫完才解鎖', async () => {
  const { h, g } = await boot129();
  try {
    g.hold('addSeniorTemplate');
    h.ctx.snAddTpl();
    await drain();
    assert.strictEqual(msg(h), '處理中…');
    assert.ok(lockedAll(h));
    Object.keys(OPS).forEach((k) => OPS[k].press(h));
    await drain();
    assert.strictEqual(g.counts.addSeniorTemplate, 1);
    ['removeSeniorTemplate', 'saveSeniorTemplate', 'restoreSeniorTemplate'].forEach((a) => assert.strictEqual(g.counts[a] || 0, 0, a));
    g.release('addSeniorTemplate', { ok: true, id: 'uuid-new', idx: 3, list: listOf(OPS129.add.after) });
    assert.ok(await waitFor(() => /已新增/.test(msg(h))));
    await drain();
    assert.ok(lockedNone(h));
    assert.strictEqual(reloads(g), 0);
  } finally { h.cleanup(); }
});

/* ── #129 突變對照：改壞 stats.html（記憶體裡）→ 上面的斷言要紅 ──────────── */

const SRC = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', FILE), 'utf8');
/** 恰好取代一次；找不到丟一般 Error（不是 AssertionError），免得「沒套上」被讀成「擋下了」。 */
function mutated(from, to) {
  const n = SRC.split(from).length - 1;
  if (n !== 1) throw new Error('突變沒套上：原文出現 ' + n + ' 次：' + JSON.stringify(from));
  return SRC.split(from).join(to);
}
async function mustRed(html, run) {
  let red = false;
  const { h, g } = await boot129(html);
  try { await run(h, g); } catch (e) {
    if (!(e instanceof assert.AssertionError)) throw e;
    red = true;
  } finally { h.cleanup(); }
  assert.ok(red, '突變後斷言沒紅 ⇒ 這條量不到它要量的東西');
}
const runAdd = async (h, g) => {
  h.plan.addSeniorTemplate = [{ ok: true, id: 'uuid-new', idx: 3, list: listOf(OPS129.add.after) }];
  h.ctx.snAddTpl();
  await waitFor(() => /已新增/.test(msg(h)));
  await drain();
  assert.strictEqual(reloads(g), 0);
  assert.deepStrictEqual(Array.from(h.ctx.SN.ids), OPS129.add.after.ids);
  assert.strictEqual(sel(h), 'uuid-new');
};

test('#129 ⬛ 突變（票上的對照組）：寫入後仍呼叫 getSeniorNotice ⇒ K1 紅', async () => {
  await mustRed(mutated('  if(!shaped)return snReload(selectKey,okMsg);', '  return snReload(selectKey,okMsg);'), runAdd);
});

test('#129 ⬛ 突變（票上的對照組）：清單用寫入前的資料（畫面上那份）⇒ K2 紅', async () => {
  await mustRed(mutated('  var L=r&&r.list;', '  var L=SN&&{ids:SN.ids,titles:SN.titles,templates:SN.templates,disabled:SN.disabled};'), runAdd);
});

test('#129 ⬛ 突變：沒有清單時不退回重讀 ⇒ K3 紅', async () => {
  await mustRed(mutated('  if(!shaped)return snReload(selectKey,okMsg);', '  if(!shaped)return;'), async (h, g) => {
    h.plan.saveSeniorTemplate = [{ ok: true, id: 'legacy-0' }];
    h.ctx.snSaveTpl();
    await waitFor(() => msg(h) !== '處理中…');
    await drain();
    assert.strictEqual(reloads(g), 1);
    assert.match(msg(h), /已儲存/);
  });
});

test('#129 ⬛ 突變：重畫時連名冊一起重畫（呼叫 renderSenior）⇒ K2「名冊不重畫」紅', async () => {
  await mustRed(mutated('    snRenderTpl(SN,selectKey);\n    snPickMsg();', '    renderSenior(SN,selectKey);'), async (h, g) => {
    await runAdd(h, g);
    assert.strictEqual(String(h.els['sn-people'].innerHTML), 'PEOPLE-MARK');
  });
});

test('#129 ⬛ 突變：對不到狀態時猜「未發送」而不退回重讀 ⇒ 恢復那條紅', async () => {
  await mustRed(mutated('      if(!st)return snReloadNow(y,selectKey,okMsg);   // 已在佇列裡，不可再 queueRead（會自己等自己）', "      if(!st)st='unsent';"), async (h, g) => {
    const after = noticeD(['表揚', '舊的', '問卷', '截止'], ['legacy-0', 'uuid-d', 'legacy-1', 'legacy-2'], []);
    h.plan.restoreSeniorTemplate = [{ ok: true, id: 'uuid-d', idx: 1, list: listOf(after) }];
    click(h, 0);
    await waitFor(() => /已恢復/.test(msg(h)));
    await drain();
    assert.strictEqual(reloads(g), 1);
  });
});

test('#129 ⬛ 突變：狀態依則次而不是依編號沿用 ⇒ 刪除那條紅（刪了中間那則，後面的狀態位移）', async () => {
  await mustRed(mutated("      var id=String(L.ids[k]),st=SN_ST_SEEN[SN.year+'|'+id];", "      var id=String(L.ids[k]),st=SN.status[k];"), async (h) => {
    h.plan.removeSeniorTemplate = [{ ok: true, list: listOf(OPS129.del.after) }];
    OPS129.del.press(h);
    await waitFor(() => msg(h) === '已刪除。');
    await drain();
    assert.deepStrictEqual(Array.from(h.ctx.SN.status), OPS129.del.status);
  });
});
