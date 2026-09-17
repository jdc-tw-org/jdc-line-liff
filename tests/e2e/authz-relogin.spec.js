/**
 * `authz.html` 的「憑證死掉之後會發生什麼」——**分兩條路**的 e2e（gas `#143`，2026-09-17）。
 *
 * ══ 為什麼這一檔非得是 e2e 不可 ═══════════════════════════════════════════
 *
 * 這一頁與其他已接上自動重登的頁面差在一格：**它手上有使用者還沒送出的輸入**
 * （`草稿`，純記憶體變數）。而「自動重登」做的事是 `liff.login()` ＝**整頁導走**
 * ⇒ 草稿沒了，**而且畫面上一句錯誤訊息都沒有**。
 *
 * 🔴 **這一格在 vm／假 DOM 那一層是量不到的**：那裡的 `liff.login` 是個什麼都不做的
 *    替身，**沒有導頁，草稿永遠還在** ⇒ 在那一層寫「草稿還在」的斷言會是**恆真**，
 *    把接錯線的版本一起放過去。所以本檔的 `liff.login` 替身做的是**真的整頁導向**
 *    （`location.assign`），計數器住在 `sessionStorage` 以便**活過那一次導向**。
 *
 * ⚠️ **本檔驗不到「LINE 真的收下這次轉址並發了一顆新憑證」**——那要真人在正式網域
 *    登入一次，不在自動測試涵蓋範圍內。本檔量到的是「這一頁有沒有發動重登」，
 *    以及「發動的時候他的草稿還在不在」。
 *
 * ══ 這一檔在守什麼 ═══════════════════════════════════════════════════════
 *
 *   ① 首載憑證死 ⇒ **自動**重登一次，回原頁、保住 query
 *   ② 同一次造訪的第二次 ⇒ **不再自動導頁**，改講實話
 *   ③ 🔴 檢查／存檔憑證死 ⇒ **不自動**、草稿仍在、給一顆鈕、**而且先講代價**
 *   ④ 那句代價（「這份草稿會不見」）本身——它是他決定要不要按的唯一依據
 *
 * ⬛ **每一條「草稿還在」都配一條「草稿不見了」**（`⬛ 對照：整頁導走`），
 *    否則「還在」分不出是受測物做對了、還是這支測試根本沒在量。
 */
const { test, expect } = require('@playwright/test');

/* ══════════════════════════════════════════════════════════════════════
 * 夾具。⚠️ **全部是假的**（本 repo 是公開的）：內部碼是用內部碼字母表造的假碼、
 * 姓名是「測試甲／乙／丙」。一格真實資料都沒有。
 * ══════════════════════════════════════════════════════════════════════ */

const 甲 = 'JDC-BBBBBB', 乙 = 'JDC-CCCCCC';
/** 🔴 **只可能因為「他按了加進草稿」才會出現在草稿裡**——這就是那把尺。 */
const 標記碼 = 'JDC-ZZZZZZ';
const HDR = ['內部碼', '角色', '狀態', '授予日', '停用日', '備註', '姓名'];

const 名單 = () => ({
  ok: true, who: '測試甲', header: HDR.slice(),
  rows: [[甲, 'admin', '有效', '2026-09-01', '', '', '測試甲'],
         [乙, 'hr', '有效', '2026-09-01', '', '', '測試乙']],
  roster: [{ code: 甲, name: '測試甲' }, { code: 乙, name: '測試乙' },
           { code: 標記碼, name: '測試丙' }],
  rosterCollisions: [],
  assignableRoles: ['admin', 'hr', 'activity', 'hrstats', 'messaging'],
  statusValues: ['有效', '停用'],
  current: { pass: true, rowCount: 2, adminCount: 1 },
});
/** 後端 `GATE_REJECT` 裡「重新登入會有用」的那一類。 */
const 死憑證 = { ok: false, reason: 'line_bad_token',
  msg: '您的 LINE 登入憑證已經過期。請關掉這一頁重新開啟以重新登入。' };
/** ⬛ 對照用：重新登入對它**永遠沒有用**的那一類。 */
const 重登沒用的 = { ok: false, reason: 'role_mismatch', msg: '您沒有這個功能的權限。' };
const 檢查通過 = { ok: true, pass: true, rowCount: 3, adminCount: 1, changes: ['新增一列'] };
const 存檔成功 = { ok: true, rowCount: 3, adminCount: 1, changes: ['新增一列'],
  logged: true, logSheet: '異動紀錄' };

