/**
 * messages.html 的兩條進來的路（訊息平台多人化「乙」liff 端，線 ML，2026-09-13）。
 *
 * 🔴 **為何非在真瀏覽器看不可**：單元測試（`msglog-line-wiring.test.js`）的 DOM 是假的，
 *    證明不了「畫面上真的出現那句話」與「清單真的畫出來」。
 *
 * ⚠️ 手法照 `attend-checkin-e1b.spec.js`：擋掉真的 LIFF SDK、在頁面 script 之前放替身、
 *    `page.route()` 在 `goto()` 之前（儀器早於事件）。
 * ⚠️ hub 與 gas 都在 script.google.com ⇒ 用路徑分辨；②是 POST（參數在 body）。
 * ⚠️ **這一層驗不到後端**：`getMessageLog`／`getWelfareMessageLog` 真的放行誰、過濾得對不對，在 jdc-line-gas。
 */
const { test, expect } = require('@playwright/test');

const HUB_ID = 'AKfycbwCMxy9K3A8ZE56yJrGW1C9ee1iZnsMRHosBygDHcm8qJD9UeyUINnRuh3aKX9QMqR8';
const GAS_ID = 'AKfycbxaDoA_7aOW325p8165VegSqdRL8gRhfTEMfjosdh1A0T4rmzj4Pl7F3k5PToe2po-xtg';

const H = ['發送時間', '平台', '來源', '對象UserID', '對象姓名', '對象單位',
           '訊息型別', '訊息內容', '附件', '結果', '錯誤', '批次'];
const ROWS = [['2026-09-01 10:00:00', 'line-platform', 'bind_success', 'U1', '塗小明', '工務部',
               'text', '綁定成功通知', '', '成功', '', 'b-1']];
const OK = { ok: true, who: '甲', header: H, rows: ROWS, logSince: '2026-08-19' };

function liffStub({ loggedIn = true, idToken = 'IDTOK', sub = 'U_sub_1' } = {}) {
  return `window.liff = {
    init: function(){ return Promise.resolve(); },
    isLoggedIn: function(){ return ${loggedIn}; },
    getIDToken: function(){ return ${JSON.stringify(idToken)}; },
    getDecodedIDToken: function(){ return { sub: ${JSON.stringify(sub)} }; },
    login: function(o){ window.__liffLoginCalled = (o && o.redirectUri) || 1; },
    logout: function(){ window.__liffLogoutCalled = (window.__liffLogoutCalled || 0) + 1; }
  };`;
}

async function open(page, search, { reply = () => OK, liff = {} } = {}) {
  const logs = [];
  const sent = [];
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  await page.route(/static\.line-scdn\.net/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  if (liff) await page.addInitScript(liffStub(liff));
  await page.route(/script\.google\.com/, async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    const params = {};
    new URLSearchParams(req.method() === 'POST' ? (req.postData() || '') : u.search)
      .forEach((v, k) => { params[k] = v; });
    const s = { backend: u.pathname.indexOf(HUB_ID) >= 0 ? 'hub' : (u.pathname.indexOf(GAS_ID) >= 0 ? 'gas' : '?'),
      method: req.method(), url: req.url(), params };
    sent.push(s);
    await route.fulfill({ status: 200, contentType: 'application/javascript',
      body: 'cb(' + JSON.stringify(reply(s)) + ')' });
  });
  await page.goto('/messages.html' + search);
  await page.waitForTimeout(1200);
  return { logs, sent };
}

const visible = (page) => page.evaluate(() => document.body.innerText);

test('②LINE 登入 → POST gas getMessageLog（只帶 idToken），清單畫出來', async ({ page }) => {
  const { logs, sent } = await open(page, '');
  expect(sent.length).toBe(1);
  expect(sent[0].backend).toBe('gas');
  expect(sent[0].method).toBe('POST');
  expect(sent[0].params.action).toBe('getMessageLog');
  expect(sent[0].params.idToken).toBe('IDTOK');
  expect(sent[0].params.token).toBeUndefined();
  expect(sent[0].params.t).toBeUndefined();
  expect(sent[0].url).not.toContain('idToken');
  const txt = await visible(page);
  expect(txt).toContain('塗小明');
  expect(logs).toEqual([]);
  await page.screenshot({ path: 'test-results/msglog-line-01-成功.png', fullPage: true });
});

