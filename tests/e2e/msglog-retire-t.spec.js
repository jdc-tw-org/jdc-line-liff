/**
 * 🪦 `line-messages.html?t=` 那條路的退場（`jdc-tw-org/jdc-line-hub#27` 的 liff 側）。
 *
 * 🔴 **為何非在真瀏覽器看不可**：要證明的不是「程式有沒有呼叫」，是
 *    **握著舊連結的人眼睛看到什麼**。而會咬人的那一格正好在單元測試看不到的地方——
 *    手上有快取的人，舊紀錄先被畫出來 ⇒ `BATCHES.length` 非 0 ⇒ `settleRefresh`
 *    掛一行琥珀小字就**早退** ⇒ 停用訊息一個字都不會出現，他盯著一份不會再更新的舊紀錄。
 *    假 DOM 的單元測試量得到「msgEl.textContent 被設成什麼」，量不到
 *    「`adopt` 已經把 `#msg` 設成 `display:none`」。
 *
 * ⚠️ 儀器早於事件：`page.route()` 與 `addInitScript()` 一律在 `goto()` 之前。
 * 🔴 **快取怎麼種進去（這一格想錯過一次，記下來）**：第一版是「第一輪讓頁面自己存、第二輪再開」
 *    （`board-e1a.spec.js` 的手法）。**在這一票行不通**——拆掉之後帶 `?t=` 的頁面不再打後端，
 *    也就永遠不會存快取，第一輪等不到任何一把鍵。
 *    而真實情境本來就不是那樣：**那份快取是上線「之前」的舊版存下來的**，使用者上線後才開頁。
 *    ⇒ 改成直接呼叫頁面上那支 `cacheSave(token, name, resp)`——**與舊版存快取時呼叫的
 *      是同一支函式、同一組參數**（`cacheSave(FP, CACHE_NAME, res)`，`cfbe75f:line-messages.html:1028`），
 *      所以種出來的是逐位元相同的東西，不是一個長得像的替代品。
 *    ⬛ 種完一定要驗鍵真的在（下面每一處都等 `jdcBoard:` 鍵出現才往下走）——
 *      種不進去的話，「清掉了」與「根本沒種」在結果上完全一樣。
 * ⚠️ 127.0.0.1 是 secure context ⇒ `crypto.subtle` 在，board-cache 不會退化成「永遠沒有快取」。
 */
const { test, expect } = require('@playwright/test');

const HUB_ID = 'AKfycbwCMxy9K3A8ZE56yJrGW1C9ee1iZnsMRHosBygDHcm8qJD9UeyUINnRuh3aKX9QMqR8';
const GAS_ID = 'AKfycbxaDoA_7aOW325p8165VegSqdRL8gRhfTEMfjosdh1A0T4rmzj4Pl7F3k5PToe2po-xtg';

const H = ['發送時間', '平台', '來源', '對象UserID', '對象姓名', '對象單位',
           '訊息型別', '訊息內容', '附件', '結果', '錯誤', '批次'];
const ROWS = [['2026-09-01 10:00:00', 'line-platform', 'bind_success', 'U1', '塗小明', '工務部',
               'text', '綁定成功通知', '', '成功', '', 'b-1']];
const OK = { ok: true, who: '甲', header: H, rows: ROWS, logSince: '2026-08-19' };

/**
 * PR-A（`jdc-tw-org/jdc-line-hub#28`，commit `e71bde1`）定死的墓碑回應。
 * ⚠️ 逐字抄自那顆 commit 的 `GATE_MSG_MSGLOG_RETIRED`，**只當測試的輸入，不當判準**
 *    ——這一頁認不認得墓碑靠的是網址上有沒有 `t`，不是比對這串字（見頁面裡的註解）。
 *    鍵集合恰好 `{ok, msg}`：沒有 reason／rows／header／who／logSince。
 */
const TOMBSTONE = { ok: false,
  msg: '這個連結已經停用。請改用 LINE 登入的訊息紀錄頁（同一個網址，去掉 ?t= 那一段）。' };

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

/** 攔下兩個後端，記下每一發打到哪裡、帶了什麼。reply 換得掉，儀器不動。 */
async function routeBackends(page, sent, replyRef) {
  await page.unroute(/script\.google\.com/).catch(() => {});
  await page.route(/script\.google\.com/, async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    const params = {};
    new URLSearchParams(req.method() === 'POST' ? (req.postData() || '') : u.search)
      .forEach((v, k) => { params[k] = v; });
    sent.push({ backend: u.pathname.indexOf(HUB_ID) >= 0 ? 'hub'
                       : (u.pathname.indexOf(GAS_ID) >= 0 ? 'gas' : '?'),
                method: req.method(), params });
    await route.fulfill({ status: 200, contentType: 'application/javascript',
      body: 'cb(' + JSON.stringify(replyRef.value) + ')' });
  });
}