/**
 * 掛好攔截再開頁面。**儀器一律早於被測事件**：route 與 initScript 都在 goto 之前。
 *
 * @param {object} [o.回應]  action → 物件｜函式(第幾次)
 * @param {string} [o.網址]  預設 `/authz.html`
 * @param {boolean} [o.試過了] 先把防迴圈旗標種好（＝模擬「這次造訪已經自動重登過一次」）
 */
async function open(page, o) {
  o = o || {};
  const gas = [];
  // 🔴 真 SDK 一律擋掉：e2e 不可以真的去打 LINE，而且它在 127.0.0.1 上 `init()`
  //    一定失敗（endpoint 註冊的是正式網域）⇒ 會拿到一個跟受測物無關的失敗。
  //    ⚠️ 用 RegExp 不用 glob：`**static.line-scdn.net/**` 這種寫法**對不上**，
  //       而對不上的後果是**真的 SDK 被載進來**、把整頁換掉——看起來像產品壞了。
  await page.route(/static\.line-scdn\.net/, (r) => r.abort('failed'));
  await page.route(/script\.google\.com/, (r) => {
    const body = String(r.request().postData() || '');
    const act = (body.match(/(?:^|&)action=([^&]*)/) || [])[1] || '';
    gas.push(act);
    let v = (o.回應 || {})[act];
    if (v === undefined) v = 名單();
    if (typeof v === 'function') v = v(gas.filter((x) => x === act).length);
    r.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8',
      body: 'cb(' + JSON.stringify(v) + ')' });
  });
  // 🔴 計數器住 sessionStorage：`liff.login` 的替身做的是**真的整頁導向**，
  //    記在 `window` 上的東西會跟著那一次導向一起消失。
  await page.addInitScript((試過了) => {
    const bump = (k) => {
      try { sessionStorage.setItem(k, String(Number(sessionStorage.getItem(k) || 0) + 1)); } catch (e) {}
    };
    if (試過了) { try { sessionStorage.setItem('JDC_RELOGIN_TRIED', '1'); } catch (e) {} }
    window.liff = {
      init: () => Promise.resolve({}),
      isLoggedIn: () => true,
      getIDToken: () => ('eyJhbGciOiJIUzI1NiJ9.' + 'A'.repeat(900) + '.c2lnbmF0dXJl'),
      logout: () => bump('T143_logout'),
      login: (a) => {
        bump('T143_login');
        const u = (a && a.redirectUri) || location.href;
        try { sessionStorage.setItem('T143_redirect', u); } catch (e) {}
        location.assign(u);                 // **真的**導走
      },
      isInClient: () => false, closeWindow: () => {}, openWindow: () => {},
    };
  }, !!o.試過了);

  await page.goto(o.網址 || '/authz.html');
  return { gas };
}

/** 重登相關的所有副作用，一次讀回來。導頁之後仍然讀得到（住在 sessionStorage）。 */
async function 副作用(page) {
  return page.evaluate((m) => ({
    logout: Number(sessionStorage.getItem('T143_logout') || 0),
    login: Number(sessionStorage.getItem('T143_login') || 0),
    redirect: sessionStorage.getItem('T143_redirect') || '',
    草稿裡有標記: JSON.stringify(window['草稿'] || []).indexOf(m) >= 0,
    草稿列數: (window['草稿'] || []).length,
    有重登鈕: !!document.getElementById('relogin'),
    面板: (document.getElementById('panel') || {}).textContent || '',
    覆蓋層: (document.getElementById('relogin-overlay') || {}).textContent || '',
  }), 標記碼);
}

/** 名單畫出來了才算開始——畫不出來的話下面每一條都是在驗沒發生的事。 */
async function 等名單(page) {
  await expect(page.locator('#list')).toContainText('測試甲');
}

/** 他「加了一列還沒存」。走這一頁真的那條路（選人 → 按加進草稿）。 */
async function 加一列還沒存(page) {
  await page.selectOption('#newcode', 標記碼);
  await page.locator('#add').click();
  const 加了 = await page.evaluate((m) => JSON.stringify(window['草稿'] || []).indexOf(m) >= 0, 標記碼);
  expect(加了, '⬛ 零點：草稿根本沒被加進去 ⇒ 這一輪什麼都沒測到').toBe(true);
}

/* ══════════════════════════════════════════════════════════════════════
 * ⬛ 零點與對照：這把尺回得出「草稿不見了」
 * ══════════════════════════════════════════════════════════════════════ */

