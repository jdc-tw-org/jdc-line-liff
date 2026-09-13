/**
 * E1b：`wall.html`（進場人數牆，佳岑／副總／管理者）的兩條進場路（2026-09-13）。
 *
 * 🔴 **為何非有這一支不可**：既有碰 `wall.html` 的測試（`page-load`、`no-inline-transport`）
 *    一條走 `?t=`、一條只數函式定義 ⇒ 新路一行都沒被執行過，而它們全綠。
 *
 * ⚠️ 手法與 `attend-checkin-e1b-wiring`／`stats-e1b-wiring` 同型：同一支
 *    `tests/helpers/page-stub.js`（不另抄一份環境——兩份的嚴格度會靜默分歧）。
 *
 * 🔴 **本頁與 checkin 的差別，也是這一檔最要緊的一格**：本頁的發車點是
 *    `setInterval(tick,15000)`，閘門擋的是「開始輪詢」這件事本身，不在 `tick()` 裡。
 *    ⇒ 「沒登入不發車」要量**有沒有排定輪詢**，不能直接叫 `tick()`
 *      （直接叫 `tick()` 本來就會發，那條測試會量到自己的動作）。
 *    ⇒ 用 PRELUDE 在頁面 script 之前把 `setInterval` 包一層、記下排了什麼。
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { runPage, settle, ROOT } = require('./helpers/page-stub.js');
const S = require('./helpers/source-scan.js');

const FILE = 'wall.html';
const PRELUDE = '<script>var __iv=[];(function(){var si=setInterval;'
  + 'setInterval=function(f,ms){__iv.push({f:f,ms:ms});return si(f,ms);};})();</script>';

/** 帶 PRELUDE 跑本頁。**每次現讀檔**（突變批次會改檔，不可以快取在模組層）。 */
function run(opts) {
  const html = PRELUDE + fs.readFileSync(path.join(ROOT, FILE), 'utf8');
  return runPage(Object.assign({ file: FILE, html }, opts));
}
async function drain() { for (let i = 0; i < 6; i++) await settle(); }

/** 讓 fetch 立刻回一包 JSONP。 */
function replyWith(ctx, urls, body) {
  ctx.fetch = (u) => {
    urls.push(String(u));
    return Promise.resolve({ text: () => Promise.resolve('cb(' + JSON.stringify(body) + ')') });
  };
}

/* ══ 兩條路的首發 ════════════════════════════════════════════════════ */

test('🔴 ①舊路：帶 ?t= → **同步**發第一發並排定 15 秒輪詢，帶 token、不帶 idToken、不碰 LIFF', () => {
  const { ctx, urls, liff, cleanup } = run({ search: '?t=STUBTOKEN&act=A1' });
  try {
    // 刻意不 await：改動前是同步發車，舊路要逐字維持
    assert.equal(urls.length, 1, '舊路沒有同步發第一發');
    assert.match(urls[0], /action=getArrivalWall/);
    assert.match(urls[0], /[?&]token=STUBTOKEN(&|$)/);
    assert.match(urls[0], /[?&]actId=A1(&|$)/);
    assert.equal(/idToken=/.test(urls[0]), false, '舊路帶了 idToken ⇒ 後端 doGet 會把舊路改道');
    assert.equal(liff.__initCalled, 0, '舊路不該去初始化 LIFF');
    assert.equal(ctx.__iv.length, 1, '舊路沒有同步排定輪詢');
    assert.equal(ctx.__iv[0].ms, 15000);
  } finally { cleanup(); }
});

test('②新路：只有 ?act= → 走 LIFF，登入完才發，帶 idToken 與 actId、不帶 token', async () => {
  const { ctx, urls, liff, cleanup } = run({ search: '?act=A1' });
  try {
    assert.equal(urls.length, 0, '登入還沒完成就同步發車了');
    await drain();
    assert.equal(liff.__initCalled, 1, '沒有 ?t= 卻沒去初始化 LIFF ⇒ 新路根本沒跑');
    assert.equal(urls.length, 1, '登入完成後沒發車');
    assert.match(urls[0], /action=getArrivalWall/);
    assert.match(urls[0], /[?&]idToken=IDTOK(&|$)/, '首發沒帶憑證');
    assert.match(urls[0], /[?&]actId=A1(&|$)/);
    assert.equal(/[?&]token=/.test(urls[0]), false, '②帶了 token 參數上去');
    assert.equal(ctx.__iv.length, 1, '登入完成後沒排定輪詢');
  } finally { cleanup(); }
});

