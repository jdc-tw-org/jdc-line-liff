/**
 * 🪦 `board.html` 的 `?t=` 舊路已經停用（`jdc-tw-org/jdc-line-gas#99`，2026-09-18）。
 *
 * 🔴 **為何非在真瀏覽器看不可**：單元測試（tests/board-token-retired.test.js）量得到
 *    「送出去的網址沒有 token」，但量不到這三件事，而它們正是使用者唯一看得到的部分：
 *      ① **網址列真的變了嗎**——假 DOM 裡的 `history.replaceState` 是我自己寫的替身，
 *         它必然照我寫的做。真瀏覽器才有真的 History API。
 *      ② **那句話真的畫出來了嗎**——`hidden`／CSS 優先序這一類的坑靜態檢查抓不到
 *         （line-messages 那一顆就是：單元測試斷言 `hidden === true` 全綠，
 *          而按鈕在畫面上還在）。
 *      ③ **舊書籤的人最後真的看得到這一頁嗎**——那要整條路跑完。
 *
 * ⚠️ 儀器早於事件：`page.route()` 與 `addInitScript()` 一律在 `goto()` 之前。
 */
const { test, expect } = require('@playwright/test');

/**
 * 🔴 **真的 LIFF SDK 必須擋掉，否則替身會被它覆蓋**（理由逐字同 board-e1a.spec.js：
 *    `<script src=…sdk.js>` 隨後載入並覆寫 `window.liff`，於是頁面拿真 SDK 去打 LINE，
 *    失敗長得像「我的頁面壞了」，其實是量具缺席）。
 */
async function blockLiffCdn(page) {
  await page.route(/static\.line-scdn\.net/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
}

function liffStub({ loggedIn = true, idToken = 'IDTOK', sub = 'U_sub_1' } = {}) {
  return `window.__liffCalls = [];
  window.liff = {
    init: function(){ window.__liffCalls.push('init'); return Promise.resolve(); },
    isLoggedIn: function(){ return ${loggedIn}; },
    getIDToken: function(){ return ${JSON.stringify(idToken)}; },
    getDecodedIDToken: function(){ return { sub: ${JSON.stringify(sub)} }; },
    login: function(o){ window.__liffCalls.push('login');
                        window.__liffLoginRedirect = (o && o.redirectUri) || ''; },
    logout: function(){ window.__liffCalls.push('logout'); },
    closeWindow: function(){}, openWindow: function(){},
    getOS: function(){ return 'ios'; }, isInClient: function(){ return true; },
    getVersion: function(){ return '2.0.0'; }
  };`;
}

/** 開頁，並把每一發打 /exec 的網址記下來。 */
async function open(page, { search = '', liff = {} } = {}) {
  const sent = [];
  const logs = [];
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  await blockLiffCdn(page);
  await page.addInitScript(liffStub(liff));
  await page.route(/script\.google\.com/, async (route) => {
    sent.push(route.request().url());
    await route.fulfill({ status: 200, contentType: 'application/javascript',
      body: 'cb({"ok":true,"getCheckinOptions":{"ok":true},"getCheckinPending":{"ok":true,"items":[]},'
        + '"getHrPending":{"ok":true,"items":[]},"getAnniversaries":{"ok":true,"items":[]}})' });
  });
  await page.goto('/board.html' + search);
  await page.waitForTimeout(1500);
  return { sent, logs };
}

test('🪦 帶 ?t= → 網址列上的 t 不見了、那句話畫得出來、而且照樣走 LINE 登入', async ({ page }) => {
  const { sent, logs } = await open(page, { search: '?t=OLD_BOOKMARK_TOKEN&mt=MT9' });

  // ① 網址列（真的 History API，不是替身）
  const url = page.url();
  expect(url, '網址列上還帶著那串 token').not.toContain('OLD_BOOKMARK_TOKEN');
  expect(url, '順手把別的參數也弄掉了').toContain('mt=MT9');

  // ② 那句話**真的看得到**（不是只存在於 DOM 裡）
  const box = page.locator('#legacy-t');
  await expect(box).toBeVisible();
  await expect(box).toContainText('改用 LINE 登入');

  // ③ 真的走了 LINE 那條路
  expect(await page.evaluate(() => window.__liffCalls)).toContain('init');

  // ④ 一發都不准帶 token ⇒ ⬛ 對照組是「有發車，而且帶 idToken」，
  //    否則「沒有 token」也可能只是因為整頁根本沒動。
  expect(sent.length, '一發都沒送出去 ⇒ 下面那個 0 沒有鑑別力').toBeGreaterThan(0);
  expect(sent.filter((u) => /[?&]token=/.test(u)), '還在送 token').toEqual([]);
  expect(sent.filter((u) => /[?&]idToken=IDTOK/.test(u)).length).toBeGreaterThan(0);

  expect(logs.filter((l) => l.startsWith('[pageerror]'))).toEqual([]);
  await page.screenshot({ path: 'test-results/99-舊連結進來的樣子.png', fullPage: true });
});

test('⬛ 對照組：不帶 ?t= → 沒有那句話（證明上面那條不是恆真）', async ({ page }) => {
  await open(page, { search: '' });
  await expect(page.locator('#legacy-t')).toHaveCount(0);
  expect(await page.evaluate(() => window.__liffCalls)).toContain('init');
});

test('🔴🪦 還沒登入時帶 ?t= → liff.login 的 redirectUri 不含那串 token', async ({ page }) => {
  await open(page, { search: '?t=OLD_BOOKMARK_TOKEN', liff: { loggedIn: false } });
  const redirect = await page.evaluate(() => window.__liffLoginRedirect);
  expect(redirect, '沒有去登入').toBeTruthy();
  expect(redirect, 'token 被原封不動送進 LINE 的轉址鏈').not.toContain('OLD_BOOKMARK_TOKEN');
  // ⬛ 對照組：回得來的網址仍然是本頁（不是把人導去別的地方）
  expect(redirect).toContain('/board.html');
});