const bodyText = (page) => page.evaluate(() => document.body.innerText);
const cacheKeys = (page) => page.evaluate(() =>
  Object.keys(localStorage).filter((k) => k.indexOf('jdcBoard:') === 0).sort());


/**
 * 種一份「上線前就存在」的快取：呼叫頁面上的 `cacheSave`，與舊版存快取時同一支、同一組參數。
 * @returns {Promise<string>} 那把鍵的完整名稱
 */
async function primeOldCache(page, token) {
  await page.evaluate(async ([tok, ok]) => {
    if (typeof cacheSave !== 'function') throw new Error('頁面上沒有 cacheSave ⇒ 種不出真的快取');
    await cacheSave(tok, 'msglog', ok);
  }, [token, OK]);
  await page.waitForFunction(
    () => Object.keys(localStorage).filter((k) => k.indexOf('jdcBoard:') === 0 && k.endsWith(':msglog')).length === 1,
    null, { timeout: 10000 });
  const k = (await cacheKeys(page)).filter((x) => x.endsWith(':msglog'));
  if (k.length !== 1) throw new Error('種出來的鍵不是恰好一把：' + JSON.stringify(k));
  return k[0];
}

/* ══════════════════════════════════════════════════════════════════════
 * 🔴 主線：握著舊 `?t=` 連結、而且**手上有快取**的人
 * ════════════════════════════════════════════════════════════════════ */
test('🔴 舊 ?t= 連結＋本機有快取：看得到停用訊息與可點的出口，舊紀錄不留在畫面上，那一份快取被清掉', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const logs = [];
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  await page.route(/static\.line-scdn\.net/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  await page.addInitScript(liffStub());

  // ── 準備：種一份「上線之前就存在」的快取（見檔頭）────────────────────
  const reply = { value: OK };
  await routeBackends(page, [], reply);
  await page.goto('/line-messages.html?t=STUBMT');
  const mine = await primeOldCache(page, 'STUBMT');
  console.log('【種好的快取鍵】', mine);

  // ⬛ 對照組（同一個 context 裡）：另外種一顆**別頁**的快取鍵。
  //    清完它必須還在——否則就是清過頭。指紋與切片名都與本頁不同。
  await page.evaluate(() => { localStorage.setItem('jdcBoard:v1:deadbeef1234:hr-stats', 'SENTINEL-OTHER-PAGE'); });

  // ── 受測：手上有那份快取的人，再開一次同一條舊連結 ────────────────────
  reply.value = TOMBSTONE;
  const sent2 = [];
  await routeBackends(page, sent2, reply);
  await page.goto('/line-messages.html?t=STUBMT');
  await page.waitForTimeout(1500);

  const txt = await bodyText(page);
  console.log('【第二輪·畫面】\n' + txt);
  console.log('【第二輪·送出】', JSON.stringify(sent2));
  console.log('【第二輪·快取鍵】', JSON.stringify(await cacheKeys(page)));

  // 完成定義①：那句話看得見（不是寫進一個 display:none 的元素裡）
  await expect(page.locator('#retired'), '停用訊息的區塊不存在或看不見').toBeVisible();
  expect(txt, '看不到停用訊息').toContain('這個連結已經停用');
  // 完成定義①：畫面不得停在舊紀錄上
  expect(txt, '舊紀錄還留在畫面上').not.toContain('塗小明');
  expect(txt, '停在快取的琥珀小字還在 ⇒ 他會以為只是暫時更新失敗').not.toContain('目前無法更新');
  expect(await page.locator('#list-refail').count(), '掛了「停在快取」提示').toBe(0);
  expect(await page.locator('#list').innerHTML(), '清單沒有被清空').toBe('');
  await expect(page.locator('#rail'), '月份滑桿還在（那是舊紀錄的導覽）').toBeHidden();
  expect(await cacheKeys(page), '那一份快取沒被清掉').not.toContain(mine);
  expect(await page.evaluate(() => localStorage.getItem('jdcBoard:v1:deadbeef1234:hr-stats')),
    '清到別頁去了').toBe('SENTINEL-OTHER-PAGE');

  // 🔴 hub 只講得出文字，**可點的出口是這一頁做的**
  const exit = page.locator('#retired a[href="line-messages.html"]');
  await expect(exit, '沒有可點的出口 ⇒ 他只被告知「不能用」，不知道往哪去').toBeVisible();
  // ⚠️ 點出口之前把後端換回正常——出口通到的是②（gas），不是那顆墓碑。
  //    忘了換的話②會照實把墓碑的 `msg` 畫出來（`logFailText` 本來就該這樣），
  //    看起來像「出口沒用」，其實是量具還停在上一個情境。⬛ 第一次跑就踩到這一格。
  reply.value = OK;
  await exit.click();
  await page.waitForTimeout(1200);
  expect(new URL(page.url()).search, '點了出口還帶著 ?t=').toBe('');
  expect(await bodyText(page), '出口點下去沒有回到正常的訊息紀錄頁').toContain('塗小明');

  await page.screenshot({ path: 'test-results/msglog-retire-01-有快取看到停用.png', fullPage: true });
  expect(logs, 'console 有未捕捉的錯誤').toEqual([]);
  await context.close();
});

