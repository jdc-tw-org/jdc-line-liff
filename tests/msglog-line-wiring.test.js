/**
 * 訊息紀錄頁「乙」liff 端（線 ML，2026-09-13；`?t=` 於 2026-09-16 退場，`jdc-tw-org/jdc-line-hub#27`）：
 * `line-messages.html` 的**唯一一條**進來的路（LINE 登入）、`?t=` 的墓碑，以及發訊頁入口。
 *
 * 🔴 **為何非有這一支不可**：`page-load.test.js` 開頁時網址帶 `?t=STUBTOKEN` ⇒ 它跑的永遠不是②，
 *    LINE 登入那條路一行都沒被執行過，而它照樣全綠（同 `attend-checkin-e1b-wiring.test.js` 檔頭）。
 *    〔2026-09-16〕`?t=` 拆掉之後那句話**更嚴重**了：帶 `?t=` 的開頁現在連後端都不打。
 *
 * ⚠️ **這一檔證明不了②在線上會通**：後端 `getMessageLog`／`getWelfareMessageLog` 在 `jdc-line-gas`，
 *    本 repo 量不到。這裡只證明「前端送出去的東西對、該擋的時候擋住、讀不到時講得出話」。
 *
 * ⚠️ 手法：`tests/helpers/page-stub.js` 的 `runPage`。②走 `gasCall`（POST），參數在 body 不在網址
 *    ⇒ 本檔自己換掉 `ctx.fetch` 記下 (url, init)。換的時機在 runPage 回來之後：首載排在
 *    `cacheBootstrap()`（真 webcrypto，非同步）後面，一定還沒發車。
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { runPage, waitFor, BLOCKED_WAIT_MS } = require('./helpers/page-stub.js');
const S = require('./helpers/source-scan.js');

/* hub 的 /exec。**這一頁已經不該再有它**（`EXEC_URL`／`callApi` 都刪了）⇒ 留著這個常數不是殘骸，
 * 是下面那條守門的輸入：它必須在 `line-messages.html` 裡 0 命中。 */
const HUB_EXEC = 'https://script.google.com/macros/s/AKfycbwCMxy9K3A8ZE56yJrGW1C9ee1iZnsMRHosBygDHcm8qJD9UeyUINnRuh3aKX9QMqR8/exec';
const GAS_EXEC = 'https://script.google.com/macros/s/AKfycbxaDoA_7aOW325p8165VegSqdRL8gRhfTEMfjosdh1A0T4rmzj4Pl7F3k5PToe2po-xtg/exec';

const H = ['發送時間', '平台', '來源', '對象UserID', '對象姓名', '對象單位',
           '訊息型別', '訊息內容', '附件', '結果', '錯誤', '批次'];
const ROWS = [['2026-09-01 10:00:00', 'line-platform', 'bind_success', 'U1', '甲', '工務部',
               'text', '綁定成功', '', '成功', '', 'b-1']];

/**
 * 開頁並接管 fetch。`replies` 依序回應（函式則每次呼叫）；`'reject'` ＝傳輸失敗。
 * @returns {{ctx, liff, sent: {url:string, method:string, params:object}[], cleanup}}
 */
function open(search, { replies = [], liff: liffOpt = {} } = {}) {
  const r = runPage(Object.assign({ file: 'line-messages.html', search }, liffOpt));
  const sent = [];
  let i = 0;
  r.ctx.fetch = (u, init) => {
    const url = String(u);
    if (url.indexOf('script.google.com') < 0) return new Promise(() => {});   // HEAD 新版檢查等
    const method = (init && init.method) || 'GET';
    const params = {};
    const qs = method === 'POST' ? String(init.body || '') : (url.split('?')[1] || '');
    new URLSearchParams(qs).forEach((v, k) => { params[k] = v; });
    sent.push({ url, method, params });
    const rep = typeof replies === 'function' ? replies(i) : replies[i];
    i++;
    if (rep === undefined) return new Promise(() => {});
    if (rep === 'reject') return Promise.reject(new TypeError('Failed to fetch'));
    return Promise.resolve({ text: () => Promise.resolve('cb(' + JSON.stringify(rep) + ')') });
  };
  return Object.assign(r, { sent });
}

/* ══ 🪦 `?t=` 那條路的墓碑（原本這一節叫「①舊路：改動前的網址逐字不變」）═══════ */

/* 🪦 **這兩條原本斷言的是「①舊路的網址與改動前逐字相同」。**
 *    那個前提 2026-09-16 被擁有者拍板拿掉了（`jdc-tw-org/jdc-line-hub#27`）⇒ **改寫，不刪除**：
 *    同一個輸入（`?t=…`），斷言換成現在該發生的事。刪掉的話，日後沒有任何東西擋得住
 *    「有人把 `callApi` 加回來」。 */