test('⬛ 對照：整頁導走 ⇒ 草稿真的不見了（證明下面每一句「草稿還在」不是恆真）', async ({ page }) => {
  await open(page, {});
  await 等名單(page);
  await 加一列還沒存(page);
  await page.evaluate(() => location.assign(location.href));
  await 等名單(page);
  const s = await 副作用(page);
  expect(s.草稿裡有標記,
    '⬛ 整頁導走之後草稿竟然還在 ⇒ 這把尺量不到「被洗掉」，本檔所有 KEPT 都不算數').toBe(false);
});

test('⬛ 對照：什麼都不做 ⇒ 草稿留著（尺也不是恆假）', async ({ page }) => {
  await open(page, {});
  await 等名單(page);
  await 加一列還沒存(page);
  const s = await 副作用(page);
  expect(s.草稿裡有標記).toBe(true);
  expect(s.logout).toBe(0);
});

/* ══════════════════════════════════════════════════════════════════════
 * ① 首載憑證死 ⇒ **自動**重登一次（這一刻還沒有草稿，沒有東西可以損失）
 * ══════════════════════════════════════════════════════════════════════ */

test('🔴 首載憑證死 ⇒ 自動登出＋登入（不是停在紅字等他自己按）', async ({ page }) => {
  await open(page, { 回應: { getAuthzList: 死憑證 } });
  await page.waitForTimeout(1500);
  const s = await 副作用(page);
  expect(s.logout, '🔴 首載憑證死卻沒有自動重登 ⇒ 這一頁又變回死巷').toBe(1);
  expect(s.login).toBe(1);
});

test('⬛ 首載憑證死 ⇒ 回的是原本那一頁，而且 query 一個字都沒掉', async ({ page }) => {
  await open(page, { 回應: { getAuthzList: 死憑證 }, 網址: '/authz.html?probe=T143&mt=xyz' });
  await page.waitForTimeout(1500);
  const s = await 副作用(page);
  expect(s.redirect).toContain('/authz.html');
  expect(s.redirect, '🔴 query 掉了 ⇒ 他回來之後看到的是另一個畫面').toContain('probe=T143');
  expect(s.redirect).toContain('mt=xyz');
});

test('🔴 同一次造訪的第二次 ⇒ 不再自動導頁，改講實話（不是迴圈）', async ({ page }) => {
  await open(page, { 回應: { getAuthzList: 死憑證 }, 試過了: true });
  await page.waitForTimeout(1500);
  const s = await 副作用(page);
  expect(s.logout, '🔴 第二次還在自動登出 ⇒ 它自己就是那個迴圈').toBe(0);
  expect(s.覆蓋層).toContain('已經自動幫您重新登入過一次');
});

test('⬛ 對照：首載的代號是「重登沒有用」的那一類 ⇒ 不重登（尺不是一律重登）', async ({ page }) => {
  await open(page, { 回應: { getAuthzList: 重登沒用的 } });
  await page.waitForTimeout(1500);
  const s = await 副作用(page);
  expect(s.logout).toBe(0);
  expect(s.login).toBe(0);
});

/* ══════════════════════════════════════════════════════════════════════
 * ③ 🔴 有草稿的時候**不自動**——這是整件事的目的
 * ══════════════════════════════════════════════════════════════════════ */

test('🔴 編到一半按檢查・憑證死 ⇒ 草稿還在、而且沒有任何自動導頁', async ({ page }) => {
  await open(page, { 回應: { checkAuthzDraft: 死憑證 } });
  await 等名單(page);
  await 加一列還沒存(page);
  await page.locator('#check').click();
  await page.waitForTimeout(1500);
  const s = await 副作用(page);
  // 🔴 **草稿那一格先斷言**：它才是這件事的目的。`logout` 放後面是因為它是成因，
  //    先斷言成因的話，突變時紅的會是成因那一句，而「草稿有沒有被洗掉」就一次都沒被跑到。
  expect(s.草稿裡有標記,
    '🔴 他加的那一列不見了——而且畫面上一句錯誤訊息都沒有（這就是自動重登洗掉草稿的樣子）').toBe(true);
  expect(s.logout, '🔴 自動重登在這一刻發動了 ⇒ 他還沒存的東西會被整頁導向洗掉').toBe(0);
});

test('🔴 編到一半按檢查・憑證死 ⇒ 給他一顆鈕，而且**先講代價**', async ({ page }) => {
  await open(page, { 回應: { checkAuthzDraft: 死憑證 } });
  await 等名單(page);
  await 加一列還沒存(page);
  await page.locator('#check').click();
  await expect(page.locator('#relogin'),
    '🔴 憑證死了卻連鈕都沒有 ⇒ 他草稿看得見、存不進去、而且沒有任何一條出路').toBeVisible();
  // 🔴 這句話是他決定要不要按的**唯一依據**——改掉它＝改掉他做決定的基礎。
  await expect(page.locator('#panel')).toContainText('這份草稿會不見');
});

