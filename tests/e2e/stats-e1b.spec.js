/**
 * stats.html 的 E1b 畫面（2026-09-13）。
 *
 * 🔴 **為何非在真瀏覽器看不可**：單元測試（`stats-e1b-wiring.test.js`）釘的是
 *    「送出去的網址對、該擋的時候擋住」。它證明不了**畫面上真的出現那句話**，
 *    也證明不了真的 DOM 上點得到的按鈕都走同一道閘門。
 *
 * ⚠️ 手法照 `board-e1a.spec.js`／`attend-checkin-e1b.spec.js`：擋掉真的 LIFF SDK、
 *    在頁面 script 之前放替身、`page.route()` 在 `goto()` 之前（儀器早於事件）。
 *
 * 🔴 **這一頁有會讓約 137 支手機響的按鈕。** 本檔的每一條都：
 *    ① 攔下所有 `/exec`（`page.route` 本機回應，請求出不了這台機器）；
 *    ② 攔下所有非本機的請求並記下來，斷言為空；
 *    ③ 結束時斷言「發送類 action」的請求數是 0。
 *    其中一條刻意把「立即發送給全部」「補發」按下去、在確認框按取消——
 *    證明按鈕是活的（確認框真的跳出來了），而計數仍是 0。
 *
 * 🔴 其中一條刻意畫的是**子項守門回 `token_invalid` 時的畫面**（原本 `runBatch_` 子項吃空 token 就是這樣）：
 *    寫這一條時，那是佳岑用②打開會看到的畫面。
 *    那個成因已解除——gas `dbc8b17`，隨 gas main `04022c4` 於 2026-09-13 17:03:49 上線。
 *    ⇒ 它現在是「後端子項若擋下，前端怎麼顯示」的紀錄，**不是線上現況，也不是期望**。
 *    ⚠️ 那條的測試名稱與截圖檔名仍寫「後端現況」「後端子項守門未改」——那是寫測試當時的現況。
 */
const { test, expect } = require('@playwright/test');

/** 發送類 action：按下去會有人的手機響（或排定之後會響）。 */
const SEND_ACTIONS = ['sendPassBroadcast', 'sendSeniorNotice', 'grantRefill', 'schedulePassBroadcast'];