test('🪦 帶 ?t= → 出墓碑：不碰 LIFF、一發後端都不打（hub 的網址已經不在這一頁裡）', async () => {
  const { ctx, liff, sent, cleanup } = open('?t=STUBMT&days=90');
  try {
    assert.ok(await waitFor(() => false, BLOCKED_WAIT_MS) === false);
    assert.equal(sent.length, 0, '停用之後還把 token 送出去了：' + JSON.stringify(sent));
    assert.equal(liff.__initCalled, 0, '墓碑那條路去初始化了 LIFF');
    assert.equal(ctx.TOKEN, 'STUBMT');
    assert.equal(ctx.CACHE_NAME, 'msglog');
    assert.equal(typeof ctx.callApi, 'undefined', '`callApi` 又長回來了 ⇒ 這一頁又打得到 hub');
    assert.equal(typeof ctx.EXEC_URL, 'undefined', '`EXEC_URL`（hub 的 /exec）又長回來了');
  } finally { cleanup(); }
});

test('🪦 ?t= 與 from=welfare 同時出現 → 仍走墓碑（分流只看 t，與改動前同一條判準）', async () => {
  const { liff, sent, cleanup } = open('?t=STUBMT&from=welfare');
  try {
    assert.ok(await waitFor(() => false, BLOCKED_WAIT_MS) === false);
    assert.equal(sent.length, 0, '帶 t 的請求跑去打 gas 了：' + JSON.stringify(sent));
    assert.equal(liff.__initCalled, 0);
  } finally { cleanup(); }
});

/* ⬛ **對照組·這個量具量得到「有發車」。** 上面兩條的 `sent.length === 0` 若是量具壞掉造成的，
 *    這一條會跟著變 0——它跑的是同一支 `open`、同一個 `sent` 陣列，只差網址上沒有 `t`。 */
test('⬛ 對照組：同一個量具在沒有 t 的網址上量得到 1 發（0 不是因為量不到）', async () => {
  const { sent, cleanup } = open('?days=90');
  try {
    assert.ok(await waitFor(() => sent.length >= 1), '對照組沒發車 ⇒ 上面兩條的 0 什麼都沒證明');
    assert.equal(sent[0].url, GAS_EXEC);
  } finally { cleanup(); }
});

/* 🔴 **墓碑的判準是「網址上有沒有 t」，不是後端回的那串字。**
 *    為何不比對文案：`deny-no-role` 實測 11 種措辭有 9 種會讓處置靜默消失；
 *    而 PR-A 明寫「分辨力放 `msg` 不放 `reason`」＝hub 那側刻意沒給機器判準。
 *    ⬛ 這一條把它釘成結構性事實：全檔只有一處讀 `t`。 */