test('🔴 存檔・憑證死（手上是**驗過的**那一份）⇒ 草稿還在、給鈕、先講代價', async ({ page }) => {
  await open(page, { 回應: { checkAuthzDraft: 檢查通過, saveAuthzList: 死憑證 } });
  await 等名單(page);
  await 加一列還沒存(page);
  await page.locator('#check').click();
  await expect(page.locator('#save'), '⬛ 零點：檢查沒過的話根本按不到存檔').toBeEnabled();
  await page.locator('#save').click();
  await page.waitForTimeout(1500);
  const s = await 副作用(page);
  expect(s.草稿裡有標記,
    '🔴 手上那一份**已經通過七道守恆、他看過 diff、按下去就要生效**的草稿不見了').toBe(true);
  expect(s.logout, '🔴 這一刻手上是已經通過七道守恆、按下去就要生效的那一份').toBe(0);
  expect(s.有重登鈕).toBe(true);
  expect(s.面板).toContain('這份草稿會不見');
});

test('⬛ 對照：檢查回「重登沒有用」的代號 ⇒ 不給鈕（那顆鈕對他永遠沒用）', async ({ page }) => {
  await open(page, { 回應: { checkAuthzDraft: 重登沒用的 } });
  await 等名單(page);
  await 加一列還沒存(page);
  await page.locator('#check').click();
  await page.waitForTimeout(1000);
  const s = await 副作用(page);
  expect(s.有重登鈕, '⬛ 什麼代號都給鈕 ⇒ 上面那幾條就是「永遠在喊」').toBe(false);
  expect(s.面板).not.toContain('這份草稿會不見');
  expect(s.草稿裡有標記).toBe(true);
});

test('⬛ 對照：存檔成功 ⇒ 不重登、不給鈕（憑證是好的時候什麼都不該發生）', async ({ page }) => {
  await open(page, {
    回應: { checkAuthzDraft: 檢查通過, saveAuthzList: 存檔成功,
      // 存好之後這一頁會重新載入名單——那一份**已經含有他加的那一列**。
      getAuthzList: (n) => {
        const v = 名單();
        if (n > 1) v.rows.push([標記碼, 'hr', '有效', '2026-09-17', '', '', '測試丙']);
        return v;
      } },
  });
  await 等名單(page);
  await 加一列還沒存(page);
  await page.locator('#check').click();
  await expect(page.locator('#save')).toBeEnabled();
  await page.locator('#save').click();
  await expect(page.locator('#panel')).toContainText('已存檔');
  const s = await 副作用(page);
  expect(s.logout).toBe(0);
  expect(s.有重登鈕).toBe(false);
});

/* ══════════════════════════════════════════════════════════════════════
 * ④ 那顆鈕**還在、還能按、還有用**（它從「唯一的路」變成「自動失敗後的退路」，
 *    行為一行都沒改——所以這兩條的期望值改前改後相同）
 * ══════════════════════════════════════════════════════════════════════ */

test('🔴 有草稿那條路的鈕：按下去 ⇒ 真的先登出再登入，而且回原頁保 query', async ({ page }) => {
  await open(page, { 回應: { checkAuthzDraft: 死憑證 }, 網址: '/authz.html?probe=T143' });
  await 等名單(page);
  await 加一列還沒存(page);
  await page.locator('#check').click();
  await expect(page.locator('#relogin')).toBeVisible();
  await page.locator('#relogin').click();
  await page.waitForTimeout(1500);
  const s = await 副作用(page);
  expect(s.logout, '🔴 只 login 不 logout 的話，LINE 會帶著同一把過期憑證回來').toBe(1);
  expect(s.login).toBe(1);
  expect(s.redirect).toContain('probe=T143');
});

test('🔴 首載那條路的鈕：仍然畫得出來（自動重登失敗時它是唯一的人工退路）', async ({ page }) => {
  // 已經自動試過一次了 ⇒ 不會再自動導頁，這一刻鈕必須在。
  await open(page, { 回應: { getAuthzList: 死憑證 }, 試過了: true });
  await expect(page.locator('#relogin'),
    '🔴 自動那條走不通、而人工退路也被拆掉 ⇒ 這一頁就沒有任何出路了').toBeAttached();
  const s = await 副作用(page);
  // 首載那一刻**還沒有草稿** ⇒ 不該講「草稿會不見」（那句話在這裡是假的）。
  expect(s.面板).not.toContain('這份草稿會不見');
});
