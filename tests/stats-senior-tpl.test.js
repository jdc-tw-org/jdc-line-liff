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
