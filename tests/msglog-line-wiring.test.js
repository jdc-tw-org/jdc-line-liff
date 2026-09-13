/**
 * 訊息紀錄頁「乙」liff 端（線 ML，2026-09-13）：`messages.html` 的兩條進來的路＋發訊頁入口。
 *
 * 🔴 **為何非有這一支不可**：`page-load.test.js` 開頁時網址帶 `?t=STUBTOKEN` ⇒ 它跑的永遠是①舊路，
 *    ②LINE 登入那條路一行都沒被執行過，而它照樣全綠（同 `attend-checkin-e1b-wiring.test.js` 檔頭）。
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
  const r = runPage(Object.assign({ file: 'messages.html', search }, liffOpt));
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

/* ══ ①舊路：改動前的網址逐字不變 ═══════════════════════════════════════ */

test('①帶 ?t= → 不碰 LIFF，照舊 GET hub 的 listMessageLog（網址逐字與改動前相同），不帶 idToken', async () => {
  const { ctx, liff, sent, cleanup } = open('?t=STUBMT&days=90');
  try {
    assert.ok(await waitFor(() => sent.length >= 1), '舊路沒發車');
    assert.equal(liff.__initCalled, 0, '舊路去初始化了 LIFF');
    assert.equal(sent[0].method, 'GET');
    assert.equal(sent[0].url, HUB_EXEC + '?action=listMessageLog&t=STUBMT&days=90&callback=cb',
      '①的網址與改動前不同 ⇒ 舊書籤／admin 換來的連結可能失效');
    assert.equal(ctx.FP, 'STUBMT', '舊路快取指紋變了 ⇒ 回訪秒開的快取整批失效');
    assert.equal(ctx.CACHE_NAME, 'msglog');
  } finally { cleanup(); }
});

test('①優先：?t= 與 from=welfare 同時出現 → 仍走舊路（分流只看 t）', async () => {
  const { liff, sent, cleanup } = open('?t=STUBMT&from=welfare');
  try {
    assert.ok(await waitFor(() => sent.length >= 1));
    assert.equal(liff.__initCalled, 0);
    assert.ok(sent[0].url.indexOf(HUB_EXEC + '?action=listMessageLog&t=STUBMT') === 0, sent[0].url);
  } finally { cleanup(); }
});

/* 🔴 空的 `?t=` 不算「有 t」（VML2 突變 W1：把空 t 當成有 t 時原本單元 0 紅、e2e 0 紅）。
 *    faf0c50 的發訊頁產生過 `messages.html?t=<msgLogToken>&days=180`，換發失敗時 token 是空的
 *    ⇒ 舊書籤可能帶 `?t=&days=180`。它要走②（LINE 登入、打 gas），不可以拿空 t 去打 hub。 */
test('🔴 空的 ?t=（舊書籤 ?t=&days=180）→ 走②：初始化 LIFF、POST gas、不打 hub、不帶 t', async () => {
  const { ctx, liff, sent, cleanup } = open('?t=&days=180');
  try {
    assert.ok(await waitFor(() => sent.length >= 1), '沒發車');
    assert.equal(ctx.TOKEN, '');
    assert.equal(liff.__initCalled, 1, '空 t 被當成①舊路 ⇒ 沒去 LINE 登入');
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

test('🔴 startAuth：①（TOKEN 非空）一次都不呼叫 loadLiffSdk；②（空字串）呼叫一次', async () => {
  const { ctx, cleanup } = open('?t=X');
  try {
    let n = 0;
    ctx.loadLiffSdk = () => { n++; return Promise.resolve(); };
    ctx.startLine = () => 'line';
    assert.equal(await ctx.startAuth(), 'token');
    assert.equal(n, 0, '①去載了 LINE SDK ⇒ LINE CDN 慢時舊連結跟著等');
    ctx.TOKEN = '';
    assert.equal(await ctx.startAuth(), 'line');
    assert.equal(n, 1, '②沒有先載 SDK');
  } finally { cleanup(); }
});

test('🔴 loadLiffSdk：沒有 window.liff → 插入指向 LINE CDN 的 script，onload 才 resolve；已有 liff → 不插', async () => {
  const { ctx, cleanup } = open('?t=X');
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

test('🔴 messages.html 不可以再同步載入 LINE SDK（頁尾 <script src=…sdk.js> 會讓①等 CDN）', () => {
  const html = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'messages.html'), 'utf8');
  const tags = html.match(/<script[^>]*\bsrc="[^"]*static\.line-scdn\.net[^"]*"[^>]*>/g) || [];
  assert.deepEqual(tags, []);
  // ⬛ 對照組：同一條樣式抓得到 welfare.html 的同步載入（否則上面的空陣列恆真）
  const w = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'welfare.html'), 'utf8');
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
    assert.ok(liff.__loginArgs && /messages\.html\?from=welfare&days=180$/.test(liff.__loginArgs.redirectUri),
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
  const { ctx, cleanup } = open('?t=X');
  try {
    assert.equal(ctx.logFailText({ ok: false, reason: 'hub_unreadable' }), ctx.HUB_UNREADABLE_TEXT);
    assert.equal(ctx.logFailText({ ok: false, msg: '連線失敗' }), '連線失敗');
    assert.equal(ctx.logFailText(null), '無法載入。');
    const src = S.stripComments(S.scriptText('messages.html'));
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

test('🔴 welfare.html 的訊息紀錄入口：連到 messages.html?from=welfare，不帶 ?t=、不讀 msgLogToken', () => {
  const fn = S.stripComments(S.fnSrc('renderMsgLogEntry', 'welfare.html'));
  assert.ok(fn.length > 40, '⬛ 抽不到 renderMsgLogEntry ⇒ 下面的「不含」恆真');
  assert.match(fn, /'messages\.html\?from=welfare&days=180'/);
  assert.equal(/msgLogToken/.test(fn), false, '入口又讀了 msgLogToken ⇒ 會把 hub token 帶回網址');
  assert.equal(/[?&]t=/.test(fn), false, '入口帶了 ?t= ⇒ messages.html 會走①舊路（瀏覽器直接打 hub）');
});
