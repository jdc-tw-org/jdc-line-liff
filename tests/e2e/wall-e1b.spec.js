/**
 * wall.html（進場人數牆）的 E1b 畫面（2026-09-13）。
 *
 * 🔴 **為何非在真瀏覽器看不可**：單元測試（`wall-e1b-wiring.test.js`）釘的是
 *    「送出去的網址對、該擋的時候擋住」。它證明不了**畫面上真的出現那句話**，
 *    也證明不了**真的時鐘走過 15 秒之後**輪詢仍然守著閘門。
 *
 * ⚠️ 手法照 `attend-checkin-e1b.spec.js`／`stats-e1b.spec.js`：擋掉真的 LIFF SDK、
 *    在頁面 script 之前放替身、`page.route()` 在 `goto()` 之前（儀器早於事件）。
 *    輪詢用 `page.clock` 快轉，不真的等 15 秒。
 *
 * 🔴 本檔的每一條都：① 攔下所有 `/exec`（本機回應，請求出不了這台機器）；
 *    ② 攔下所有非本機的請求並記下來，斷言為空；③ 斷言「發送類 action」的請求數是 0。
 *    本頁本身沒有任何發送類 action——③是防「被改成會發」時沒有人知道。
 */
const { test, expect } = require('@playwright/test');