test('②從發訊頁進來（?from=welfare&days=180）→ getWelfareMessageLog、days=180', async ({ page }) => {
  const { logs, sent } = await open(page, '?from=welfare&days=180');
  expect(sent.length).toBe(1);
  expect(sent[0].backend).toBe('gas');
  expect(sent[0].params.action).toBe('getWelfareMessageLog');
  expect(sent[0].params.days).toBe('180');
  expect(sent[0].params.idToken).toBe('IDTOK');
  expect(await visible(page)).toContain('塗小明');
  expect(logs).toEqual([]);
});

test('🔴 ② hub_unreadable → 畫面講「讀不到」，不是空白、不是「沒有紀錄」', async ({ page }) => {
  const { logs } = await open(page, '', { reply: () => ({ ok: false, reason: 'hub_unreadable', msg: '訊息紀錄暫時讀不到，請稍後再試。' }) });
  const txt = await visible(page);
  console.log('【hub_unreadable】畫面：', txt.slice(0, 200));
  await expect(page.locator('#msg')).toContainText('不是沒有紀錄');
  expect(txt).not.toContain('沒有你權限內的紀錄');
  expect(txt).not.toContain('載入中');
  expect(logs).toEqual([]);
  await page.screenshot({ path: 'test-results/msglog-line-02-hub讀不到.png', fullPage: true });
});

test('② 角色不符 → 後端那句話畫在畫面上', async ({ page }) => {
  const { logs } = await open(page, '', { reply: () => ({ ok: false, reason: 'role_mismatch', msg: '此連結非您的權限範圍。' }) });
  await expect(page.locator('#msg')).toHaveText('此連結非您的權限範圍。');
  expect(logs).toEqual([]);
});

test('②成功但沒有 logSince → 「紀錄起始日未設定」照舊顯示（保守呈現，待拍板）', async ({ page }) => {
  const { logs } = await open(page, '', { reply: () => ({ ok: true, who: '甲', header: H, rows: ROWS }) });
  await expect(page.locator('#warnbar')).toBeVisible();
  await expect(page.locator('#warnbar')).toContainText('紀錄起始日未設定');
  expect(logs).toEqual([]);
});

test('②還沒登入 → 去 LINE 登入（保留 query），一個請求都沒送', async ({ page }) => {
  const { sent } = await open(page, '?from=welfare&days=180', { liff: { loggedIn: false } });
  expect(await page.evaluate(() => window.__liffLoginCalled)).toContain('messages.html?from=welfare&days=180');
  expect(sent).toEqual([]);
  expect(await visible(page)).toContain('正在前往 LINE 登入');
});

for (const search of ['?from=abc', '?from=WELFARE', '?from=']) {
  test(`🔴 ② ${search} → 仍打 getMessageLog（只有 from=welfare 逐字相符才打發訊那支）`, async ({ page }) => {
    const { logs, sent } = await open(page, search);
    expect(sent.length).toBe(1);
    expect(sent[0].params.action).toBe('getMessageLog');
    expect(logs).toEqual([]);
  });
}

/**
 * 🔴 LINE CDN 慢的時候，①舊連結不可以跟著等（VML 量到：同步載入 SDK 時 CDN 延遲 5 秒 ⇒ hub 請求 5028ms 才發）。
 * ⚠️ 量法：`goto` 用 `waitUntil:'commit'`（不等 load——同步載入時 load 本身就被 SDK 卡住），
 *    時間取「goto 之前」到「hub 請求被攔到」。對照數字（faf0c50／f2ef5bf）用同一支量法另跑，附在交件。
 */