test('🔴 `t` 在這一頁只有一個來源（判準是結構性的，不依賴任何跨 repo 的字串相等）', () => {
  const src = S.stripComments(S.scriptText('line-messages.html'));
  const hits = src.match(/qs\('t'\)/g) || [];
  assert.equal(hits.length, 1, "讀 `t` 的地方變成 " + hits.length + " 處 ⇒ 「?t= 只有一個用途」這個判準要重驗");
  assert.match(src, /var TOKEN = qs\('t'\);/);
  // ⬛ 零點：同一條取法拿一個已知存在的字驗，證明它掃得到東西
  assert.ok((src.match(/qs\('from'\)/g) || []).length >= 1, '⬛ 掃描器什麼都掃不到 ⇒ 上面那個 1 是假的');
  // 🔴 分流必須是 `if (TOKEN)`，不是任何跟回應有關的東西
  assert.match(src, /if \(TOKEN\) \{ retireTokenPath\(\); \} else \{/,
    '墓碑的分流不再是「網址上有沒有 t」');
});

/* 🔴 **hub 的 /exec 必須整條不在這一頁裡。**
 *    「停用之後不會再把 token 送出去」不是靠註解保證，是靠這一頁**沒有那個網址可用**。
 *    ⚠️ 這條刻意連註解一起掃（用 `sourceText` 不是 `stripComments`）——
 *       把網址註解掉、留在檔案裡等人取消註解，與留著沒有兩樣。 */
test('🔴 hub 的 /exec 不得以任何形式留在 line-messages.html（含註解）', () => {
  const raw = S.sourceText('line-messages.html');
  assert.equal(raw.indexOf(HUB_EXEC), -1, 'hub 的 /exec 又回到這一頁了 ⇒ 這條路又打得到 hub');
  // ⬛ 零點：同一條取法拿一個已知存在於這一頁的網址驗，證明它掃得到 /exec 這種字串
  assert.ok(raw.indexOf(GAS_EXEC) >= 0, '⬛ 連 gas 的 /exec 都掃不到 ⇒ 上面那個「不在」是假的');
});

/* 🔴 **這一條釘的是「不拿後端文案當判準」，而不是「這串字不得出現」。**
 *    ⚠️ 兩者很容易寫反，我第一版就寫反了：這一頁**自己**要講「這個連結已經停用。」
 *    ⇒ 那串字必然出現在原始碼裡，用「不得出現」當判準會永遠紅（memory：永遠響的紅燈，
 *      執行者會學會無視那一格，比沒有判準更糟）。
 *    正確的判準是**資料流**：`retireTokenPath` 的函式本體裡不得出現任何回應變數。
 *    ⬛ 用 `fnSrc` 取（`Function.prototype.toString()` 規格保證逐字），不是近似切原始碼。 */
test('🔴 墓碑那句話是這一頁自己的：`retireTokenPath` 不讀任何後端回應', () => {
  const fn = S.stripComments(S.fnSrc('retireTokenPath', 'line-messages.html'));
  assert.ok(fn.length > 200, '⬛ 抽不到 retireTokenPath ⇒ 下面的「不含」恆真（長度 ' + fn.length + '）');
  assert.ok(fn.indexOf('這個連結已經停用') >= 0, '⬛ 抽到的函式裡沒有那句話 ⇒ 抽錯東西了');
  for (const forbidden of ['res.msg', 'res.reason', 'logFailText', 'callGas', 'fetch(', 'settleRefresh']) {
    assert.equal(fn.indexOf(forbidden), -1, '墓碑去讀後端了（' + forbidden + '）⇒ 後端改一個字就靜默失效');
  }
});

/* 🔴 空的 `?t=` 不算「有 t」（VML2 突變 W1：把空 t 當成有 t 時原本單元 0 紅、e2e 0 紅）。
 *    faf0c50 的發訊頁產生過 `line-messages.html?t=<msgLogToken>&days=180`，換發失敗時 token 是空的
 *    ⇒ 舊書籤可能帶 `?t=&days=180`。它要走②（LINE 登入、打 gas），不可以拿空 t 去打 hub。 */
test('🔴 空的 ?t=（舊書籤 ?t=&days=180）→ 走②：初始化 LIFF、POST gas、不打 hub、不帶 t', async () => {
  const { ctx, liff, sent, cleanup } = open('?t=&days=180');
  try {
    assert.ok(await waitFor(() => sent.length >= 1), '沒發車');
    assert.equal(ctx.TOKEN, '');
    assert.equal(liff.__initCalled, 1, '空 t 被當成有 t ⇒ 被墓碑殺掉了，沒去 LINE 登入');
    assert.equal(sent.length, 1);
    assert.equal(sent[0].url, GAS_EXEC, '空 t 去打了 hub：' + sent[0].url);
    assert.equal(sent[0].method, 'POST');
    assert.equal(sent[0].params.action, 'getMessageLog');
    assert.equal(sent[0].params.days, '180');
    assert.equal('t' in sent[0].params, false);
    assert.equal(ctx.FP, 'U_SUB_1');
  } finally { cleanup(); }
});

/* ══ loadLiffSdk 的條件（單元層；VML2：原本三類突變都只靠一條 e2e 撐）══════════ */

/* 🪦 原本斷言「①（TOKEN 非空）一次都不呼叫 loadLiffSdk」。`startAuth` 現在只剩一條路，
 *    而「帶 t 不載 SDK」這件事沒有被放棄——它換到更前面、更強的地方成立：
 *    帶 t 的請求在啟動段就被 `retireTokenPath()` 接走，`startAuth` 根本不會被呼叫。
 *    ⇒ 改寫成兩條斷言：①`startAuth` 一律載 SDK；②帶 t 時它沒有被走到。 */
test('🔴 startAuth 只剩一條路：一律先載 SDK 再 startLine', async () => {
  const { ctx, cleanup } = open('');
  try {
    let n = 0;
    ctx.loadLiffSdk = () => { n++; return Promise.resolve(); };
    ctx.startLine = () => 'line';
    assert.equal(await ctx.startAuth(), 'line');
    assert.equal(n, 1, 'startAuth 沒有先載 SDK');
  } finally { cleanup(); }
});

test('🔴 帶 t 的開頁不載 LINE SDK（墓碑那條路不碰 LIFF，CDN 慢也與它無關）', async () => {
  const { ctx, liff, cleanup } = open('?t=STUBMT');
  try {
    assert.ok(await waitFor(() => false, BLOCKED_WAIT_MS) === false);
    assert.equal(liff.__initCalled, 0, '墓碑那條路去初始化了 LIFF');
    // ⬛ 對照組：同一個量具在沒有 t 時量得到 1 次 init
    const b = open('');
    try {
      assert.ok(await waitFor(() => b.liff.__initCalled === 1),
        '⬛ 對照組沒有 init ⇒ 上面那個 0 是量具造成的');
    } finally { b.cleanup(); }
    assert.equal(typeof ctx.retireTokenPath, 'function', '墓碑函式不見了');
  } finally { cleanup(); }
});

// ⚠️ 載具從 `?t=X` 換成沒有 t 的網址：帶 t 現在會被墓碑接走，頁面不會跑到這一段。
test('🔴 loadLiffSdk：沒有 window.liff → 插入指向 LINE CDN 的 script，onload 才 resolve；已有 liff → 不插', async () => {
  const { ctx, cleanup } = open('');
  try {
    const made = [];
    ctx.document.createElement = (tag) => { const el = { tag }; made.push(el); return el; };
    const appended = [];
    ctx.document.head = { appendChild: (el) => { appended.push(el); } };
    // 已有 liff（替身）：不插
    await ctx.loadLiffSdk();
    assert.equal(made.length, 0, 'window.liff 已在卻又插了一支 SDK');
    // 沒有 liff：插一支，onload 前不 resolve
    ctx.liff = undefined;
    let done = false;
    const p = ctx.loadLiffSdk().then(() => { done = true; });
    assert.equal(appended.length, 1, '沒有插入 SDK');
    assert.equal(appended[0].tag, 'script');
    assert.equal(appended[0].src, 'https://static.line-scdn.net/liff/edge/2/sdk.js');
    await new Promise((r) => setImmediate(r));
    assert.equal(done, false, 'SDK 還沒載完就 resolve 了 ⇒ startLine 會看到沒有 liff');
    appended[0].onerror();                       // 載不到也要 resolve（交給 startLine 講出來）
    await p;
    assert.equal(done, true);
  } finally { cleanup(); }
});

// ⚠️ 原本的理由是「同步載入會讓①舊路也等 LINE CDN」。①沒了，但**這條仍然要留**：
//    墓碑那條路一樣不該等 CDN（e2e 有一條在 5 秒延遲下量它），而且②的動態載入是刻意的。
test('🔴 line-messages.html 不可以再同步載入 LINE SDK（頁尾 <script src=…sdk.js> 會讓每一條路都等 CDN）', () => {
  const html = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'line-messages.html'), 'utf8');
  const tags = html.match(/<script[^>]*\bsrc="[^"]*static\.line-scdn\.net[^"]*"[^>]*>/g) || [];
  assert.deepEqual(tags, []);
  // ⬛ 對照組：同一條樣式抓得到 line.html 的同步載入（否則上面的空陣列恆真）
  const w = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'line.html'), 'utf8');
  assert.equal((w.match(/<script[^>]*\bsrc="[^"]*static\.line-scdn\.net[^"]*"[^>]*>/g) || []).length, 1);
});

