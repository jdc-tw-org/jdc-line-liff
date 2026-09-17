/**
 * **分流頁 `me.html`：憑證過期時自動重新登入**（#114）。
 *
 * ══ 這一檔在證明什麼 ═════════════════════════════════════════════════════
 *
 * LINE 的 ID token 一小時就死，而 SDK 沒有續期機制（成因與一手實測見
 * `assets/liff-relogin.js` 檔頭）。死掉之後 `liff.isLoggedIn()` **仍然是 `true`**、
 * `getIDToken()` 交回**同一顆死的** ⇒ 各頁的 `if (!isLoggedIn()) login()` 整條被跳過
 * ⇒ 後端回 `line_bad_token` ⇒ 分流頁給一段叫人去找資訊人員的紅字。
 *
 * ⚠️ **零點是這一檔的地基**：改動之前，同一支 spec 必須真的看到那段紅字。
 *    看不到就代表這個重現根本沒構造出來，後面每一條的綠燈都不值得解讀。
 *
 * ══ 🔴 為什麼可以在測試裡「重新登入」而不會真的登入 ═══════════════════════
 *
 * `liff.login()` 在真實世界是**整頁導去 `access.line.me`**。這裡：
 *   ① LIFF SDK 那個 `<script src>` 被 `page.route` 換成本檔自己的替身，
 *      替身的 `login()` **只記錄、不導頁**；
 *   ② 另外仍然把 `access.line.me`／`line.me` 整個 abort 掉——
 *      ⬛ 那是**第二道**，不是主要防線：萬一替身沒裝上（路由沒命中、檔名變了），
 *      症狀會是「測試逾時」而不是「真的送出一次 LINE 登入」。
 *   ③ 所有外部請求（GAS 在內）一律 `route` 接走，**零外部流量**。
 *
 * ══ ⚠️ port 不是預設的 4173 ═════════════════════════════════════════════
 *
 * 4173 是這個 repo 所有工作樹**共用**的號碼，而同一時間常有好幾個工作樹在跑。
 * `reuseExistingServer` 沒開的話撞 port 會死得很明顯，開了則會**靜默去測別人的樹**。
 * ⇒ 本檔配一份自己的 playwright 設定（`baseURL` 與 `webServer.url` **兩格都要換**，
 *   只設 `E2E_PORT` 是不夠的），而且第一條測試就用 md5 證明
 *   **伺服器送出來的 `me.html` 就是磁碟上這一份**。
 */
const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..', '..');

/* ══ 後端那幾句話（取自 `jdc-line-gas` `roles.js` @ 01f484c 的 GATE_MSG_LINE） ══
 *
 * ⚠️ 這是**手抄的副本**，與 `deny-no-role.js`／`liff-relogin.js` 那兩份同樣的弱點：
 *    沒有任何機械的東西逼它與後端相等。但本檔真正在斷言的是
 *    **「哪些 `reason` 會觸發重登」**，文案只是拿來當畫面上找得到的字串
 *    ⇒ 後端改文案不會讓這裡靜默失效（找不到字串是紅的，不是綠的）。
 */
const 紅字_憑證過期 = '您的 LINE 登入憑證已經過期，系統沒辦法確認您的身分。'
  + '重新整理或關掉這一頁重新開啟都不會解決（LINE 不會因此換一組新的憑證），'
  + '請聯絡資訊人員。';

/**
 * 🔴 **重登解決不了的那八句。** `GATE_REJECT` 一共十個代號，
 *    「重新登入會有用」的只有 `line_bad_token`／`line_no_token` 兩個。
 *    對其餘八個登出＋登入 ⇒ 回來還是同一個結果 ⇒ **無限導頁迴圈**，
 *    而且他永遠看不到那句真正該看的話。
 */
const 重登沒用的八個 = [
  ['role_mismatch', '您的身分沒有這一頁的權限。'],
  ['role_unresolved', '系統算不出您的角色。'],
  ['token_invalid', '無權限或連結已失效。'],
  ['token_ambiguous', '這個連結對應到不只一位。'],
  ['line_upstream', '系統目前無法確認您的身分（不是您的問題）。'],
  ['line_unbound', '您的 LINE 帳號還沒有完成員工身分綁定。'],
  ['line_ambiguous', '您的綁定資料有重複的紀錄。'],
  ['line_needs_sheet', '這一頁的 LINE 登入目前暫停使用，請改用原本的連結。'],
];