/** 發送類 action：按下去會有人的手機響（或排定之後會響）。與 stats-e1b.spec.js 同一份。 */
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
    logout: function(){ window.__liffLogoutCalled = (window.__liffLogoutCalled || 0) + 1; },
    closeWindow: function(){}, openWindow: function(){},
    getOS: function(){ return 'ios'; }, isInClient: function(){ return true; },
    getVersion: function(){ return '2.0.0'; }
  };`;
}

const WALL = {
  ok: true, actName: '中秋餐會', eventDate: '2026/09/20', at: '18:30',
  total: 3, arrived: 1, notArrived: 2, reveal: true,
  units: [{ name: '工務', total: 3, arrived: 1, notArrived: 2, cells: [{ a: true }, { a: false, n: '甲' }, { a: false, n: '乙' }] }],
};

async function open(page, search, { reply = () => WALL, liff = {} } = {}) {
  const logs = [], sent = [], external = [];
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  await page.clock.install();
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
  await page.goto('/wall.html' + search);
  await page.waitForTimeout(800);
  return { logs, sent, external };
}

/** 快轉假時鐘越過一次輪詢，再給真的網路回應一點時間。 */
async function pastOnePoll(page) {
  await page.clock.runFor(16000);
  await page.waitForTimeout(600);
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

function noLeak({ sent, external }) {
  expect(external, '有請求打到本機以外（應該全部被攔下）').toEqual(
    external.filter((u) => /static\.line-scdn\.net|script\.google\.com/.test(u)));
  expect(sendCount(sent), '測試裡送出了發送類 action：' + sent.join(' | ')).toBe(0);
}

test('⬛ 零點：sendCount 認得出單支與 batch 子項裡的發送類 action（否則「計數 0」恆真）', () => {
  expect(sendCount(['?action=sendPassBroadcast&actId=A1'])).toBe(1);
  expect(sendCount(['?action=batch&list=' + encodeURIComponent(JSON.stringify([{ a: 'grantRefill' }, { a: 'getArrivalWall' }]))])).toBe(1);
  expect(sendCount(['?action=getArrivalWall&actId=A1'])).toBe(0);
});

test('②LINE 登入成功 → 牆畫出來；15 秒後輪詢再發一發，每一發都帶 idToken、不帶 token', async ({ page }) => {
  const r = await open(page, '?act=A1');
  const txt = await visibleText(page);
  expect(txt).toContain('中秋餐會');
  expect(await page.locator('#nLeft').innerText()).toBe('2');
  expect(r.sent.length).toBe(1);
  await pastOnePoll(page);
  expect(r.sent.length, '15 秒輪詢沒有發車 ⇒ 下面「沒登入時輪詢也不發」零鑑別力').toBe(2);
  r.sent.forEach((s) => {
    expect(s).toContain('action=getArrivalWall');
    expect(s).toContain('idToken=IDTOK');
    expect(s).toContain('actId=A1');
    expect(s).not.toMatch(/[?&]token=/);
  });
  expect(pageErrors(r.logs)).toEqual([]);
  noLeak(r);
  await page.screenshot({ path: 'test-results/e1b-wall-01-LINE成功.png' });
});

test('🔴 ②還沒登入 → 去 LINE 登入（保留 ?act=），一個請求都沒送；時鐘走過 15 秒也不送', async ({ page }) => {
  const r = await open(page, '?act=A1', { liff: { loggedIn: false } });
  expect(await page.evaluate(() => window.__liffLoginCalled)).toContain('wall.html?act=A1');
  expect(await visibleText(page)).toContain('正在前往 LINE 登入');
  await pastOnePoll(page);
  expect(r.sent, '身分沒確認卻送出了請求').toEqual([]);
  expect(pageErrors(r.logs)).toEqual([]);
  noLeak(r);
  await page.screenshot({ path: 'test-results/e1b-wall-02-登入中.png' });
});

test('🔴 ②LIFF 元件沒載入 → 紅字說明、「載入中…」不留在畫面上；時鐘走過 15 秒也不送', async ({ page }) => {
  const r = await open(page, '?act=A1', { liff: null });
  const txt = await visibleText(page);
  expect(txt).toContain('LINE 的元件沒有載入成功');
  expect(txt, '紅字上面還寫著「載入中…」＝那句是假話').not.toContain('載入中');
  await pastOnePoll(page);
  expect(r.sent).toEqual([]);
  expect(pageErrors(r.logs)).toEqual([]);
  noLeak(r);
  await page.screenshot({ path: 'test-results/e1b-wall-03-元件沒載入.png' });
});

test('②後端回 line_bad_token → 真的登出＋重新登入一次，畫面說「正在自動重新登入」', async ({ page }) => {
  const r = await open(page, '?act=A1', {
    reply: () => ({ ok: false, msg: '登入憑證失效', reason: 'line_bad_token' }),
  });
  expect(await page.evaluate(() => window.__liffLogoutCalled)).toBe(1);
  expect(await page.evaluate(() => window.__liffLoginCalled)).toContain('wall.html?act=A1');
  expect(await visibleText(page)).toContain('正在自動重新登入');
  expect(pageErrors(r.logs)).toEqual([]);
  noLeak(r);
  await page.screenshot({ path: 'test-results/e1b-wall-04-憑證過期.png' });
});

test('②後端回 line_unbound → 不登出，後端那句話畫在畫面上', async ({ page }) => {
  const msg = '您的 LINE 帳號還沒有完成員工身分綁定，所以系統認不出您是誰。';
  const r = await open(page, '?act=A1', { reply: () => ({ ok: false, msg, reason: 'line_unbound' }) });
  expect(await page.evaluate(() => window.__liffLogoutCalled)).toBeFalsy();
  expect(await visibleText(page)).toContain(msg.slice(0, 14));
  expect(pageErrors(r.logs)).toEqual([]);
  noLeak(r);
});

test('①舊連結 → 帶 token、不碰 LIFF 登入、不帶 idToken，照常畫出來；輪詢那一發也一樣', async ({ page }) => {
  const r = await open(page, '?t=STUBTOKEN&act=A1', { liff: { loggedIn: false } });   // 故意給「沒登入」：舊路若碰了 LIFF 就會被導去登入
  expect(await page.evaluate(() => window.__liffLoginCalled)).toBeFalsy();
  expect(await visibleText(page)).toContain('中秋餐會');
  await pastOnePoll(page);
  expect(r.sent.length).toBe(2);
  r.sent.forEach((s) => { expect(s).toContain('token=STUBTOKEN'); expect(s).not.toContain('idToken='); });
  expect(pageErrors(r.logs)).toEqual([]);
  noLeak(r);
  await page.screenshot({ path: 'test-results/e1b-wall-05-舊連結.png' });
});