/* ══ ②LINE 登入 ═════════════════════════════════════════════════════════ */

test('🔴 ②沒有 ?t= → LIFF 登入後 POST gas 的 getMessageLog，只帶 idToken（不帶 token／t），天數預設 3650', async () => {
  const { ctx, liff, sent, cleanup } = open('');
  try {
    assert.ok(await waitFor(() => sent.length >= 1), '②沒發車');
    assert.equal(liff.__initCalled, 1);
    const s = sent[0];
    assert.equal(s.url, GAS_EXEC, '②打的不是 line-platform 的 /exec（還在直接打 hub？）');
    assert.equal(s.method, 'POST');
    assert.equal(s.params.action, 'getMessageLog');
    assert.equal(s.params.idToken, 'IDTOK');
    assert.equal(s.params.days, '3650');
    assert.equal('token' in s.params, false, '②帶了 token ⇒ 後端 doGet 會把請求改道回舊守門');
    assert.equal('t' in s.params, false, '②帶了 t ⇒ 後端 doGet 會把請求改道回舊守門');
    assert.equal(ctx.FP, 'U_SUB_1', '②的快取指紋沒換成 sub ⇒ 共用裝置上不同人的快取會混在一起');
    assert.equal(ctx.CACHE_NAME, 'msglog');
  } finally { cleanup(); }
});