/** base64url（JWT 用的那種，去掉 `=` 並換掉兩個字元）。 */
function b64u(s) {
  return Buffer.from(s, 'utf8').toString('base64')
    .replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

/**
 * 造一顆 JWT 形狀的 ID token。**payload 是真的、簽章是假的**——
 * 前端只讀 payload（`getDecodedIDToken` 就是 base64 解碼），不驗簽。
 * @param {number} expSec 到期時間（Unix 秒）
 */
function 造ID(expSec) {
  return b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' })) + '.'
    + b64u(JSON.stringify({ sub: 'Uzzz_test_only', exp: expSec, iss: 'https://access.line.me' }))
    + '.sig_not_real';
}

const 已過期 = () => 造ID(Math.floor(Date.now() / 1000) - 3600);
const 還很新 = () => 造ID(Math.floor(Date.now() / 1000) + 3600);

/** LIFF SDK 的替身。**`login()` 只記錄、不導頁。** */
const SDK替身 = `
(function () {
  var cfg = window.__LIFF_STUB || {};
  window.__liffCalls = { init: 0, logout: 0, login: 0 };
  function decode(t) {
    try {
      var p = String(t).split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(decodeURIComponent(escape(atob(p))));
    } catch (e) { return null; }
  }
  var 憑證 = cfg.idToken;
  window.liff = {
    init: function () { window.__liffCalls.init++; return Promise.resolve({}); },
    isLoggedIn: function () { return cfg.loggedIn !== false; },
    getIDToken: function () { return 憑證 || null; },
    logout: function () { window.__liffCalls.logout++; 憑證 = null; },
    login: function (a) {
      window.__liffCalls.login++; window.__liffLoginArgs = a;
      /* 🔴 刻意什麼都不做。真的 SDK 會整頁導走，那會讓測試變成在測 LINE。 */
    },
    isInClient: function () { return false; },
    getProfile: function () { return new Promise(function () {}); },
  };
  if (!cfg.noDecoded) {
    window.liff.getDecodedIDToken = function () { return 憑證 ? decode(憑證) : null; };
  }
})();
`;

/**
 * 把一頁架起來：替身 SDK、假後端、零外部流量。
 * @returns {{gas:Array}} `gas` 是後端**實際被打到幾次、帶什麼 body** 的紀錄
 *          ——「擋在打後端之前」這件事只能靠它證明。
 */
async function 架好(page, { idToken, loggedIn = true, noDecoded = false, reply }) {
  const gas = [];
  await page.addInitScript(
    ([t, l, n]) => { window.__LIFF_STUB = { idToken: t, loggedIn: l, noDecoded: n }; },
    [idToken, loggedIn, noDecoded]);

  await page.route('**://static.line-scdn.net/**', (r) =>
    r.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: SDK替身 }));
  await page.route('**://script.google.com/**', (r) => {
    gas.push({ body: r.request().postData() || '' });
    return r.fulfill({
      status: 200, contentType: 'text/javascript; charset=utf-8',
      body: 'cb(' + JSON.stringify(reply) + ')',
    });
  });
  // ⬛ 第二道：真的導去 LINE 登入的話，這裡會把它擋下來 ⇒ 症狀是逾時，不是送出。
  await page.route('**://access.line.me/**', (r) => r.abort());
  return { gas };
}

/** 等頁面把該畫的畫完（`start()` → `load()` → `render`／`showMsg` 都是微任務鏈）。 */
async function 畫完(page) {
  await page.waitForFunction(() => {
    const l = document.getElementById('list');
    const w = document.getElementById('who');
    return (l && l.innerHTML.trim() !== '')
      || (w && w.textContent.indexOf('確認身分中') === -1)
      || !!window.__liffCalls?.login;
  }, null, { timeout: 10000 });
}

const 呼叫 = (page) => page.evaluate(() => window.__liffCalls);

/* ══ ⬛ 零點之零：伺服器服務的是**我這棵樹** ═══════════════════════════════ */

test('⬛ 伺服器送出來的 me.html＝磁碟上這一份（md5 相等）', async ({ request }) => {
  const 線上 = await (await request.get('/me.html')).text();
  const 磁碟 = fs.readFileSync(path.join(ROOT, 'me.html'), 'utf8');
  const md5 = (s) => crypto.createHash('md5').update(s, 'utf8').digest('hex');
  // 🔴 這一條答不出來時，底下每一條的紅綠都在講別人的工作樹。
  expect(md5(線上), '伺服器服務的不是這個工作樹 ⇒ 換一個 port 重跑').toBe(md5(磁碟));
});