test('②還沒登入 → 去登入，redirectUri 保留 ?act=；一發都不送、也不排輪詢', async () => {
  const { ctx, urls, liff, cleanup } = run({ search: '?act=A1', loggedIn: false });
  await drain();
  try {
    assert.ok(liff.__loginArgs, '沒有呼叫 liff.login');
    assert.equal(liff.__loginArgs.redirectUri, 'http://localhost/wall.html?act=A1');
    assert.equal(urls.length, 0, '導頁中還送出了請求');
    assert.equal(ctx.__iv.length, 0, '導頁中還排了輪詢');
  } finally { cleanup(); }
});

/* ══ 🔴 閘門：首發與 15 秒輪詢都不可以在登入前發車 ═════════════════════ */

for (const [名, opts] of [
  ['還沒登入', { loggedIn: false }],
  ['登入了但拿不到憑證', { idToken: '' }],
  ['LIFF 元件整個沒載入', { noLiff: true }],
]) {
  test(`🔴 ${名} → 不發車，也不排 15 秒輪詢`, async () => {
    const { ctx, urls, cleanup } = run(Object.assign({ search: '?act=A1' }, opts));
    await drain();
    try {
      assert.equal(ctx.__iv.length, 0, '身分沒確認卻排了輪詢');
      assert.equal(urls.length, 0, '身分沒確認卻送了 ' + urls.length + ' 個請求：' + urls.join(' | '));
    } finally { cleanup(); }
  });
}

test('⬛ 對照組：一切正常時，排定的輪詢**確實會**再發一發，而且帶 idToken（否則上面三條是「反正都不發」）', async () => {
  const { ctx, urls, cleanup } = run({ search: '?act=A1' });
  await drain();
  try {
    const n = urls.length;
    assert.equal(n, 1, '首發沒送 ⇒ 下面量的東西沒有前提');
    assert.equal(ctx.__iv.length, 1, '⬛ PRELUDE 沒攔到 setInterval ⇒ 上面「不排輪詢」零鑑別力');
    ctx.__iv[0].f();
    assert.equal(urls.length, n + 1, '輪詢不發車');
    assert.match(urls[n], /[?&]idToken=IDTOK(&|$)/);
  } finally { cleanup(); }
});

test('🔴 ②idToken 是「呼叫當下才取」：開頁之後換了 token，下一次輪詢帶的是新的', async () => {
  const { ctx, urls, cleanup } = run({ search: '?act=A1' });
  await drain();
  try {
    ctx.liff.getIDToken = () => 'IDTOK_REFRESHED';
    ctx.__iv[0].f();
    const last = urls[urls.length - 1];
    assert.match(last, /idToken=IDTOK_REFRESHED/, '送出去的還是開頁時那顆');
  } finally { cleanup(); }
});

/* ══ 出口接 liff-relogin ════════════════════════════════════════════ */

test('🔴 jsonp 出口接了 liff-relogin：line_bad_token → 真的登出＋重新登入；line_unbound 不登出', async () => {
  const a = run({ search: '?act=A1' });
  await drain();
  try {
    let out = 0;
    a.ctx.liff.logout = () => { out++; };
    replyWith(a.ctx, a.urls, { ok: false, reason: 'line_bad_token', msg: 'x' });
    await a.ctx.jsonp('getArrivalWall', { token: a.ctx.TOKEN, actId: 'A1' });
    assert.equal(out, 1, '投在大螢幕上超過一小時、憑證過期時，不會自己重新登入');
  } finally { a.cleanup(); }

  const b = run({ search: '?act=A1' });
  await drain();
  try {
    let out = 0;
    b.ctx.liff.logout = () => { out++; };
    replyWith(b.ctx, b.urls, { ok: false, reason: 'line_unbound', msg: 'x' });
    const r = await b.ctx.jsonp('getArrivalWall', { token: b.ctx.TOKEN, actId: 'A1' });
    assert.equal(out, 0, '⬛ 對照組：重登沒用的代號也登出了');
    assert.equal(r.reason, 'line_unbound', '回應被吃掉了——tick 的錯誤畫面拿不到它');
  } finally { b.cleanup(); }
});

/* ══ 靜態：憑證只在一處、取值只走共用函式 ═════════════════════════════ */

