/**
 * `hr-stats.html` 的進場路：**只剩 LINE 登入一條**（`jdc-tw-org/jdc-line-gas#99`，2026-09-18）。
 *
 * 🪦 **本檔 2026-09-12～2026-09-18 之間叫 `hr-stats-e1b-wiring.test.js`，驗的是「兩條路」。**
 *    那個前提已經被推翻，不是被放寬——`?t=` 那條路整條拆了。所以本檔**改寫不刪**：
 *    原本 ① 那幾條斷言「帶 `?t=` 不碰 LIFF、請求帶 token」，現在逐條翻面成
 *    「帶 `?t=` **仍然**走 LINE 登入、而且**一顆 token 都送不出去**」。
 *    🔴 直接刪掉它們的話，回歸會變成靜默的：把 `if(TOKEN)return Promise.resolve('token')`
 *       加回去，沒有任何一條會紅。
 *
 * 🔴 **為何非有這一支不可**：`page-load.test.js` 開 hr-stats.html 時網址帶著
 *    `?t=STUBTOKEN`。在舊寫法底下它跑的**永遠是舊路** ⇒ 新路一行都沒被執行過而全綠。
 *    （現在同一把網址跑的是 LINE 那條路，那正是本檔第一組要釘住的事。）
 *
 * ⚠️ 手法與 `board-token-retired.test.js` 同型（同一種 stub 環境），
 *    刻意不自創第二套——兩套環境的嚴格度會分歧，而分歧是靜默的。
 *    **唯一刻意的差別是「首載有沒有發車」那五條用 `waitFor` 不用 `settle`**：
 *    本頁首載排在真 webcrypto 後面，固定幾輪等不到它。理由見 `helpers/page-stub.js` 的 waitFor。
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// 🔴 stub 環境走共用的一支（`tests/helpers/page-stub.js`）——「退路一次性實測」
//    也是用同一支跑改動前那一份，兩邊的嚴格度才可能相同。理由見該檔檔頭。
const { runPage, settle, waitFor, BLOCKED_WAIT_MS, execOnly, onlyCall, ROOT } = require('./helpers/page-stub.js');

/**
 * 一頁的 **inline script、剝掉註解之後**的可執行碼。
 *
 * 🔴 **本檔有三條在數「某個字出現幾次」，它們一律吃這一支、不吃原始檔。**
 *    理由是實測出來的：這一顆的墓碑散文裡逐字引用了 `var TOKEN=q('t')`，
 *    只剝 HTML 註解的版本會把它數進去 ⇒ 一條**永遠響的紅燈**
 *    （`feedback_comment_is_source_code` 第五形態：判準寫「X 不得出現」，
 *     而解釋這條判準的那段話本身含有 X ⇒ 執行者學會無視那一格）。
 * ⚠️ 每一條用它的都要附一個**對照組**（數一個已知存在很多次的東西），
 *    否則「剝註解把整段程式碼吃掉了」與「真的沒有」長得一模一樣。
 */
function pageCode(file) {
  const html = fs.readFileSync(path.join(ROOT, file), 'utf8');
  return (html.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g) || []).join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

/* ══ 🪦 舊路的墓碑：網址帶 ?t= 也一樣要走 LINE 登入 ═══════════════════════
 *
 * 下面幾條是舊 ① 那兩條**逐條翻面**來的（見檔頭）。翻面的意思是：
 * 同一個輸入（`?t=STUBTOKEN`），斷言的內容從「不碰 LIFF／帶 token」
 * 變成「照樣碰 LIFF／一顆 token 都不帶」。
 * ════════════════════════════════════════════════════════════════════ */