test('🔴 ①舊連結：LINE CDN 延遲 5 秒也不拖慢 hub 請求（SDK 只在②才載），送出的參數逐字不變', async ({ page }) => {
  const logs = [];
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  let sdkRequests = 0;
  let hubAt = null;
  let params = null;
  await page.route(/static\.line-scdn\.net/, async (route) => {
    sdkRequests++;
    await new Promise((r) => setTimeout(r, 5000));
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }).catch(() => {});
  });
  await page.route(/script\.google\.com/, async (route) => {
    const u = new URL(route.request().url());
    if (hubAt === null) hubAt = Date.now();
    params = {};
    u.searchParams.forEach((v, k) => { params[k] = v; });
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: 'cb(' + JSON.stringify(OK) + ')' });
  });
  const t0 = Date.now();
  await page.goto('/messages.html?t=STUBMT', { waitUntil: 'commit' });
  await expect.poll(() => hubAt, { timeout: 9000 }).not.toBeNull();
  const ms = hubAt - t0;
  console.log(`【CDN 延遲 5000ms】①hub 請求於 ${ms}ms 發出；SDK 請求 ${sdkRequests} 次`);
  expect(ms, 'hub 請求被 LINE CDN 拖住了').toBeLessThan(2000);
  expect(sdkRequests, '①舊路去載了 LINE SDK').toBe(0);
  expect(params).toEqual({ action: 'listMessageLog', t: 'STUBMT', days: '3650', callback: 'cb' });
  await expect(page.locator('#list')).toContainText('塗小明');
  expect(logs).toEqual([]);
});

test('②沒有替身時真的去 CDN 動態載入 SDK（慢 1 秒也等得到），載完才發請求、只帶 idToken', async ({ page }) => {
  const logs = [];
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  let sdkRequests = 0;
  let sdkServedAt = null;
  const sent = [];
  await page.route(/static\.line-scdn\.net/, async (route) => {
    sdkRequests++;
    await new Promise((r) => setTimeout(r, 1000));
    sdkServedAt = Date.now();
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: liffStub() });
  });
  await page.route(/script\.google\.com/, async (route) => {
    const req = route.request();
    const p = {};
    new URLSearchParams(req.postData() || '').forEach((v, k) => { p[k] = v; });
    sent.push({ at: Date.now(), params: p });
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: 'cb(' + JSON.stringify(OK) + ')' });
  });
  await page.goto('/messages.html');
  await expect.poll(() => sent.length, { timeout: 8000 }).toBe(1);
  expect(sdkRequests).toBe(1);
  expect(sent[0].at).toBeGreaterThanOrEqual(sdkServedAt);
  expect(sent[0].params.action).toBe('getMessageLog');
  expect(sent[0].params.idToken).toBe('IDTOK');
  await expect(page.locator('#list')).toContainText('塗小明');
  expect(logs).toEqual([]);
});

test('② CDN 載入失敗 → 紅字「LINE 的元件沒有載入成功」，一個請求都不送', async ({ page }) => {
  const sent = [];
  await page.route(/static\.line-scdn\.net/, (route) => route.abort('failed'));
  await page.route(/script\.google\.com/, async (route) => { sent.push(route.request().url()); await route.abort(); });
  await page.goto('/messages.html');
  await expect(page.locator('#msg')).toContainText('LINE 的元件沒有載入成功');
  await page.waitForTimeout(500);
  expect(sent).toEqual([]);
});

test('①舊連結 ?t= → GET hub listMessageLog 帶 t、不碰 LIFF、不帶 idToken，照常畫出來', async ({ page }) => {
  const { logs, sent } = await open(page, '?t=STUBMT', { liff: { loggedIn: false } });
  expect(await page.evaluate(() => window.__liffLoginCalled)).toBeFalsy();
  expect(sent.length).toBe(1);
  expect(sent[0].backend).toBe('hub');
  expect(sent[0].method).toBe('GET');
  expect(sent[0].params).toEqual({ action: 'listMessageLog', t: 'STUBMT', days: '3650', callback: 'cb' });
  const txt = await visible(page);
  expect(txt).toContain('塗小明');
  expect(txt).not.toContain('紀錄起始日未設定');   // 舊路有 logSince
  expect(logs).toEqual([]);
});
