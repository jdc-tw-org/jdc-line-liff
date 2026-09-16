/**
 * stats.html 的版本／時序量法（票 #103）——**在真瀏覽器裡跑**。
 *
 * 🔴 為何非真瀏覽器不可：這支量法問的三件事，node 裡一件都不存在——
 *    HTTP 快取、`performance` 的資源計時、以及那條讀取佇列在**真的初始化順序**
 *    下會不會卡住。單元測試（`tests/version-probe.test.js`）釘的是判決函式本身。
 *
 * ⬛ **零點在第一、二條**：同一支量法、同一個頁面，只有「伺服器上的位元組有沒有變」
 *    這一個差別，兩條印出來的東西必須不一樣。印一樣 ⇒ 這支量法什麼都沒測到。
 *
 * 🔴 這一頁有會讓很多支手機響的按鈕。照 `stats-e1b.spec.js` 的規矩：
 *    所有 `/exec` 由 `page.route` 在本機回應，非本機的請求全部攔下並斷言為空，
 *    收尾斷言發送類 action 的請求數是 0。**量測本身也不可以送出任何 /exec。**
 */
const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const SEND_ACTIONS = ['sendPassBroadcast', 'sendSeniorNotice', 'grantRefill', 'schedulePassBroadcast'];

function sendCount(searches) {
  let n = 0;
  searches.forEach((s) => {
    const sp = new URLSearchParams(s);
    if (SEND_ACTIONS.indexOf(sp.get('action')) >= 0) n++;
    let list = [];
    try { list = JSON.parse(sp.get('list') || '[]'); } catch (e) { list = []; }
    list.forEach((it) => { if (it && SEND_ACTIONS.indexOf(it.a) >= 0) n++; });
  });
  return n;
}

function liffStub({ loggedIn = true, idToken = 'IDTOK', sub = 'U_sub_1' } = {}) {
  return `window.liff = {
    init: function(){ return Promise.resolve(); },
    isLoggedIn: function(){ return ${loggedIn}; },
    getIDToken: function(){ return ${JSON.stringify(idToken)}; },
    getDecodedIDToken: function(){ return { sub: ${JSON.stringify(sub)} }; },
    login: function(o){ window.__liffLoginCalled = (o && o.redirectUri) || 1; },
    logout: function(){}, closeWindow: function(){}, openWindow: function(){},
    getOS: function(){ return 'ios'; }, isInClient: function(){ return true; },
    getVersion: function(){ return '2.0.0'; }
  };`;
}

const ROWS = [{ id: 'A1', name: '中秋餐會', status: '開放', open: true, replies: 7, deadline: '2026/09/15', eventDate: '2026/09/20' }];
const STATS = {
  ok: true, who: '承辦',
  activity: { id: 'A1', name: '中秋餐會', status: '開放', eventDate: '2026/09/20', deadlineText: '2026/09/15' },
  counts: { attend: 5, absent: 2, boundNoReply: 1, notBound: 1, total: 9, replied: 7, meat: 4, veg: 1 },
  opinions: [], absentList: [{ unit: '工務', name: '甲' }], boundNoReply: [{ unit: '總務', name: '乙' }], notBound: [{ unit: '工務', name: '丙' }],
};
const PREVIEW = {
  ok: true, template: '{姓名} 您好，報到碼：{連結}', defaultTemplate: '{姓名} 您好，報到碼：{連結}',
  sample: '甲 您好', unbound: [], notSent: [], people: [{ unit: '工務', name: '甲', internalId: 'E001' }],
  published: true, willSend: 1, hasDate: true, tplHasUrl: true, schedule: null, defaultDate: '2026-09-19',
};

/** 票上「2025 在重進後曾正常顯示 19 人」那條已知會成功的路徑，照數字造出來。 */
function seniorFor(year) {
  const n = year === '2025' ? 19 : (year === '2027' ? 3 : 7);
  const audience = [];
  for (let i = 0; i < n; i++) audience.push({ unit: '工務', name: '員' + i, internalId: 'E' + i, years: 10, sendable: true, status: 'none' });
  return { ok: true, year: year, years: ['2027', '2026', '2025'], titles: ['十年'], templates: ['恭喜'], status: ['none'], audience: audience };
}