test('🪦 帶 ?t= → **仍然**去 LINE 登入（舊路那一行加回來就會紅）', async () => {
  const { ctx, liff, cleanup } = runPage({ search: '?t=STUBTOKEN' });
  await settle();
  try {
    assert.equal(liff.__initCalled, 1,
      '帶 ?t= 就不去初始化 LIFF ⇒ `if(TOKEN)return Promise.resolve("token")` 那條舊路回來了');
    assert.equal(ctx.ID_TOKEN, 'IDTOK', '沒有走到拿 idToken 那一步');
    assert.equal(ctx.FP, 'U_SUB_1', '指紋還是網址上那串 ⇒ 舊路還活著');
    assert.equal(typeof ctx.TOKEN, 'undefined',
      '`TOKEN` 這個全域還在 ⇒ 有人把它接回去了（本頁不該再持有任何一顆看板 token）');
  } finally { cleanup(); }
});

test('🔴🪦 帶 ?t= → 送出去的請求**一顆 token 都沒有**，帶的是 idToken', async () => {
  const { ctx, urls, cleanup } = runPage({ search: '?t=STUBTOKEN' });
  await settle();
  try {
    // 🔴 **照身分挑，不照位置**（2026-09-14）：`urls[length-1]` 只在「jsonp 同步發車」這個
    //    **沒寫出來的前提**下才對——本頁首載送的也是同一個 action，前提一破就靜靜量到首載那一發。
    const before = execOnly(urls).length;
    // 🔴 **刻意仍然傳 `token`／`t` 進去**：這一條要證明的不是「呼叫端沒傳」，
    //    是「傳了也送不出去」——`jsonp` 自己會 `delete`。呼叫端不傳的話這條零鑑別力。
    ctx.jsonp('getHrStats', { token: 'STUBTOKEN', t: 'STUBTOKEN' });
    const u = onlyCall(execOnly(urls), 'getHrStats', before);
    assert.equal(/[?&]token=/.test(u), false, '還是把 token 送出去了 ⇒ 後端會走舊守門');
    assert.equal(/[?&]t=/.test(u), false, '還是把 t 送出去了 ⇒ 後端會走舊守門');
    assert.match(u, /[?&]idToken=IDTOK/, '沒帶 idToken ⇒ 這一支會永遠驗不過');
  } finally { cleanup(); }
});

test('🪦 網址上的 `t` 被剝掉（而其餘參數原封不動）', async () => {
  const { ctx, cleanup } = runPage({ search: '?a=1&t=STUBTOKEN&mt=MT9' });
  await settle();
  try {
    assert.equal(ctx.__replacedUrl, '/hr-stats.html?a=1&mt=MT9',
      '`t` 沒被剝掉、或順手弄壞了別的參數（`&&` 那一型）');
  } finally { cleanup(); }
});

test('🔴🪦 剝網址排在 liff.login 之前 ⇒ redirectUri 不含那串 token', async () => {
  const { liff, cleanup } = runPage({ search: '?t=STUBTOKEN', loggedIn: false });
  await settle();
  try {
    assert.ok(liff.__loginArgs, '沒有呼叫 liff.login');
    assert.equal(/[?&]t=/.test(liff.__loginArgs.redirectUri), false,
      'redirectUri 還帶著那串 token ⇒ 它會被原封不動送進 LINE 的轉址鏈');
  } finally { cleanup(); }
});