test('🔴 ②?from=welfare → 打 getWelfareMessageLog（只帶 idToken、天數照網址），快取切片與看板那支分開', async () => {
  const { ctx, sent, cleanup } = open('?from=welfare&days=180');
  try {
    assert.ok(await waitFor(() => sent.length >= 1));
    const s = sent[0];
    assert.equal(s.url, GAS_EXEC);
    assert.equal(s.params.action, 'getWelfareMessageLog');
    assert.equal(s.params.days, '180');
    assert.equal(s.params.idToken, 'IDTOK');
    assert.deepEqual(Object.keys(s.params).sort(), ['action', 'callback', 'days', 'idToken']);
    assert.equal(ctx.CACHE_NAME, 'msglog-welfare');
  } finally { cleanup(); }
});

/* 🔴 `from` 只有逐字等於 `welfare` 才打發訊那支（VML V2：改成「非空就算」時原本整組全綠）。
 *    放寬的後果：分流頁或手打的任何 `from=…` 都會去打 `getWelfareMessageLog`，
 *    admin／activity／hr 在那支第二道被擋 ⇒ 看板身分的人莫名其妙讀不到自己的紀錄。 */
for (const [search, why] of [
  ['?from=abc', '非空但不是 welfare'],
  ['?from=WELFARE', '大小寫不同'],
  ['?from=', '空值'],
  ['?from=welfare2', '前綴相同'],
  ['?from=%20welfare', '前面多一個空白'],
]) {
  test(`🔴 ②${search}（${why}）→ 仍打 getMessageLog，快取切片是看板那格`, async () => {
    const { ctx, sent, cleanup } = open(search);
    try {
      assert.ok(await waitFor(() => sent.length >= 1), '沒發車');
      assert.equal(sent[0].params.action, 'getMessageLog', `${search} 打去了 ${sent[0].params.action}`);
      assert.equal(ctx.CACHE_NAME, 'msglog');
    } finally { cleanup(); }
  });
}

test('②還沒登入 → 去 LINE 登入（保留 query），一個請求都不送', async () => {
  const { liff, sent, cleanup } = open('?from=welfare&days=180', { liff: { loggedIn: false } });
  try {
    await waitFor(() => false, BLOCKED_WAIT_MS);
    assert.ok(liff.__loginArgs && /line-messages\.html\?from=welfare&days=180$/.test(liff.__loginArgs.redirectUri),
      '沒有去登入，或登入回來的網址丟了 query：' + JSON.stringify(liff.__loginArgs));
    assert.deepEqual(sent, [], '導頁中還送出了請求');
  } finally { cleanup(); }
});

test('②已登入但拿不到 idToken → 紅字說明，一個請求都不送', async () => {
  const { ctx, sent, cleanup } = open('', { liff: { idToken: '' } });
  try {
    await waitFor(() => false, BLOCKED_WAIT_MS);
    assert.deepEqual(sent, []);
    assert.match(ctx.msgEl.textContent, /拿不到這一頁需要的憑證/);
  } finally { cleanup(); }
});

test('⬛ 對照組：上兩條的「0 個請求」不是量具不會發車——同一個量具在正常登入時量得到 1 發', async () => {
  const { sent, cleanup } = open('');
  try { assert.ok(await waitFor(() => sent.length >= 1)); } finally { cleanup(); }
});

/* ══ 讀不到時講得出話 ═══════════════════════════════════════════════════ */

test('🔴 hub_unreadable（後端沒給 msg）→ 畫面講「讀不到」，不是空白、不是「沒有紀錄」', async () => {
  const { ctx, sent, cleanup } = open('', { replies: [{ ok: false, reason: 'hub_unreadable' }] });
  try {
    assert.ok(await waitFor(() => /讀不到/.test(ctx.msgEl.textContent)), '畫面：' + ctx.msgEl.textContent);
    assert.equal(ctx.msgEl.textContent, ctx.HUB_UNREADABLE_TEXT);
    assert.equal(/沒有你權限內的紀錄/.test(ctx.msgEl.textContent), false);
    assert.equal(sent.length, 1, '伺服器說不行卻重試了');
  } finally { cleanup(); }
});

test('hub_unreadable（帶 gas 的真實 msg）→ 一樣是本頁那句（不隨後端文案漂移）', async () => {
  const { ctx, cleanup } = open('', { replies: [{ ok: false, reason: 'hub_unreadable', msg: '訊息紀錄暫時讀不到，請稍後再試。' }] });
  try {
    assert.ok(await waitFor(() => ctx.msgEl.textContent === ctx.HUB_UNREADABLE_TEXT), '畫面：' + ctx.msgEl.textContent);
  } finally { cleanup(); }
});

test('⬛ 對照組：別的失敗（角色不符）照舊顯示後端那句——logFailText 真的依 reason 分流，不是一律換掉', async () => {
  const msg = '此連結非您的權限範圍。';
  const { ctx, cleanup } = open('', { replies: [{ ok: false, reason: 'role_mismatch', msg }] });
  try {
    assert.ok(await waitFor(() => ctx.msgEl.textContent === msg), '畫面：' + ctx.msgEl.textContent);
  } finally { cleanup(); }
});

