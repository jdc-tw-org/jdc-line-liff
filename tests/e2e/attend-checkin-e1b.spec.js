/**
 * attend.html／checkin.html 的 E1b 畫面（2026-09-13）。
 *
 * 🔴 **為何非在真瀏覽器看不可**：單元測試（`attend-checkin-e1b-wiring.test.js`）釘的是
 *    「送出去的網址對、該擋的時候擋住」。它證明不了**畫面上真的出現那句話**——
 *    stub 的 DOM 是假的（2026-07-27 attend.html 下拉永遠不隱藏就是靜態檢查全綠、開一次就看到）。
 *
 * ⚠️ 手法照 `board-e1a.spec.js`：擋掉真的 LIFF SDK、在頁面 script 之前放替身、
 *    `page.route()` 在 `goto()` 之前（儀器早於事件）。
 *
 * 🔴 其中一條刻意畫的是**後端現況下的失敗**（`runBatch_` 子項吃空 token ⇒ `token_invalid`）：
 *    那是副總用②打開時今天會看到的畫面，也是計畫記載的驗收風險。它是紀錄，不是期望。
 */
const { test, expect } = require('@playwright/test');

async function blockLiffCdn(page) {
  await page.route(/static\.line-scdn\.net/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
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

/**
 * @param {(u: URL) => object} reply 依請求回 JSONP 內容
 * @param {object|null} liff null ＝不放替身（模擬 LIFF 元件沒載入）
 */
async function open(page, file, search, { reply = () => ({ ok: true }), liff = {} } = {}) {
  const logs = [];
  const sent = [];
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  await blockLiffCdn(page);
  if (liff) await page.addInitScript(liffStub(liff));
  await page.route(/script\.google\.com/, async (route) => {
    const u = new URL(route.request().url());
    sent.push(u.search);
    await route.fulfill({ status: 200, contentType: 'application/javascript',
      body: 'cb(' + JSON.stringify(reply(u)) + ')' });
  });
  await page.goto('/' + file + search);
  await page.waitForTimeout(1200);
  return { logs, sent };
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

const ROWS = [{ id: 'A1', name: '中秋餐會', status: '開放', open: true, replies: 7 }];
const STATS = {
  ok: true, who: '副總',
  activity: { id: 'A1', name: '中秋餐會', status: '開放', eventDate: '2026/09/20', deadlineText: '2026/09/15' },
  counts: { attend: 5, absent: 2, boundNoReply: 1, notBound: 1, total: 9, replied: 7, meat: 4, veg: 1 },
  opinions: [], absentList: [{ unit: '工務', name: '甲' }], boundNoReply: [{ unit: '總務', name: '乙' }], notBound: [{ unit: '工務', name: '丙' }],
};
const BOARD = { total: 9, arrived: 5, walkins: 0, notArrived: 4, byUnit: { 工務: { arrived: 2, total: 4 } },
  byStation: { S1: 5 }, notArrivedList: [{ name: '甲', unit: '工務' }] };

/* ══ attend.html ══════════════════════════════════════════════════════ */

test('attend ②還沒登入 → 去 LINE 登入（保留 ?act=），一個請求都沒送', async ({ page }) => {
  const { logs, sent } = await open(page, 'attend.html', '?act=A1', { liff: { loggedIn: false } });
  expect(await page.evaluate(() => window.__liffLoginCalled)).toContain('attend.html?act=A1');
  expect(sent, '導頁中還送出了請求').toEqual([]);
  expect(await visibleText(page)).toContain('正在前往 LINE 登入');
  expect(pageErrors(logs)).toEqual([]);
  await page.screenshot({ path: 'test-results/e1b-attend-01-登入中.png', fullPage: true });
});

test('attend ②登入成功、後端放行 → 看板畫出來，請求帶 idToken、不帶 token', async ({ page }) => {
  const { logs, sent } = await open(page, 'attend.html', '?act=A1', {
    reply: (u) => (u.searchParams.get('action') === 'batch'
      ? { ok: true, results: { listActivities: { ok: true, rows: ROWS }, getActivityStats: STATS } }
      : STATS),
  });
  const txt = await visibleText(page);
  expect(txt).toContain('中秋餐會');
  expect(txt).toContain('（副總）');
  expect(sent.length).toBeGreaterThan(0);
  sent.forEach((s) => {
    expect(s).toContain('idToken=IDTOK');
    expect(s).not.toMatch(/[?&]token=/);
  });
  expect(pageErrors(logs)).toEqual([]);
  await page.screenshot({ path: 'test-results/e1b-attend-02-成功.png', fullPage: true });
});

test('🔴 attend ②後端現況（runBatch_ 子項吃空 token）→ 副總會看到「無權限或連結已失效」', async ({ page }) => {
  const deny = { ok: false, msg: '無權限或連結已失效。', reason: 'token_invalid' };
  const { logs } = await open(page, 'attend.html', '?act=A1', {
    reply: (u) => (u.searchParams.get('action') === 'batch'
      ? { ok: true, results: { listActivities: deny, getActivityStats: deny } }
      : deny),
  });
  const txt = await visibleText(page);
  console.log('【attend 後端現況】畫面：', txt.slice(0, 300));
  expect(txt).toContain('無權限或連結已失效');
  expect(pageErrors(logs)).toEqual([]);
  await page.screenshot({ path: 'test-results/e1b-attend-03-後端子項守門未改.png', fullPage: true });
});

test('attend ②外層被擋（line_unbound）→ 後端那句話畫在畫面上', async ({ page }) => {
  const msg = '您的 LINE 帳號還沒有完成員工身分綁定，所以系統認不出您是誰。請先回 LINE 完成綁定，再開啟這一頁。';
  const { logs } = await open(page, 'attend.html', '?act=A1', { reply: () => ({ ok: false, msg, reason: 'line_unbound' }) });
  expect(await visibleText(page)).toContain(msg.slice(0, 14));
  expect(pageErrors(logs)).toEqual([]);
  await page.screenshot({ path: 'test-results/e1b-attend-04-未綁定.png', fullPage: true });
});

test('attend ①舊連結 → 帶 token、不碰 LIFF 登入、不帶 idToken，照常畫出來', async ({ page }) => {
  const { logs, sent } = await open(page, 'attend.html', '?t=STUBTOKEN&act=A1', {
    liff: { loggedIn: false },   // 故意給「沒登入」：舊路若碰了 LIFF 就會被導去登入
    reply: (u) => (u.searchParams.get('action') === 'batch'
      ? { ok: true, results: { listActivities: { ok: true, rows: ROWS }, getActivityStats: STATS } }
      : STATS),
  });
  expect(await page.evaluate(() => window.__liffLoginCalled)).toBeFalsy();
  expect(sent.length).toBeGreaterThan(0);
  sent.forEach((s) => { expect(s).toContain('token=STUBTOKEN'); expect(s).not.toContain('idToken='); });
  expect(await visibleText(page)).toContain('中秋餐會');
  expect(pageErrors(logs)).toEqual([]);
});

/* ══ checkin.html ═════════════════════════════════════════════════════ */

test('checkin ②登入成功 → 報到數字畫出來，請求帶 idToken 與 act', async ({ page }) => {
  const { logs, sent } = await open(page, 'checkin.html', '?act=A1', { reply: () => ({ ok: true, stats: BOARD }) });
  expect(await visibleText(page)).toContain('已到 5 / 9');
  expect(sent[0]).toContain('idToken=IDTOK');
  expect(sent[0]).toContain('act=A1');
  expect(sent[0]).not.toMatch(/[?&]token=/);
  expect(pageErrors(logs)).toEqual([]);
  await page.screenshot({ path: 'test-results/e1b-checkin-01-成功.png', fullPage: true });
});

test('checkin ②LIFF 元件沒載入 → 紅字說明、不發請求，而且「載入中…」不留在畫面上', async ({ page }) => {
  const { logs, sent } = await open(page, 'checkin.html', '?act=A1', { liff: null });
  const txt = await visibleText(page);
  expect(txt).toContain('LINE 的元件沒有載入成功');
  expect(txt, '紅字下面還寫著「載入中…」＝那句是假話').not.toContain('載入中');
  expect(sent).toEqual([]);
  await page.getByRole('button', { name: '立即刷新' }).click();
  await page.waitForTimeout(300);
  expect(sent, '按「立即刷新」繞過了身分確認').toEqual([]);
  expect(pageErrors(logs)).toEqual([]);
  await page.screenshot({ path: 'test-results/e1b-checkin-02-元件沒載入.png', fullPage: true });
});

test('checkin 沒有 ?act= → 「連結缺少參數」，不先去 LINE 登入一趟', async ({ page }) => {
  const { logs, sent } = await open(page, 'checkin.html', '', { liff: { loggedIn: false } });
  expect(await visibleText(page)).toContain('連結缺少參數');
  expect(await page.evaluate(() => window.__liffLoginCalled)).toBeFalsy();
  expect(sent).toEqual([]);
  expect(pageErrors(logs)).toEqual([]);
});