test('🪦 `t` 在這一頁只有一個來源（剝掉註解之後再數）', () => {
  // ⚠️ 用 `git grep -c` 會數到本檔與 hr-stats.html 的註解自己提到的那幾次
  //    （那正是 line-messages 那一顆踩過的坑）⇒ 走 `pageCode`，見它的檔頭。
  const code = pageCode('hr-stats.html');
  const hits = (code.match(/urlToken\s*\(/g) || []).length;
  assert.equal(hits, 1, '`urlToken(` 出現 ' + hits + ' 次；只准有一處，而它只餵墓碑');
  // ⬛ 對照組：同一把尺去數一個已知存在很多次的東西，必須回大於 1，
  //    否則上面那個 1 可能是「剝註解把整段程式碼吃掉了」。
  const ctrl = (code.match(/jsonp\s*\(/g) || []).length;
  assert.ok(ctrl > 1, '對照組回 ' + ctrl + ' ⇒ 這把尺把程式碼吃掉了，上面那個 1 不可採信');
});

/* ══ LINE 登入這條路（原本的 ②，前提沒變，逐字保留）═══════════════════ */

test('沒有 ?t= → 走 LIFF，FP 變成 LINE 的 sub', async () => {
  const { ctx, liff, cleanup } = runPage({ search: '' });
  await settle();
  try {
    assert.equal(liff.__initCalled, 1, '沒去初始化 LIFF ⇒ 這條路根本沒跑');
    assert.equal(ctx.ID_TOKEN, 'IDTOK');
    assert.equal(ctx.FP, 'U_SUB_1', '指紋沒換成 sub');
  } finally { cleanup(); }
});

test('🔴 指紋的**初值**必須是空字串，不可以是網址上那串（M12 的對點）', () => {
  // ⬛ **這一條是一顆活下來的突變逼出來的。** 突變 M12 把 `var FP='';` 改回
  //    `var FP=LEGACY_T;`，全套 **1298 條一條都沒紅**。
  //
  // 🔴 為何它今天**行為上**看不出來：`cacheBootstrap(FP)` 排在 `AUTH_READY` 之後，
  //    那時 `FP` 已經被 `lineSub()` 覆蓋掉 ⇒ 兩種寫法跑起來一模一樣。
  //    **正因為看不出來，它才需要一條結構斷言**——哪天有人把某個讀快取的動作
  //    往前挪到 `AUTH_READY` 之前（那是很自然的「優化首屏」改動），
  //    指紋就會變成「網址上任何人都能塞的一串字」⇒ **貼別人的舊連結就解得開他的快取**，
  //    而本頁快取裡有退休預警的姓名。
  // ⚠️ 所以這一條釘的是**初值的形狀**，不是執行後的值（那由下一條釘）。
  const code = pageCode('hr-stats.html');
  assert.match(code, /var FP\s*=\s*''\s*;/,
    "`FP` 的初值不是空字串 ⇒ 它可能持有網址上那串 token。"
    + '（今天行為上看不出差別，理由見這一條的註解——那正是它需要存在的原因。）');
  assert.equal(/var FP\s*=\s*LEGACY_T/.test(code), false, '`FP` 又拿網址上那串當初值了');
  // ⬛ 對照組：這把尺量得到東西——同一份程式碼裡 `LEGACY_T` 確實存在。
  assert.match(code, /var LEGACY_T\s*=/, '⬛ 掃不到 LEGACY_T ⇒ 上面那個 false 是尺壞了');
});

test('🔴 指紋不可以是空字串（同一台裝置上 A 的快取會被 B 解開）', async () => {
  // 本頁快取裡含退休預警的**姓名**，指紋撞號不是效能問題，是個資問題。
  const { ctx, cleanup } = runPage({ search: '' });
  await settle();
  try {
    assert.notEqual(ctx.FP, '', '指紋是空字串 ⇒ 共用裝置上不同人的快取會混在一起');
  } finally { cleanup(); }
});

test('呼叫自動帶 idToken（憑證只掛在 jsonp 一處）', async () => {
  const { ctx, urls, cleanup } = runPage({ search: '' });
  await settle();
  try {
    // 🔴 **照身分挑，不照位置**（2026-09-14）：理由同上一組。
    const before = execOnly(urls).length;
    ctx.jsonp('getHrStats', {});
    const u = onlyCall(execOnly(urls), 'getHrStats', before);
    assert.match(u, /[?&]idToken=IDTOK/, '沒帶 idToken ⇒ 這一支會永遠驗不過');
    assert.equal(/[?&]token=/.test(u), false, '不該再出現 token 參數（連空的都不該有）');
  } finally { cleanup(); }
});

test('🔴 idToken 是「呼叫當下才取」，不是開頁時取一次存起來', async () => {
  const { ctx, urls, cleanup } = runPage({ search: '' });
  await settle();
  try {
    // 模擬一小時後 LINE 換了新憑證（看板開著不動一整個上午是常態）
    ctx.liff.getIDToken = () => 'IDTOK_REFRESHED';
    // 🔴 **照身分挑，不照位置**（2026-09-14）：`urls[length-1]` 只在「jsonp 同步發車」這個
    //    **沒寫出來的前提**下才對——本頁首載送的也是同一個 action，前提一破就靜靜量到首載那一發。
    //    `from` 把「這一段新增了什麼」框出來，`onlyCall` 再要求恰好一發 ⇒ 前提從假設變成斷言。
    const before = execOnly(urls).length;
    ctx.jsonp('getHrStats', {});
    assert.match(onlyCall(execOnly(urls), 'getHrStats', before), /idToken=IDTOK_REFRESHED/,
      '送出去的還是舊憑證 ⇒ 他會被說「請重新登入」，而他根本沒登出過');
  } finally { cleanup(); }
});

/* ══ 失敗路徑：每一種都要擋住首載，而且不可以帶空憑證送出去 ══════════════ */

test('🔴 還沒登入 → 去登入，且**首載不發車**（不可以帶空憑證打後端）', async () => {
  const { urls, liff, cleanup } = runPage({ search: '', loggedIn: false });
  await waitFor(() => urls.length > 0, BLOCKED_WAIT_MS);   // 等滿，不是一進來就判 0
  try {
    assert.ok(liff.__loginArgs, '沒有呼叫 liff.login');
    assert.equal(liff.__loginArgs.redirectUri, 'http://localhost/hr-stats.html',
      'redirectUri 不是本頁 ⇒ 登入後回不來');
    assert.equal(urls.length, 0, '導頁中還送出了 ' + urls.length + ' 個請求：' + urls.join(' | '));
  } finally { cleanup(); }
});

test('🔴 登入了但拿不到憑證 → 擋住，首載不發車', async () => {
  const { urls, cleanup } = runPage({ search: '', idToken: '' });
  await waitFor(() => urls.length > 0, BLOCKED_WAIT_MS);
  try {
    assert.equal(urls.length, 0, '拿不到憑證卻照樣送了 ' + urls.length + ' 個請求');
  } finally { cleanup(); }
});

test('🔴 LIFF 元件整個沒載入 → 擋住，首載不發車（fail-closed）', async () => {
  const { urls, cleanup } = runPage({ search: '', noLiff: true });
  await waitFor(() => urls.length > 0, BLOCKED_WAIT_MS);
  try {
    assert.equal(urls.length, 0, 'LIFF 缺席卻照樣送了 ' + urls.length + ' 個請求');
  } finally { cleanup(); }
});

test('⬛ 對照組：一切正常時首載**確實會**發車（否則上面三條是「反正都不發」）', async () => {
  const { urls, cleanup } = runPage({ search: '' });
  await waitFor(() => execOnly(urls).length >= 1);   // 首載排在真 webcrypto 後面，見 waitFor
  try {
    assert.ok(urls.length >= 1,
      '正常情況也沒發車 ⇒ 上面三條零鑑別力，它們證明的是「這支測試不會發車」');
    const e = execOnly(urls);
    assert.ok(e.length >= 1, '沒有任何一發打到 /exec');
    assert.match(e[0], /action=getHrStats/, '首載那一發不是 getHrStats');
    assert.match(e[0], /idToken=IDTOK/, '首載沒帶憑證');
  } finally { cleanup(); }
});

test('⬛ 對照組：帶 ?t= 進來也一樣會發車，而且帶的是 idToken 不是 token', async () => {
  const { urls, cleanup } = runPage({ search: '?t=STUBTOKEN' });
  await waitFor(() => execOnly(urls).length >= 1);
  try {
    const e = execOnly(urls);
    assert.ok(e.length >= 1, '帶 ?t= 進來就發不了車 ⇒ 舊書籤的人整頁空白');
    assert.match(e[0], /idToken=IDTOK/);
    assert.equal(/[?&]token=/.test(e[0]), false);
  } finally { cleanup(); }
});

/* ══ 🪦 「退路」那一段整段作廢（2026-09-18）═══════════════════════════
 *
 * 這裡原本寫著「舊連結的行為必須與改動前逐字相同」，並說明為何那件事只做一次性實測、
 * 不做成常駐夾具（副本一產生就開始腐爛）。**那段推理本身沒有錯，但它的主詞不見了**：
 * `?t=` 那條路已經拆掉，「改動前的行為」不再是任何東西要維持的目標。
 *
 * 🔴 **所以這一頁現在沒有「不必部署的退路」了。** 這不是漏掉，是知情的取捨——
 *    留著舊路就等於留著一個繞過在職檢查的入口（gas `#138`）。
 *    救火走 gas 那把救火鍵（`firekey.js`），不走「把舊連結給他」。
 */

/* ══ 取值方式：不可以長出第二種寫法 ════════════════════════════════ */

/* 🪦 **`function q(k){return urlParam(k);}` 那個薄包裝 2026-09-18 拿掉了**，
 *    所以原本兩條（「q 要委派給共用函式」＋「q 與 urlParam 行為逐字相同」）
 *    的**主詞不見了**。改寫不刪，理由與方向見下面那一條。
 *
 * 🔴 **拿掉它不只是清理，它修掉了一個假陽性**：`tests/helpers/auth-scan.js` 的
 *    `holders()` 把「讀取式所在的最內層具名函式」算成持有者 ⇒ `q` 進了持有者集合
 *    ⇒ 賦值傳遞的不動點一路長到 `params`／`qs` ⇒ 尺 A 判「值落進傳輸函式的引數區」
 *    ⇒ 這一頁在 `auth-inventory.baseline.md` 上被記成 **`活的`**，而它明明已經是墓碑。
 *    ⬛ 實測（改之前／改之後）：
 *        hr-stats  {"verdict":"活的","shapes":["S1","S4"],"rulerA":true}
 *              →   {"verdict":"墓碑（讀了但不送）","shapes":["S4"],"rulerA":false}
 *        ⬛ 對照組 board.html（做了同一件事）：改前改後都是後者
 *    ⇒ **兩頁做同一件事就該長同一個樣子**；盤點表判錯比沒有盤點表更糟。
 */

test('🔴 取值只走共用的 `urlToken()`，不可以自己再長出一份（正則或薄包裝都不行）', () => {
  const html = fs.readFileSync(path.join(ROOT, 'hr-stats.html'), 'utf8');
  assert.match(html, /<script src="assets\/url-token\.js"><\/script>/,
    '沒有載入共用的取值函式 ⇒ `urlToken()` 會在執行時 ReferenceError');
  const code = pageCode('hr-stats.html');
  assert.ok(!/new RegExp\('\[\?&\]'\+k/.test(code),
    '舊的自寫正則回來了 ⇒ 換來源時這一頁會靜靜地繼續走舊路');
  // 🪦 薄包裝也不准回來——它會讓 auth-scan 的持有者集合爆開（見上面那一段實測）。
  assert.ok(!/function\s+q\s*\(/.test(code),
    '`q(k)` 那個薄包裝回來了 ⇒ 盤點表會把這一頁誤判成 `活的`');
  // ⬛ 對照組：這把尺量得到東西。
  assert.ok(code.length > 2000, '剝完只剩 ' + code.length + ' 個字元 ⇒ 尺把程式碼吃掉了');
});

test('🔴 行為面：這一頁執行時真的拿得到共用的 urlToken（掃原始碼證明不了這件事）', () => {
  // 掃原始碼只能證明「寫了那一行 <script src>」；這一條證明**跑起來真的接上了**。
  // 🪦 這一條原本比對的是頁面自己的 `q()` 與 `urlParam()`，那個 `q` 已經不存在。
  const { ctx, cleanup } = runPage({ search: '?x=1&zz=%E4%B8%AD&bad=%&empty=' });
  try {
    assert.equal(typeof ctx.urlToken, 'function', '共用的 urlToken 沒有掛上 window');
    // ⬛ 零點：這組輸入真的量得到東西（不是每一格都是空字串在對空字串）。
    assert.strictEqual(ctx.urlParam('zz'), '中', 'decodeURIComponent 沒作用 ⇒ 這組輸入沒有鑑別力');
    assert.strictEqual(ctx.urlParam('bad'), '%', '壞的百分比編碼要回原字串，不可以拋');
    assert.strictEqual(ctx.urlParam('沒有這個參數'), '', '取不到時要回空字串，不是 null／undefined');
    // 🪦 `t` 這一格會被墓碑剝掉 ⇒ 開頁之後一定是空的。這一條順便釘住那件事。
    assert.strictEqual(ctx.urlToken(), '', '網址上還留著 t ⇒ 墓碑沒有把它剝掉');
  } finally { cleanup(); }
});

test('🪦 本頁不再宣告任何看板 token 的全域（原本是「只准有一個」）', () => {
  // 🪦 這一條原本是 `var TOKEN` **恰好一個**。翻面而不刪：刪掉的話，
  //    把 `var TOKEN=q('t')` 加回來不會有任何一條紅。
  // 🔴 **必須剝掉註解再數**（`feedback_comment_is_source_code` 第五形態：永遠響的紅燈）。
  //    ⬛ 實測：只剝 HTML 註解的版本回 **1**，命中的是墓碑那段散文裡逐字引用的
  //    `原本這裡是 var TOKEN=q('t')`——「刻意沒有 X」這句話本身含有 X。
  const code = pageCode('hr-stats.html');
  const n = (code.match(/var TOKEN\b/g) || []).length;
  assert.strictEqual(n, 0, '有 ' + n + ' 個 `var TOKEN` 宣告 ⇒ 舊路的持有點回來了');
  // ⬛ 對照組：這把尺量得到東西——`var LEGACY_T`（墓碑那一顆）必須恰好一個。
  const m = (code.match(/var LEGACY_T\b/g) || []).length;
  assert.strictEqual(m, 1, '`var LEGACY_T` 有 ' + m + ' 個 ⇒ 上面那個 0 是量法壞了');
});

test('🔴 本頁不再鑄造任何帶 token 的網址', () => {
  const code = pageCode('hr-stats.html');
  assert.equal(/\?t=/.test(code), false, '程式碼裡還在組 `?t=` 的網址');
  // ⬛ 對照組：剝註解之後還有東西（否則上面那個 false 什麼都沒證明）。
  assert.ok(code.length > 2000, '剝完只剩 ' + code.length + ' 個字元 ⇒ 尺把程式碼吃掉了');
});

test('LIFF ID 與 index／welfare／board 同一條（tools.md：不多開 LIFF ID）', () => {
  const pick = (f, re) => (fs.readFileSync(path.join(ROOT, f), 'utf8').match(re) || [])[1];
  const h = pick('hr-stats.html', /^var LIFF_ID='([^']+)';/m);
  const b = pick('board.html', /^var LIFF_ID='([^']+)';/m);
  const w = pick('line.html', /^var LIFF_ID = '([^']+)';/m);
  const i = pick('index.html', /^\s*var LIFF_ID = '([^']+)';/m);
  assert.ok(h, 'hr-stats.html 找不到 LIFF_ID');
  assert.equal(h, b, 'hr-stats 與 board 的 LIFF ID 不同');
  assert.equal(h, w, 'hr-stats 與 welfare 的 LIFF ID 不同');
  assert.equal(h, i, 'hr-stats 與 index 的 LIFF ID 不同');
});