test('🔴 憑證只掛在 jsonp 一處：整頁（含它載入的 asset）的 idToken 參數就只有 jsonp 裡那一個', () => {
  const code = S.stripComments(S.scriptText(FILE));
  const jsonpSrc = S.stripComments(S.fnSrc('jsonp', FILE));
  const n = (s, re) => (s.match(re) || []).length;
  // ⬛ 零點：jsonp 裡真的有它 ⇒ 下面的「相等」不是 0 = 0。
  assert.equal(n(jsonpSrc, /\bidToken\b/g), 1, 'jsonp 裡找不到憑證那一格（或多於一格）');
  assert.equal(n(code, /\bidToken\b/g), 1, '頁面別處也在組 idToken 參數');
  // freshIdToken：宣告 1 ＋ jsonp 1 ＋ startAuth 1
  assert.equal(n(code, /\bfreshIdToken\(/g), 3);
  assert.equal(n(jsonpSrc, /\bfreshIdToken\(/g), 1);
  const html = fs.readFileSync(path.join(ROOT, FILE), 'utf8');
  const assets = (html.match(/<script src="(assets\/[^"]+)"/g) || []).map((s) => s.match(/"([^"]+)"/)[1]);
  assert.ok(assets.indexOf('assets/liff-relogin.js') >= 0, '⬛ asset 清單抽不到 liff-relogin.js ⇒ 這一段沒掃到東西');
  assets.forEach((a) => {
    const src = S.stripComments(fs.readFileSync(path.join(ROOT, a), 'utf8'));
    assert.equal(n(src, /\bidToken\b/g), 0, a + ' 自己在組 idToken');
  });
});

test('🔴 取參數只走共用的 urlParam，舊的自寫正則不在了；script 載入順序對', () => {
  // ⚠️ 不寫「func」＋「tion q(k){…}」字面樣式——source-scan-tripwire 會把它判成手寫抽取式。
  const html = fs.readFileSync(path.join(ROOT, FILE), 'utf8');
  const 內文 = html.replace(/<!--[\s\S]*?-->/g, '');
  assert.ok(內文.indexOf('return urlParam(k);') >= 0, 'q() 沒有委派給共用函式');
  assert.ok(!/new RegExp\('\[\?&\]'\+k/.test(內文), '舊的自寫正則還在 ⇒ 換來源時這一頁會靜靜地繼續走舊路');
  const at = (s) => html.indexOf(s);
  const inline = html.indexOf('<script>');
  ['<script src="https://static.line-scdn.net/liff/edge/2/sdk.js"></script>',
   '<script src="assets/url-token.js"></script>',
   '<script src="assets/liff-relogin.js"></script>'].forEach((tag) => {
    assert.ok(at(tag) > 0, '少載了 ' + tag);
    assert.ok(at(tag) < inline, tag + ' 排在內嵌 script 之後 ⇒ 內嵌那段一跑就 ReferenceError');
  });
});

test('🔴 行為面：q() 與 urlParam 對同一組輸入逐字相同（含壞的百分比編碼）', () => {
  const { ctx, cleanup } = run({ search: '?t=STUBTOKEN&act=A1&zz=%E4%B8%AD&bad=%&empty=' });
  try {
    ['t', 'act', 'zz', 'bad', 'empty', '沒有這個參數'].forEach((k) => {
      assert.strictEqual(ctx.q(k), ctx.urlParam(k), 'q("' + k + '") 與 urlParam 不一致');
    });
    assert.strictEqual(ctx.q('zz'), '中', '⬛ decodeURIComponent 沒作用 ⇒ 這組輸入沒有鑑別力');
    assert.strictEqual(ctx.q('bad'), '%', '壞的百分比編碼要回原字串，不可以拋');
  } finally { cleanup(); }
});

test('TOKEN 只有一個宣告點；LIFF ID 與 hr-stats／board 同一條', () => {
  const html = fs.readFileSync(path.join(ROOT, FILE), 'utf8');
  assert.strictEqual((html.match(/var TOKEN\b/g) || []).length, 1);
  const pick = (f) => (fs.readFileSync(path.join(ROOT, f), 'utf8').match(/^var LIFF_ID='([^']+)';/m) || [])[1];
  assert.ok(pick(FILE), '找不到 LIFF_ID');
  assert.equal(pick(FILE), pick('hr-stats.html'));
  assert.equal(pick(FILE), pick('board.html'));
});