/** 一串 /exec 查詢字串裡，發送類 action 出現幾次（含 batch 子項）。 */
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
    logout: function(){ window.__liffLogoutCalled = (window.__liffLogoutCalled || 0) + 1; },
    closeWindow: function(){}, openWindow: function(){},
    getOS: function(){ return 'ios'; }, isInClient: function(){ return true; },
    getVersion: function(){ return '2.0.0'; }
  };`;
}

const ROWS = [{ id: 'A1', name: '中秋餐會', status: '開放', open: true, replies: 7, deadline: '2026/09/15', eventDate: '2026/09/20' }];
const STATS = {
  ok: true, who: '佳岑',
  activity: { id: 'A1', name: '中秋餐會', status: '開放', eventDate: '2026/09/20', deadlineText: '2026/09/15' },
  counts: { attend: 5, absent: 2, boundNoReply: 1, notBound: 1, total: 9, replied: 7, meat: 4, veg: 1 },
  opinions: [], absentList: [{ unit: '工務', name: '甲' }], boundNoReply: [{ unit: '總務', name: '乙' }], notBound: [{ unit: '工務', name: '丙' }],
};
const PREVIEW = {
  ok: true, template: '{姓名} 您好，報到碼：{連結}', defaultTemplate: '{姓名} 您好，報到碼：{連結}',
  sample: '甲 您好，報到碼：https://example.invalid/x', unbound: [], notSent: [],
  people: [{ unit: '工務', name: '甲', internalId: 'E001' }],
  published: true, willSend: 1, hasDate: true, tplHasUrl: true, schedule: null, defaultDate: '2026-09-19',
};
const SENIOR = { ok: true, year: '2026', years: ['2026'], titles: ['十年'], templates: ['恭喜'], status: ['none'], audience: [] };

/** 一切正常時後端會回的東西（依 action／batch 子項）。 */
function happy(u) {
  const a = u.searchParams.get('action');
  const one = (name) => ({
    listActivities: { ok: true, rows: ROWS }, getActivityStats: STATS,
    getSeniorNotice: SENIOR, listStaffStations: { ok: true, rows: [] }, previewPassBroadcast: PREVIEW,
    getSeatingBoard: { ok: true, seats: [], guestVendors: 0, guestSeats: 0, pubState: 'none', ranks: {}, actName: '中秋餐會' },
    getUndelivered: { ok: true, pending: 0 }, getBindLink: { ok: true, url: 'https://liff.line.me/example' },
  }[name] || { ok: true, rows: [] });
  if (a === 'batch') {
    const results = {};
    JSON.parse(u.searchParams.get('list') || '[]').forEach((it) => { results[it.a] = one(it.a); });
    return { ok: true, results };
  }
  return one(a);
}

async function open(page, search, { reply = happy, liff = {} } = {}) {
  const logs = [], sent = [], external = [];
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  // ⚠️ route 的比對順序是「後註冊的先比」⇒ 兜底的放最前面。
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
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: 'cb(' + JSON.stringify(reply(u)) + ')' });
  });
  await page.goto('/stats.html' + search);
  await page.waitForTimeout(1500);
  return { logs, sent, external };
}

async function visibleText(page) {
  return (await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('body *').forEach((el) => {
      if (el.children.length) return;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return;
      const t = (el.textContent || '').trim();
      if (t) out.push(t);
    });
    return out;
  })).join(' ⏎ ');
}

const pageErrors = (logs) => logs.filter((l) => l.startsWith('[pageerror]'));

/** 每一條的收尾：沒有請求跑出這台機器、沒有任何發送類 action。 */
function noLeak({ sent, external }) {
  expect(external, '有請求打到本機以外（應該全部被攔下）').toEqual(
    external.filter((u) => /static\.line-scdn\.net|script\.google\.com/.test(u)));
  expect(sendCount(sent), '測試裡送出了發送類 action：' + sent.join(' | ')).toBe(0);
}

test('⬛ 零點：sendCount 認得出單支與 batch 子項裡的發送類 action（否則「計數 0」恆真）', () => {
  expect(sendCount(['?action=sendPassBroadcast&actId=A1'])).toBe(1);
  expect(sendCount(['?action=batch&list=' + encodeURIComponent(JSON.stringify([{ a: 'grantRefill' }, { a: 'listActivities' }]))])).toBe(1);
  expect(sendCount(['?action=previewPassBroadcast&actId=A1'])).toBe(0);
});

test('②LINE 登入成功、後端放行 → 統計畫出來，每一發都帶 idToken、不帶 token', async ({ page }) => {
  const r = await open(page, '?act=A1');
  const txt = await visibleText(page);
  expect(txt).toContain('（佳岑）');
  expect(txt).toContain('不參加（2）');
  expect(r.sent.length).toBeGreaterThanOrEqual(2);
  r.sent.forEach((s) => { expect(s).toContain('idToken=IDTOK'); expect(s).not.toMatch(/[?&]token=/); });
  expect(pageErrors(r.logs)).toEqual([]);
  noLeak(r);
  await page.screenshot({ path: 'test-results/e1b-stats-01-LINE成功.png', fullPage: true });
});

test('②還沒登入 → 去 LINE 登入（保留 ?act=），一個請求都沒送；點分頁也不送', async ({ page }) => {
  const r = await open(page, '?act=A1', { liff: { loggedIn: false } });
  expect(await page.evaluate(() => window.__liffLoginCalled)).toContain('stats.html?act=A1');
  expect(await visibleText(page)).toContain('正在前往 LINE 登入');
  await page.locator('#tabbtn-manage').click();
  await page.locator('#tabbtn-staff').click();
  await page.waitForTimeout(400);
  expect(r.sent, '身分沒確認卻送出了請求').toEqual([]);
  expect(pageErrors(r.logs)).toEqual([]);
  noLeak(r);
  await page.screenshot({ path: 'test-results/e1b-stats-02-登入中.png', fullPage: true });
});

test('②LIFF 元件沒載入 → 紅字說明、「載入中…」不留在統計區；點「活動」「員工」分頁也不發請求', async ({ page }) => {
  const r = await open(page, '?act=A1', { liff: null });
  const txt = await visibleText(page);
  expect(txt).toContain('LINE 的元件沒有載入成功');
  expect(await page.locator('#content').innerText(), '紅字下面還寫著「載入中…」＝那句是假話').not.toContain('載入中');
  await page.locator('#tabbtn-manage').click();
  await page.locator('#tabbtn-staff').click();
  await page.waitForTimeout(400);
  expect(r.sent, '分頁繞過了身分確認').toEqual([]);
  expect(pageErrors(r.logs)).toEqual([]);
  noLeak(r);
  await page.screenshot({ path: 'test-results/e1b-stats-03-元件沒載入.png', fullPage: true });
});

test('🔴 ②後端現況（runBatch_ 子項吃空 token）→ 佳岑會看到「無權限或連結已失效」', async ({ page }) => {
  const deny = { ok: false, msg: '無權限或連結已失效。', reason: 'token_invalid' };
  const r = await open(page, '?act=A1', {
    reply: (u) => (u.searchParams.get('action') === 'batch'
      ? { ok: true, results: Object.fromEntries(JSON.parse(u.searchParams.get('list')).map((it) => [it.a, deny])) }
      : deny),
  });
  const txt = await visibleText(page);
  console.log('【stats 後端現況】畫面：', txt.slice(0, 300));
  expect(txt).toContain('無權限或連結已失效');
  expect(pageErrors(r.logs)).toEqual([]);
  noLeak(r);
  await page.screenshot({ path: 'test-results/e1b-stats-04-後端子項守門未改.png', fullPage: true });
});

test('①舊連結 → 帶 token、不碰 LIFF 登入、不帶 idToken，照常畫出來', async ({ page }) => {
  const r = await open(page, '?t=STUBTOKEN&act=A1', { liff: { loggedIn: false } });   // 故意給「沒登入」：舊路若碰了 LIFF 就會被導去登入
  expect(await page.evaluate(() => window.__liffLoginCalled)).toBeFalsy();
  expect(r.sent.length).toBeGreaterThanOrEqual(2);
  r.sent.forEach((s) => { expect(s).toContain('token=STUBTOKEN'); expect(s).not.toContain('idToken='); });
  expect(await visibleText(page)).toContain('（佳岑）');
  expect(pageErrors(r.logs)).toEqual([]);
  noLeak(r);
  await page.screenshot({ path: 'test-results/e1b-stats-05-舊連結.png', fullPage: true });
});

test('🔴 ②報到分頁：「立即發送給全部」與「補發」按下去、確認框按取消 → 確認框真的跳出，發送類請求 0', async ({ page }) => {
  const dialogs = [];
  page.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss(); });
  const r = await open(page, '?act=A1');
  await page.locator('#tabbtn-checkin').click();
  const sendAll = page.locator('#bc-send');
  await expect(sendAll, '預覽沒畫出來 ⇒ 發送鈕沒解鎖，下面按的是一顆 disabled 的鈕（零鑑別力）').toBeEnabled({ timeout: 5000 });
  await sendAll.click();
  await page.locator('#bc-one-unit').selectOption('工務');
  await page.locator('#bc-one-send').click();
  await page.waitForTimeout(400);
  expect(dialogs.length, '確認框沒跳出來 ⇒ 按鈕根本沒觸發到發送流程').toBe(2);
  expect(dialogs[0]).toContain('發送給全部');
  expect(dialogs[1]).toContain('補發一則');
  r.sent.forEach((s) => { expect(s).toContain('idToken=IDTOK'); });
  expect(pageErrors(r.logs)).toEqual([]);
  noLeak(r);
  await page.screenshot({ path: 'test-results/e1b-stats-06-報到分頁取消發送.png', fullPage: true });
});