/* ══════════════════════════════════════════════════════════════════════
 * 完成定義②：只清這一頁的那一份快取
 * ════════════════════════════════════════════════════════════════════ */
test('🔴 清快取只清 msglog 這一份：別頁的鍵（對照組）一個都不准掉', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const logs = [];
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  await page.route(/static\.line-scdn\.net/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  await page.addInitScript(liffStub());

  const reply = { value: OK };
  await routeBackends(page, [], reply);
  await page.goto('/line-messages.html?t=STUBMT');
  const mine = await primeOldCache(page, 'STUBMT');

  // ⬛ 對照組：四把別頁的鍵。其中一把**同指紋、不同切片**，另外三把不同指紋——
  //    `cacheClear(FP)` 會清掉前者，`cacheClearAll()` 會清掉全部，
  //    只有 `cacheDrop(FP,'msglog')` 四把都留得住。這三種寫法的差別就靠這一格量出來。
  const fp = mine.slice(0, mine.length - ':msglog'.length);
  const others = [fp + ':getMsgLogToken', 'jdcBoard:v1:aaaaaaaaaaaa:hr-stats',
                  'jdcBoard:v1:bbbbbbbbbbbb:attend:A1', 'jdcBoard:v1:cccccccccccc:activities'];
  await page.evaluate((ks) => { ks.forEach((k, i) => localStorage.setItem(k, 'SENTINEL-' + i)); }, others);
  console.log('【清之前】', JSON.stringify(await cacheKeys(page)));

  reply.value = TOMBSTONE;
  await routeBackends(page, [], reply);
  await page.goto('/line-messages.html?t=STUBMT');
  await expect(page.locator('#retired')).toBeVisible();
  await page.waitForTimeout(800);

  const after = await cacheKeys(page);
  console.log('【清之後】', JSON.stringify(after));
  expect(after, '這一頁的那一份快取沒被清掉').not.toContain(mine);
  for (const k of others) {
    expect(after, '清到別頁去了：' + k).toContain(k);
  }
  expect(await page.evaluate((k) => localStorage.getItem(k), others[0]),
    '同指紋的別的切片被順手清掉了（cacheClear 而不是 cacheDrop）').toBe('SENTINEL-0');
  expect(logs).toEqual([]);
  await context.close();
});

/* ══════════════════════════════════════════════════════════════════════
 * 沒有快取的人：一樣看得到那句話（原本這一格是會的，不可以做壞）
 * ════════════════════════════════════════════════════════════════════ */