test('hub_unreadable 而畫面上是快取 → 提示用本頁那句（logFailText 接進 settleRefresh）', () => {
  const { ctx, cleanup } = open('');
  try {
    assert.equal(ctx.logFailText({ ok: false, reason: 'hub_unreadable' }), ctx.HUB_UNREADABLE_TEXT);
    assert.equal(ctx.logFailText({ ok: false, msg: '連線失敗' }), '連線失敗');
    assert.equal(ctx.logFailText(null), '無法載入。');
    const src = S.stripComments(S.scriptText('line-messages.html'));
    assert.match(src, /res = Object\.assign\(\{\}, res, \{ msg: logFailText\(res\) \}\);\s*\n\s*if \(!settleRefresh\('list', res,/,
      '失敗回應沒有先換成 logFailText 的話就交給 settleRefresh ⇒ 有快取時提示照抄後端（或空白）');
  } finally { cleanup(); }
});

/* ══ 成功、logSince、重試、重登 ═════════════════════════════════════════ */

test('②成功 → 清單畫出來、存快取；回應沒帶 logSince（hub 或 gas 尚未上線）⇒ 必須掛「紀錄起始日未設定」', async () => {
  const { ctx, cleanup } = open('', { replies: [{ ok: true, who: '甲', header: H, rows: ROWS }] });
  try {
    assert.ok(await waitFor(() => ctx.BATCHES.length === 1), '清單沒有畫出來');
    assert.equal(ctx.msgEl.style.display, 'none');
    assert.match(ctx.warnEl.textContent, /紀錄起始日未設定/,
      '②路線把「紀錄起始日未設定」藏掉了——logSince 缺席（＝hub 或 gas 尚未上線）時必須顯示警示');
  } finally { cleanup(); }
});

test('②傳輸失敗 → 隔 2 秒重試一次，重試那一發一樣只帶「當下」的 idToken', async () => {
  const { ctx, sent, cleanup } = open('', { replies: ['reject', { ok: true, header: H, rows: ROWS }] });
  try {
    assert.ok(await waitFor(() => sent.length >= 1));
    ctx.liff.getIDToken = () => 'IDTOK_2';
    assert.ok(await waitFor(() => sent.length >= 2, 5000), '傳輸失敗沒有重試');
    assert.equal(sent[1].params.idToken, 'IDTOK_2');
    assert.equal('token' in sent[1].params, false);
    assert.ok(await waitFor(() => ctx.BATCHES.length === 1));
  } finally { cleanup(); }
});

test('②憑證過期（line_bad_token）→ 接上 liff-relogin：真的 logout＋login 一次', async () => {
  const { ctx, liff, cleanup } = open('', { replies: [{ ok: false, reason: 'line_bad_token', msg: '憑證失效' }] });
  let out = 0;
  liff.logout = () => { out++; };
  try {
    assert.ok(await waitFor(() => out === 1), '沒有接 reloginOnDeadCredential ⇒ 過期的人留在死巷');
    assert.ok(liff.__loginArgs, '登出後沒有重新登入');
    assert.equal(ctx.sessionStorage.getItem('JDC_RELOGIN_TRIED'), '1');
  } finally { cleanup(); }
});

/* ══ 發訊頁入口 ═════════════════════════════════════════════════════════ */

test('🔴 line.html 的訊息紀錄入口：連到 line-messages.html?from=welfare，不帶 ?t=、不讀 msgLogToken', () => {
  const fn = S.stripComments(S.fnSrc('renderMsgLogEntry', 'line.html'));
  assert.ok(fn.length > 40, '⬛ 抽不到 renderMsgLogEntry ⇒ 下面的「不含」恆真');
  assert.match(fn, /'line-messages\.html\?from=welfare&days=180'/);
  assert.equal(/msgLogToken/.test(fn), false, '入口又讀了 msgLogToken ⇒ 會把 hub token 帶回網址');
  assert.equal(/[?&]t=/.test(fn), false,
    '入口帶了 ?t= ⇒ line-messages.html 會出墓碑，把一個能用的入口變成一句「已停用」');
});

/* ══ 🪦 三台鑄造機停產（`jdc-tw-org/jdc-line-hub#27` 完成定義③）═══════════════
 *
 * 🔴 **判準必須分得開「鑄造」與「提到」。** `grep -c "line-messages.html?t="` 會把註解算進去
 *    ——而這一輪**正好留著兩段刻意提到它的散文**（`admin.html` 與 `line.html` 各一段
 *    「原文那句話現在是假的」的更正註解）。拿那個數字當完成判準，會判成「沒做完」，
 *    然後下一個人就會去把那兩段更正砍掉，把「為何曾經是 X」一起刪掉。
 *
 * ⇒ 判準＝**剝掉註解之後的程式碼裡有沒有這串字**。剝註解用的是本 repo 既有的
 *    `S.stripComments`，不另寫一套近似。
 * ⚠️ 這支的定義域只到 `<script>` 裡（`S.scriptText`）。HTML 屬性上硬寫的 `href` 掃不到
 *    ——所以下面另外釘一條「靜態 markup 也不准有」。
 */
/* 逐頁的零點探針：一個**已知存在於這一頁 `<script>` 程式碼裡**（不是註解裡）的字串。
 * ⚠️ 不可以偷懶寫成「每一頁都含 `line-messages.html`」——`admin.html` 拆完之後
 *    它的程式碼裡一次都不提了（連結在靜態 markup 上），那個零點會自己變成假陽性。
 *    ⬛ 我第一版就是這樣寫的，被這一格當場擋下來。 */
const MINT_PAGES = {
  'admin.html': 'showMsgLog',
  'board.html': 'msgLogLink',
  'stats.html': 'msgLogLink',
  'line.html': 'renderMsgLogEntry',
  'line-messages.html': 'retireTokenPath',
};

test('🪦 三台鑄造機停產：剝掉註解之後，沒有任何一頁的程式碼再產生 line-messages.html?t=', () => {
  const found = [];
  for (const [f, probe] of Object.entries(MINT_PAGES)) {
    const code = S.stripComments(S.scriptText(f));
    if (code.indexOf('line-messages.html?t=') >= 0) found.push(f);
    // ⬛ 零點（逐頁做，不是整批做一次）：`scriptText`＋`stripComments` 對某一頁回空字串的話，
    //    那一頁會「乾淨」而完全看不出來。拿一個已知存在的字證明這條管線在這一頁真的取到東西。
    assert.ok(code.length > 500, '⬛ ' + f + ' 的程式碼只取到 ' + code.length + ' 字元 ⇒ 上面那個「沒有」是假的');
    assert.ok(code.indexOf(probe) >= 0, '⬛ ' + f + ' 掃不到已知存在的 `' + probe + '` ⇒ 掃描器有問題');
  }
  assert.deepEqual(found, [], '還在鑄造 ?t= 的頁面：' + found.join('／'));
});

/* ⬛ **對照組·這把尺有鑑別力。** 上面的「0 個」若是因為 `stripComments` 把整份吃掉了，
 *    這一條會跟著綠——所以它拿同一把尺去量一段**含有**那串字的假原始碼，必須量得到。 */
test('⬛ 對照組：同一把尺量得到「鑄造」，也還是濾得掉「提到」', () => {
  const minted = S.stripComments("var a;\na.href = 'line-messages.html?t=' + tok;\n");
  assert.ok(minted.indexOf('line-messages.html?t=') >= 0, '⬛ 尺量不到鑄造 ⇒ 上面那條恆綠');
  const mentioned = S.stripComments("// 網址長成 line-messages.html?t=<mt>\nvar a = 1;\n");
  assert.equal(mentioned.indexOf('line-messages.html?t='), -1, '⬛ 尺濾不掉註解 ⇒ 兩段更正註解會被誤判成鑄造');
  const blockMention = S.stripComments("/*\n * `line-messages.html?t=`\n */\nvar a = 1;\n");
  assert.equal(blockMention.indexOf('line-messages.html?t='), -1, '⬛ 區塊註解沒被濾掉');
});

/* ⚠️ `stripComments` 的定義域到不了 HTML 屬性。三個入口的靜態 markup 各自釘一次。 */
test('🪦 靜態 markup 也不准帶 token：訊息紀錄的連結一律是不帶 query 的 line-messages.html', () => {
  const admin = S.sourceText('admin.html');
  assert.match(admin, /<a class="card" id="go-messages" href="line-messages\.html" hidden>/,
    'admin 的卡片 href 變了');
  for (const f of ['board.html', 'stats.html']) {
    const html = S.sourceText(f);
    const m = html.match(/<a id="msgLogLink"[^>]*>/);
    assert.ok(m, '⬛ ' + f + ' 抓不到 msgLogLink 的 markup ⇒ 下面的「不含」恆真');
    assert.equal(/line-messages\.html\?t=/.test(m[0]), false, f + ' 的 markup 裡硬寫了帶 token 的網址');
  }
});

/* ══ 🔴 清快取的界線（完成定義②）════════════════════════════════════════
 *
 * `assets/board-cache.js` 是**多頁共用**的，四個原語的殺傷半徑差很多：
 *   `cacheDrop(token,name)` 單一份／`cacheClear(token)` 這個指紋下全部／
 *   `cacheClearAll()` 全站所有人所有頁／`cacheRevoke()` 記憶體。
 * 只准動 `CACHE_NAME` 那一份。清到別頁就是這一票製造的新災難，而且**畫面上完全沒有徵兆**
 * （別頁下次開會變慢一次，沒有任何錯誤訊息）。
 *
 * ⚠️ 這裡用**呼叫計數包裝**，不是比對原始碼字串：字串比對擋不住「改叫另一支但字面很像」。
 *    計數器放在受測路徑之外（`open()` 回來之後才裝）——否則它會跟著受測物一起被改壞。
 */
test('🔴 墓碑只呼叫 cacheDrop、而且只清 CACHE_NAME 那一份（cacheClear／cacheClearAll 一次都不准叫）', async () => {
  const { ctx, cleanup } = open('?t=STUBMT');
  try {
    const calls = [];
    ctx.cacheDrop = (tok, name) => { calls.push(['drop', tok, name]); return Promise.resolve(); };
    ctx.cacheClear = (tok) => { calls.push(['clear', tok]); return Promise.resolve(); };
    ctx.cacheClearAll = () => { calls.push(['clearAll']); };
    ctx.cacheRevoke = () => { calls.push(['revoke']); };
    await ctx.retireTokenPath();
    assert.deepEqual(calls, [['drop', 'STUBMT', 'msglog']],
      '清快取的呼叫不對（要恰好一發 cacheDrop(FP, CACHE_NAME)）：' + JSON.stringify(calls));
  } finally { cleanup(); }
});

/* ⬛ 對照組：這個計數器裝得上、也真的攔得到——拿同一組替身去叫那三支，每一支都要被記到。
 *    沒有這一格的話，上面的 `[['drop',…]]` 同時相容於「只叫了 drop」與「替身根本沒接上」。 */
test('⬛ 對照組：同一組替身攔得到 cacheClear／cacheClearAll／cacheRevoke', async () => {
  const { ctx, cleanup } = open('?t=STUBMT');
  try {
    const calls = [];
    ctx.cacheClear = (tok) => { calls.push(['clear', tok]); return Promise.resolve(); };
    ctx.cacheClearAll = () => { calls.push(['clearAll']); };
    ctx.cacheRevoke = () => { calls.push(['revoke']); };
    await ctx.cacheClear('X'); ctx.cacheClearAll(); ctx.cacheRevoke();
    assert.deepEqual(calls, [['clear', 'X'], ['clearAll'], ['revoke']], '⬛ 替身沒接上 ⇒ 上面那條恆綠');
  } finally { cleanup(); }
});

test('🪦 墓碑把畫面收乾淨：清單清空、滑桿收起、起始日警示不留、搜尋鈕收起', async () => {
  const { ctx, cleanup } = open('?t=STUBMT');
  try {
    ctx.cacheDrop = () => Promise.resolve();
    ctx.listEl.innerHTML = '<div>舊紀錄</div>';
    ctx.railEl.hidden = false;
    ctx.warnEl.textContent = '紀錄起始日未設定';
    await ctx.retireTokenPath();
    assert.equal(ctx.listEl.innerHTML.indexOf('舊紀錄'), -1, '舊紀錄留在畫面上');
    assert.equal(ctx.railEl.hidden, true, '月份滑桿還開著（那是舊紀錄的導覽）');
    assert.equal(ctx.warnEl.textContent, '', '起始日警示留著 ⇒ 看起來像頁面還活著');
    // ⚠️ **這一條是必要條件、不是充分條件，不要單靠它。**
    //    `.sdot` 的作者樣式是 `display: flex`，優先序高過 `[hidden]` ⇒ `hidden` 設了按鈕照樣看得見，
    //    而這裡的假 DOM 沒有 CSS，量不到那件事（⬛ 實測：拿掉行內 display:none 這一支 0 紅、e2e 1 紅）。
    //    「使用者真的看不到它」釘在 `tests/e2e/msglog-retire-t.spec.js` 的 `#sdot` toBeHidden。
    assert.equal(ctx.dotEl.hidden, true, '搜尋鈕沒設 hidden（語意層）');
    assert.equal(ctx.dotEl.style.display, 'none', '搜尋鈕沒設行內 display:none ⇒ 畫面上還看得見');
    assert.notEqual(ctx.msgEl.style.display, 'none', '講話的那一格被藏起來了 ⇒ 那句話看不見');
  } finally { cleanup(); }
});