function happy(u) {
  const a = u.searchParams.get('action');
  const one = (name, p) => ({
    listActivities: { ok: true, rows: ROWS }, getActivityStats: STATS,
    getSeniorNotice: seniorFor(String((p && p.year) || u.searchParams.get('year') || '2026')),
    listStaffStations: { ok: true, rows: [] }, previewPassBroadcast: PREVIEW,
    getSeatingBoard: { ok: true, seats: [], guestVendors: 0, guestSeats: 0, pubState: 'none', ranks: {}, actName: '中秋餐會' },
    getUndelivered: { ok: true, pending: 0 }, getBindLink: { ok: true, url: 'https://liff.line.me/example' },
  }[name] || { ok: true, rows: [] });
  if (a === 'batch') {
    const results = {};
    JSON.parse(u.searchParams.get('list') || '[]').forEach((it) => { results[it.a] = one(it.a, it.p); });
    return { ok: true, results };
  }
  return one(a);
}

/** 被拿來造「版本不一致」的那支資源。挑它的理由：頁面已經執行過的是第 1 份，之後怎麼變都不影響畫面。 */
const TARGET = '/assets/qr-badge.js';
const TARGET_BYTES = fs.readFileSync(path.join(__dirname, '..', '..', 'assets', 'qr-badge.js'), 'utf8');

/**
 * @param {?number} mutateFrom 第幾個請求開始改內容（null＝永遠不改＝版本一致的世界）
 */
async function open(page, search, { liff = {}, mutateFrom = null } = {}) {
  const logs = [], sent = [], external = [], hits = [];
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  await page.route((url) => url.hostname !== '127.0.0.1', async (route) => {
    external.push(route.request().url());
    await route.abort();
  });
  await page.route(/static\.line-scdn\.net/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  if (liff) await page.addInitScript(liffStub(liff));
  await page.route(/script\.google\.com/, async (route) => {
    const u = new URL(route.request().url());
    sent.push(u.search);
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: 'cb(' + JSON.stringify(happy(u)) + ')' });
  });
  // 受測資源：自己回應，**回 no-store** 讓 force-cache 那一發也一定走到這裡
  // ⇒ 三個請求（開頁 1＋量測 2）都數得到，不必去猜瀏覽器的快取決定。
  await page.route('**' + TARGET, async (route) => {
    hits.push(Date.now());
    const mutate = mutateFrom != null && hits.length >= mutateFrom;
    await route.fulfill({
      status: 200, contentType: 'text/javascript; charset=utf-8',
      headers: { 'Cache-Control': 'no-store', 'Last-Modified': 'Tue, 16 Sep 2026 09:00:00 GMT' },
      body: TARGET_BYTES + (mutate ? '\n/* 伺服器上已經換成新版了 */\n' : ''),
    });
  });
  await page.goto('/stats.html' + search);
  await page.waitForTimeout(1500);
  return { logs, sent, external, hits };
}

/** 按下頁尾「診斷」，把報告原文取回來。**不重載**——重載一次證據就沒了。 */
async function readProbe(page, timeout = 15000) {
  await page.locator('#jdc-probe a').click();
  await expect(page.locator('#jdc-probe-out')).not.toHaveText('量測中…', { timeout });
  return page.locator('#jdc-probe-out').innerText();
}

const pageErrors = (logs) => logs.filter((l) => l.startsWith('[pageerror]'));

function noLeak({ sent, external }) {
  expect(external, '有請求打到本機以外').toEqual(
    external.filter((u) => /static\.line-scdn\.net|script\.google\.com/.test(u)));
  expect(sendCount(sent), '測試裡送出了發送類 action：' + sent.join(' | ')).toBe(0);
}

/* ══ ⬛ 零點：兩種世界 ═════════════════════════════════════════════ */

test('⬛ 零點 A：伺服器上的位元組沒變 → 報告說「同版」', async ({ page }) => {
  const r = await open(page, '?t=STUBTOKEN&act=A1', { mutateFrom: null });
  const out = await readProbe(page);
  console.log('\n【世界 A：版本一致】\n' + out + '\n');
  expect(r.hits.length, '受測資源的請求數不是 3（開頁 1＋量測 2）⇒ 下面的判讀站不住').toBe(3);
  expect(out).toContain('不同版 0');
  expect(out).not.toContain('🔴 不同版 qr-badge.js');
  expect(out).toContain('已知同版→同版／已知不同版→🔴 不同版／取不到→量不到');
  expect(pageErrors(r.logs)).toEqual([]);
  noLeak(r);
});

test('🔴 ⬛ 零點 B：只有伺服器那一份換了位元組 → 報告說「🔴 不同版」，且指名是哪一支', async ({ page }) => {
  // 第 3 個請求＝量測的 no-store 那一發（第 1 個是開頁、第 2 個是 force-cache）
  const r = await open(page, '?t=STUBTOKEN&act=A1', { mutateFrom: 3 });
  const out = await readProbe(page);
  console.log('\n【世界 B：版本不一致】\n' + out + '\n');
  expect(r.hits.length, '請求數不是 3 ⇒ 「第 3 發是 no-store」這個前提不成立').toBe(3);
  expect(out).toContain('不同版 1');
  expect(out).toContain('🔴 不同版 qr-badge.js');
  expect(pageErrors(r.logs)).toEqual([]);
  noLeak(r);
});