/* ══ 🔴 零點／受測：憑證已過期，但 isLoggedIn() 仍是 true ═════════════════ */

test('🔴 憑證過期（isLoggedIn 仍為 true）→ 自動重新登入，不給紅字', async ({ page }) => {
  const { gas } = await 架好(page, {
    idToken: 已過期(),
    reply: { ok: false, reason: 'line_bad_token', msg: 紅字_憑證過期 },
  });
  await page.goto('/me.html');
  await 畫完(page);

  const c = await 呼叫(page);
  // 🔴 唯一真的能換一把新憑證的路：先 logout（SDK 裡唯一會移除 ID token 的地方）再 login。
  expect(c.logout, '沒有登出 ⇒ 回來還是同一把死憑證').toBe(1);
  expect(c.login, '沒有重新登入').toBe(1);
  // 🔴 **擋在打後端之前**：後端一次都不該被打到。
  expect(gas.length, '還是先打了後端 ⇒ 前置檢查沒有擋在紅字之前').toBe(0);

  const 畫面 = await page.evaluate(() => document.body.innerText);
  expect(畫面, '自動重登了卻還是給了那段紅字').not.toContain('請聯絡資訊人員');
  expect(畫面).not.toContain('您的 LINE 登入憑證已經過期');
});

test('🔴 憑證過期但**這次造訪已經自動重登過一次** → 不再導頁（迴圈封頂）', async ({ page }) => {
  // 🔴 這一條守的是「自動登出＋自動登入本身就是一個迴圈的形狀」。旗標在
  //    `liff-relogin.js` 的 sessionStorage 裡，前置檢查與解析出口**共用同一格**；
  //    這裡先把它種好，模擬「登入回來了，憑證卻還是不被接受」。
  const { gas } = await 架好(page, {
    idToken: 已過期(),
    reply: { ok: false, reason: 'line_bad_token', msg: 紅字_憑證過期 },
  });
  await page.addInitScript(() => { try { sessionStorage.setItem('JDC_RELOGIN_TRIED', '1'); } catch (e) {} });
  await page.goto('/me.html');
  await 畫完(page);

  const c = await 呼叫(page);
  expect(c.logout, '第二次還是自動登出 ⇒ 無限迴圈').toBe(0);
  expect(c.login, '第二次還是自動登入 ⇒ 無限迴圈').toBe(0);
  expect(gas.length, '應該照常打後端，讓它去講「已經試過一次」那句實話').toBe(1);
  // 不再叫他做任何做不到的事（那句話的本體在 `liff-relogin.js`）。
  await expect(page.locator('#relogin-overlay')).toContainText('已經自動幫您重新登入過一次');
});

/* ══ ⬛ 對照組①：憑證正常 ⇒ 不得重登 ═════════════════════════════════════ */

test('⬛ 對照組①：憑證正常 → 一次都不重登，清單照畫', async ({ page }) => {
  const { gas } = await 架好(page, {
    idToken: 還很新(),
    reply: { ok: true, who: '丁小恆', pages: [
      { page: 'board.html', title: '看板', lineReady: true },
      { page: 'line-messages.html', title: '訊息紀錄', lineReady: true },
    ] },
  });
  await page.goto('/me.html');
  await 畫完(page);

  const c = await 呼叫(page);
  // 🔴 這一格壞掉的樣子是「每次開頁都被導走一次」——而且每次都會自己回來，
  //    所以它不會當掉、只會讓每個人每次進來都多閃一次。
  expect(c.logout, '憑證好好的卻登出了').toBe(0);
  expect(c.login, '憑證好好的卻重新登入了').toBe(0);
  expect(gas.length, '後端沒被打到 ⇒ 這一輪根本沒走到受測的那條路').toBe(1);
  await expect(page.locator('#list a.card')).toHaveCount(2);
  await expect(page.locator('#who')).toHaveText('丁小恆');
});

/* ══ ⬛ 對照組②：真的沒有權限的人，行為不變 ═══════════════════════════════ */