test('舊 ?t= 連結、本機沒有快取：一樣看得到停用訊息與出口，且一發後端都不打', async ({ page }) => {
  const logs = [];
  const sent = [];
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  await page.route(/static\.line-scdn\.net/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  await page.addInitScript(liffStub());
  await routeBackends(page, sent, { value: TOMBSTONE });
  await page.goto('/line-messages.html?t=STUBMT');
  await page.waitForTimeout(1200);

  const txt = await bodyText(page);
  console.log('【沒有快取·畫面】\n' + txt);
  console.log('【沒有快取·送出】', JSON.stringify(sent));
  await expect(page.locator('#retired')).toBeVisible();
  expect(txt).toContain('這個連結已經停用');
  expect(txt).not.toContain('載入中');
  // 🔴 **只有真瀏覽器量得到這一格。** `.sdot` 的作者樣式是 `display: flex`，
  //    優先序高過 `[hidden]` ⇒ 只設 `hidden` 屬性按鈕照樣看得見，而假 DOM 的單元測試
  //    斷言 `hidden === true` 仍然是綠的。⬛ 第一版就這樣漏掉，是截圖看出來的。
  await expect(page.locator('#sdot'), '搜尋鈕還看得見（hidden 被 .sdot 的 display:flex 蓋掉了）').toBeHidden();
  await expect(page.locator('#clearBtn'), '清除本機快取鈕應該還在、但已停用').toBeDisabled();
  // 🔴 結構性保證：這條路上連 hub 的網址都沒有了 ⇒ 不可能再把 token 送出去
  expect(sent, '停用之後還把 token 送去了後端').toEqual([]);
  expect(await page.evaluate(() => window.__liffLoginCalled), '①這條路不該去碰 LIFF').toBeFalsy();
  expect(logs).toEqual([]);
  await page.screenshot({ path: 'test-results/msglog-retire-02-沒有快取.png', fullPage: true });
});

/* ══════════════════════════════════════════════════════════════════════
 * ⬛ 對照：另外兩條入口逐字不變（判準是「網址上有沒有 t」，不是文案）
 * ════════════════════════════════════════════════════════════════════ */
test('⬛ 對照：?from=welfare 那條入口一個字都沒變（照打 getWelfareMessageLog、畫得出清單、沒有停用訊息）', async ({ page }) => {
  const logs = [];
  const sent = [];
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  await page.route(/static\.line-scdn\.net/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  await page.addInitScript(liffStub());
  await routeBackends(page, sent, { value: OK });
  await page.goto('/line-messages.html?from=welfare&days=180');
  await page.waitForTimeout(1200);

  expect(sent.length).toBe(1);
  expect(sent[0].backend).toBe('gas');
  expect(sent[0].method).toBe('POST');
  expect(sent[0].params.action).toBe('getWelfareMessageLog');
  expect(sent[0].params.days).toBe('180');
  expect(sent[0].params.idToken).toBe('IDTOK');
  const txt = await bodyText(page);
  expect(txt).toContain('塗小明');
  expect(txt, '沒有 t 的路被墓碑誤傷').not.toContain('這個連結已經停用');
  expect(await page.locator('#retired').count(), '沒有 t 卻長出停用區塊').toBe(0);
  expect(logs).toEqual([]);
});

test('⬛ 對照：一般 LINE 登入（完全沒有 query）一個字都沒變', async ({ page }) => {
  const logs = [];
  const sent = [];
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  await page.route(/static\.line-scdn\.net/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  await page.addInitScript(liffStub());
  await routeBackends(page, sent, { value: OK });
  await page.goto('/line-messages.html');
  await page.waitForTimeout(1200);

  expect(sent.length).toBe(1);
  expect(sent[0].backend).toBe('gas');
  expect(sent[0].params.action).toBe('getMessageLog');
  expect(sent[0].params.idToken).toBe('IDTOK');
  expect(sent[0].params.t).toBeUndefined();
  const txt = await bodyText(page);
  expect(txt).toContain('塗小明');
  expect(txt).not.toContain('這個連結已經停用');
  expect(await page.locator('#retired').count()).toBe(0);
  expect(logs).toEqual([]);
});

/**
 * 🔴 空的 `?t=`（舊書籤 `?t=&days=180`）**不是**舊路——`qs()` 回空字串，
 *    現行分流就把它當②。這一格原本有測試釘著（`messages-line.spec.js`），
 *    在這裡再釘一次是因為「墓碑的判準」很容易寫成 `location.search.indexOf('t=')`，
 *    那會把這條路一起殺掉，而且畫面上看起來完全合理。
 */
test('🔴 空的 ?t=（?t=&days=180）不算舊路：照走②，不出停用訊息', async ({ page }) => {
  const logs = [];
  const sent = [];
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  await page.route(/static\.line-scdn\.net/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  await page.addInitScript(liffStub());
  await routeBackends(page, sent, { value: OK });
  await page.goto('/line-messages.html?t=&days=180');
  await page.waitForTimeout(1200);

  expect(sent.length).toBe(1);
  expect(sent[0].backend).toBe('gas');
  expect(sent[0].params.action).toBe('getMessageLog');
  expect(sent[0].params.days).toBe('180');
  expect(await bodyText(page)).toContain('塗小明');
  expect(await page.locator('#retired').count(), '空 t 被當成舊路殺掉了').toBe(0);
  expect(logs).toEqual([]);
});