/* ══ 時序與佇列 ═══════════════════════════════════════════════════ */

test('①舊連結、後端全部放行 → 四條初始化 Promise 全部「已完成」、佇列「通暢」', async ({ page }) => {
  const r = await open(page, '?t=STUBTOKEN&act=A1');
  const out = await readProbe(page);
  console.log('\n【健康的一次開頁】\n' + out + '\n');
  ['AUTH_READY：已完成', 'CACHE_READY：已完成', 'FIRST(首載批次)：已完成', 'SECOND(預取批次)：已完成']
    .forEach((s) => expect(out, s).toContain(s));
  expect(out).toContain('讀取佇列：通暢');
  expect(out, '後端沒有版本欄位這件事要講出來').toContain('回應本身沒有版本欄位');
  expect(out).toMatch(/batch\[listActivities,getActivityStats\]/);
  expect(pageErrors(r.logs)).toEqual([]);
  noLeak(r);
});

test('🔴 待驗假設：②登入沒完成 → AUTH_READY 永遠「等待中」，且**整條讀取佇列卡住**', async ({ page }) => {
  const r = await open(page, '?act=A1', { liff: { loggedIn: false } });
  const out = await readProbe(page);
  console.log('\n【登入沒完成】\n' + out + '\n');
  expect(out).toContain('AUTH_READY：等待中');
  expect(out).toContain('CACHE_READY：等待中');
  expect(out).toContain('FIRST(首載批次)：等待中');
  // 🔴 這是票上那條假設真正的形狀：不只「那一發不送」，而是**之後每一發都不送**
  expect(out, '佇列沒卡住 ⇒ 假設的後半段不成立，要在票上更正').toContain('讀取佇列：🔴 卡住');
  expect(out).toContain('沒有已完成的 /exec');
  expect(r.sent, '身分沒確認卻送出了請求').toEqual([]);
  expect(pageErrors(r.logs)).toEqual([]);
  noLeak(r);
});

test('🔴 對照組：LIFF 元件沒載入（紅字那條路）→ 同樣是佇列卡住，不是只有一發不送', async ({ page }) => {
  const r = await open(page, '?act=A1', { liff: null });
  const out = await readProbe(page);
  console.log('\n【LIFF 元件沒載入】\n' + out + '\n');
  expect(out).toContain('AUTH_READY：等待中');
  expect(out).toContain('讀取佇列：🔴 卡住');
  expect(r.sent).toEqual([]);
  expect(pageErrors(r.logs)).toEqual([]);
  noLeak(r);
});

/* ══ 對照組：已知會成功的路徑不得被破壞 ══════════════════════════ */

test('⬛ 對照組：2025／2026／2027 各切一次都收斂，2025 仍是 19 人（票上那條已知成功的路徑）', async ({ page }) => {
  const r = await open(page, '?t=STUBTOKEN&act=A1');
  await page.locator('#tabbtn-staff').click();
  await expect(page.locator('#sn-year')).toHaveValue('2026', { timeout: 5000 });
  const seen = {};
  for (const y of ['2025', '2026', '2027']) {
    await page.locator('#sn-year').selectOption(y);
    await expect(page.locator('#sn-people .sn-ck')).toHaveCount(y === '2025' ? 19 : (y === '2027' ? 3 : 7), { timeout: 8000 });
    seen[y] = await page.locator('#sn-people .sn-ck').count();
    await expect(page.locator('#sn-people'), y + ' 年停在「載入中…」＝沒有收斂').not.toContainText('載入中…');
  }
  console.log('\n【年度切換】各年度人數：' + JSON.stringify(seen) + '\n');
  expect(seen['2025']).toBe(19);
  const out = await readProbe(page);
  expect(out).toContain('讀取佇列：通暢');
  expect(pageErrors(r.logs)).toEqual([]);
  noLeak(r);
});

test('⬛ 對照組：沒點「診斷」就不量——量測本身不送 /exec、也不動頁面', async ({ page }) => {
  const r = await open(page, '?t=STUBTOKEN&act=A1');
  const before = r.sent.length;
  const hitsBefore = r.hits.length;
  expect(hitsBefore, '沒點就已經多抓了資源').toBe(1);
  await readProbe(page);
  expect(r.sent.length, '量測送出了 /exec').toBe(before);
  expect(await page.locator('#content').innerText(), '量測把畫面弄壞了').toContain('不參加');
  noLeak(r);
});