test('⬛ 對照組②：沒有權限（role_mismatch）→ 不重登，該看的話照樣看得到', async ({ page }) => {
  const 話 = '您的身分沒有這一頁的權限，請聯絡系統維護者。';
  const { gas } = await 架好(page, {
    idToken: 還很新(),
    reply: { ok: false, reason: 'role_mismatch', msg: 話 },
  });
  await page.goto('/me.html');
  await 畫完(page);

  const c = await 呼叫(page);
  expect(c.logout).toBe(0);
  expect(c.login).toBe(0);
  expect(gas.length).toBe(1);
  await expect(page.locator('#list .msg-err')).toContainText(話);
  // 重登對他沒用 ⇒ 不給那顆鈕（`me.html` 的 `重登有用的` 白名單）。
  await expect(page.locator('#relogin')).toHaveCount(0);
});

/* ══ 🔴 ⬛ 對照組③：重登解決不了的那八句，一句都不許重登 ═══════════════════ */

for (const [reason, 話] of 重登沒用的八個) {
  test(`🔴 對照組③：${reason} → 不重登（重登會變成無限導頁迴圈）`, async ({ page }) => {
    const { gas } = await 架好(page, {
      idToken: 還很新(),
      reply: { ok: false, reason, msg: 話 },
    });
    await page.goto('/me.html');
    await 畫完(page);

    const c = await 呼叫(page);
    // ⬛ 對照：同一支 spec 的零點案例證明了「這把尺量得到重登」
    //    ⇒ 這裡的 0 不是「什麼都沒發生」，是真的沒有重登。
    expect(c.logout, reason + ' 竟然登出了 ⇒ 回來還是同一個答案 ⇒ 迴圈').toBe(0);
    expect(c.login, reason + ' 竟然重新登入了 ⇒ 迴圈').toBe(0);
    expect(gas.length).toBe(1);
    await expect(page.locator('#list .msg-err')).toContainText(話);
  });
}

/* ══ ⬛ 不弄壞既有：兩條既有的路 ═══════════════════════════════════════════ */

test('⬛ 既有：完全沒登入 → 照舊直接 login，不先登出', async ({ page }) => {
  const { gas } = await 架好(page, { idToken: null, loggedIn: false, reply: { ok: true, pages: [] } });
  await page.goto('/me.html');
  await 畫完(page);

  const c = await 呼叫(page);
  expect(c.login, '沒登入的人應該被送去登入').toBe(1);
  expect(c.logout, '沒登入還先登出 ⇒ 多一趟沒有意義的動作').toBe(0);
  expect(gas.length, '還沒登入就打後端').toBe(0);
});

test('⬛ 既有：SDK 舊到沒有 getDecodedIDToken → 不重登，照舊打後端', async ({ page }) => {
  // 🔴 方向是刻意的：**問不出到期時間時一律當成「沒過期」**。
  //    猜「過期」的代價是把每個人都導走一次；猜「沒過期」的代價只是退回改動前的行為
  //    （後端回 `line_bad_token`，由 `reloginOnDeadCredential` 接手）。
  const { gas } = await 架好(page, {
    idToken: 已過期(), noDecoded: true,
    reply: { ok: true, who: '丁小恆', pages: [] },
  });
  await page.goto('/me.html');
  await 畫完(page);

  const c = await 呼叫(page);
  expect(c.logout, '問不出 exp 卻自己認定過期 ⇒ 每個人都被導走一次').toBe(0);
  expect(gas.length, '沒有照舊把請求送出去').toBe(1);
});

test('⬛ 既有：`liff.init()` 那條沒有逾時的路不受影響（被拒絕時仍然講得出是哪一段）', async ({ page }) => {
  // 本票不修「init 永遠不結束」那個問題（#114 註明是另一件事），
  // 但改 `start()` 不許把**既有的 `.catch`** 弄壞——否則畫面會停在「確認身分中…」。
  await page.addInitScript(() => { window.__LIFF_STUB = { idToken: null }; });
  await page.route('**://static.line-scdn.net/**', (r) => r.fulfill({
    status: 200, contentType: 'text/javascript; charset=utf-8',
    body: `window.liff = { init: function () { return Promise.reject(new Error('BOOM_INIT')); },
                           isLoggedIn: function () { return true; } };`,
  }));
  await page.route('**://script.google.com/**', (r) => r.abort());
  await page.goto('/me.html');
  await 畫完(page);
  await expect(page.locator('#who')).toHaveText('確認身分時失敗');
  await expect(page.locator('#list .msg-err')).toContainText('BOOM_INIT');
});
