/**
 * E1b：`attend.html`（副總的活動出席看板）與 `checkin.html`（活動報到看板）的兩條進場路（2026-09-13）。
 *
 * 🔴 **為何非有這一支不可**：`page-load.test.js` 開頁時網址帶 `?t=STUBTOKEN`、
 *    `checkin-page-wiring.test.js` 的 SEARCH 也帶 `?t=` ⇒ 它們跑的**永遠是舊路**。
 *    新路一行都沒被執行過，而它們全綠。（同 `hr-stats-e1b-wiring.test.js` 檔頭。）
 *
 * ⚠️ 手法與 `hr-stats-e1b-wiring.test.js` 同型：同一支 `tests/helpers/page-stub.js`、同一種 settle。
 *
 * ⚠️ **這一檔證明不了②在線上會通。** 它跑的是本機替身，後端那一半在 `jdc-line-gas`，本 repo 量不到。
 *    這裡只證明「前端送出去的東西對、該擋的時候擋住」。
 *    （寫這一檔時另有一個理由：後端 `runBatch_` 的子項守門吃 `p.token`，②是空字串 ⇒ 子項全擋。
 *     那一格已解除——gas `dbc8b17`，隨 gas main `04022c4` 於 2026-09-13 17:03:49 上線。
 *     但線上仍沒有人用 LINE 實際開過 attend，所以上面那句照樣成立。）
 *
 * 🔴 退路「①舊路送出去的網址與改動前逐字相同」刻意做成**一次性實測**，不做常駐夾具
 *    （理由同 hr-stats-e1b-wiring：改動前那份副本一產生就開始腐爛）。證據在交件回報。
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { runPage, settle, execOnly, ROOT } = require('./helpers/page-stub.js');

/** 讓頁面下一發 fetch 回指定的 JSONP 內容（page-stub 預設永遠 pending）。 */
function replyWith(ctx, urls, obj) {
  ctx.fetch = (u) => {
    urls.push(String(u));
    return Promise.resolve({ text: () => Promise.resolve('cb(' + JSON.stringify(obj) + ')') });
  };
}

/* ══════════════════════════════════════════════════════════════════════
 * attend.html
 * ════════════════════════════════════════════════════════════════════ */

test('attend ①舊路：帶 ?t= → 不碰 LIFF，FP 是網址上那串，首載帶 token、不帶 idToken', async () => {
  const { ctx, urls, liff, cleanup } = runPage({ file: 'attend.html', search: '?t=STUBTOKEN&act=A1' });
  await settle();
  try {
    assert.equal(ctx.TOKEN, 'STUBTOKEN');
    assert.equal(ctx.FP, 'STUBTOKEN', '舊路的快取指紋必須與改動前相同（否則副總回訪秒開的快取整批失效）');
    assert.equal(liff.__initCalled, 0, '舊路不該去初始化 LIFF');
    const e = execOnly(urls);
    assert.ok(e.length >= 1, '舊路沒發車 ⇒ 我把現行行為弄壞了');
    assert.match(e[0], /action=batch/);
    assert.match(e[0], /[?&]token=STUBTOKEN/);
    assert.equal(/idToken=/.test(e[0]), false, '舊路帶了 idToken ⇒ 後端 doGet 會把舊路改道');
  } finally { cleanup(); }
});

test('attend ②新路：沒有 ?t= → 走 LIFF，FP 換成 sub，首載帶 idToken、不帶 token', async () => {
  const { ctx, urls, liff, cleanup } = runPage({ file: 'attend.html', search: '?act=A1' });
  await settle();
  try {
    assert.equal(ctx.TOKEN, '');
    assert.equal(liff.__initCalled, 1, '沒有 ?t= 卻沒去初始化 LIFF ⇒ 新路根本沒跑');
    assert.equal(ctx.FP, 'U_SUB_1', '指紋沒換成 sub');
    assert.notEqual(ctx.FP, '', '指紋是空字串 ⇒ 共用裝置上不同人的快取（含未回覆者姓名）會混在一起');
    const e = execOnly(urls);
    assert.ok(e.length >= 1, '正常情況也沒發車');
    assert.match(e[0], /action=batch/);
    assert.match(e[0], /[?&]idToken=IDTOK/, '首載沒帶憑證');
    assert.equal(/[?&]token=/.test(e[0]), false, '②帶了 token 參數上去（本頁 jsonp 會濾掉空值，帶了代表 TOKEN 不是空的）');
  } finally { cleanup(); }
});

test('🔴 attend ②新路：idToken 是「呼叫當下才取」，切活動那一發也帶最新的（兼 load() 的正向對照組）', async () => {
  const { ctx, urls, cleanup } = runPage({ file: 'attend.html', search: '?act=A1' });
  // ⚠️ 首載那一發必須先**回來**：本頁同一時刻只放一支 /exec（queueRead），
  //    page-stub 的 fetch 預設永遠 pending ⇒ 不先讓它回來，load() 那一發會排在後面永遠送不出去，
  //    量到的是「佇列卡住」不是「沒帶憑證」（2026-09-13 第一版就是這樣紅的）。
  //    首載 fetch 發生在 AUTH_READY 之後的微任務裡 ⇒ 這裡同步換掉還來得及。
  replyWith(ctx, urls, { ok: false, msg: '伺服器忙碌' });
  await settle();
  try {
    ctx.liff.getIDToken = () => 'IDTOK_REFRESHED';
    ctx.load('A2');                                   // 下拉切活動走的那條路
    await settle();
    const last = execOnly(urls).pop();
    assert.match(last, /action=getActivityStats/);
    assert.match(last, /idToken=IDTOK_REFRESHED/, '送出去的還是開頁時那顆');
  } finally { cleanup(); }
});

for (const [名, opts] of [
  ['還沒登入', { loggedIn: false }],
  ['登入了但拿不到憑證', { idToken: '' }],
  ['LIFF 元件整個沒載入', { noLiff: true }],
]) {
  test(`🔴 attend ${名} → 首載不發車，切活動（load）也不發車`, async () => {
    const { ctx, urls, cleanup } = runPage(Object.assign({ file: 'attend.html', search: '?act=A1' }, opts));
    await settle();
    try {
      ctx.load('A2');
      await settle();
      assert.equal(urls.length, 0, '身分沒確認卻送了 ' + urls.length + ' 個請求：' + urls.join(' | '));
    } finally { cleanup(); }
  });
}

test('attend 還沒登入 → 去登入，redirectUri 保留 ?act=（登入回來還是那一場）', async () => {
  const { liff, cleanup } = runPage({ file: 'attend.html', search: '?act=A1', loggedIn: false });
  await settle();
  try {
    assert.ok(liff.__loginArgs, '沒有呼叫 liff.login');
    assert.equal(liff.__loginArgs.redirectUri, 'http://localhost/attend.html?act=A1');
  } finally { cleanup(); }
});

test('🔴 attend jsonp 出口接了 liff-relogin：line_bad_token → 真的登出＋重新登入', async () => {
  const { ctx, urls, cleanup } = runPage({ file: 'attend.html', search: '?act=A1' });
  await settle();
  try {
    let out = 0;
    ctx.liff.logout = () => { out++; };
    replyWith(ctx, urls, { ok: false, reason: 'line_bad_token', msg: 'x' });
    await ctx.jsonp('getActivityStats', { token: ctx.TOKEN, act: 'A1' });
    assert.equal(out, 1, '憑證死了卻沒有登出 ⇒ 他照著畫面「關掉重開」會無限迴圈');
  } finally { cleanup(); }
});

test('⬛ attend 對照組：重登沒用的代號（line_unbound）不登出——否則上面那條是「什麼都登出」', async () => {
  const { ctx, urls, cleanup } = runPage({ file: 'attend.html', search: '?act=A1' });
  await settle();
  try {
    let out = 0;
    ctx.liff.logout = () => { out++; };
    replyWith(ctx, urls, { ok: false, reason: 'line_unbound', msg: 'x' });
    const r = await ctx.jsonp('getActivityStats', { token: ctx.TOKEN, act: 'A1' });
    assert.equal(out, 0);
    assert.equal(r.reason, 'line_unbound', '回應被吃掉了——後面的失敗畫面拿不到它');
  } finally { cleanup(); }
});

/* ══════════════════════════════════════════════════════════════════════
 * checkin.html
 * ════════════════════════════════════════════════════════════════════ */

test('🔴 checkin ①舊路：帶 ?t=&act= → **同步**發第一發（不排在任何 Promise 後面），帶 token、不帶 idToken', () => {
  const { urls, liff, cleanup } = runPage({ file: 'checkin.html', search: '?t=STUBTOKEN&act=A1' });
  try {
    // 刻意不 await settle：checkin-page-wiring 釘著「同步秒顯、同步發第一發」這個現況。
    assert.equal(urls.length, 1, '①舊路沒有同步發車 ⇒ 現場看板的啟動順序被改了');
    assert.match(urls[0], /action=getEventCheckinStats/);
    assert.match(urls[0], /[?&]token=STUBTOKEN/);
    assert.equal(/idToken=/.test(urls[0]), false, '舊路帶了 idToken ⇒ 後端會改道');
    assert.equal(liff.__initCalled, 0);
  } finally { cleanup(); }
});

test('checkin ②新路：只有 ?act= → 走 LIFF，登入完才發，帶 idToken 與 act、不帶 token', async () => {
  const { urls, liff, cleanup } = runPage({ file: 'checkin.html', search: '?act=A1' });
  try {
    assert.equal(urls.length, 0, '②還沒登入完就發車了');
    await settle();
    assert.equal(liff.__initCalled, 1);
    assert.equal(urls.length, 1, '②登入完沒有發車（改動前這裡是「連結缺少參數」）');
    assert.match(urls[0], /action=getEventCheckinStats/);
    assert.match(urls[0], /[?&]act=A1/);
    assert.match(urls[0], /[?&]idToken=IDTOK/);
    assert.equal(/[?&]token=/.test(urls[0]), false);
  } finally { cleanup(); }
});

for (const [名, opts] of [
  ['還沒登入', { loggedIn: false }],
  ['登入了但拿不到憑證', { idToken: '' }],
  ['LIFF 元件整個沒載入', { noLiff: true }],
]) {
  test(`🔴 checkin ${名} → 不發車，15 秒輪詢與「立即刷新」（load）也不發車`, async () => {
    const { ctx, urls, cleanup } = runPage(Object.assign({ file: 'checkin.html', search: '?act=A1' }, opts));
    await settle();
    try {
      ctx.load();                                     // setInterval 與 #refresh 都是呼叫這一支
      await settle();
      assert.equal(urls.length, 0, '身分沒確認卻送了 ' + urls.length + ' 個請求：' + urls.join(' | '));
    } finally { cleanup(); }
  });
}

test('⬛ checkin 對照組：一切正常時 load() **確實會**再發一發（否則上面三條是「反正都不發」）', async () => {
  const { ctx, urls, cleanup } = runPage({ file: 'checkin.html', search: '?act=A1' });
  await settle();
  try {
    const n = urls.length;
    ctx.load();
    assert.equal(urls.length, n + 1, 'load() 在登入完之後也不發 ⇒ 上面三條零鑑別力');
  } finally { cleanup(); }
});

test('checkin 沒有 ?t= 也沒有 ?act= → 不去登入（登入回來也只會看到缺參數），一發都不送', async () => {
  const { urls, liff, cleanup } = runPage({ file: 'checkin.html', search: '' });
  await settle();
  try {
    assert.equal(liff.__initCalled, 0, '缺參數還先把人送去 LINE 登入一趟');
    assert.equal(liff.__loginArgs, null);
    assert.equal(urls.length, 0);
  } finally { cleanup(); }
});

test('🔴 checkin jget 出口接了 liff-relogin：line_bad_token → 真的登出＋重新登入；line_unbound 不登出', async () => {
  const a = runPage({ file: 'checkin.html', search: '?act=A1' });
  await settle();
  try {
    let out = 0;
    a.ctx.liff.logout = () => { out++; };
    replyWith(a.ctx, a.urls, { ok: false, reason: 'line_bad_token', msg: 'x' });
    await a.ctx.jget('getEventCheckinStats', { token: a.ctx.TOKEN, act: 'A1' });
    assert.equal(out, 1, '開著超過一小時的看板憑證過期時，不會自己重新登入');
  } finally { a.cleanup(); }

  const b = runPage({ file: 'checkin.html', search: '?act=A1' });
  await settle();
  try {
    let out = 0;
    b.ctx.liff.logout = () => { out++; };
    replyWith(b.ctx, b.urls, { ok: false, reason: 'line_unbound', msg: 'x' });
    await b.ctx.jget('getEventCheckinStats', { token: b.ctx.TOKEN, act: 'A1' });
    assert.equal(out, 0, '⬛ 對照組：重登沒用的代號也登出了');
  } finally { b.cleanup(); }
});

/* ══════════════════════════════════════════════════════════════════════
 * 兩頁共通：取值方式、宣告點、LIFF ID
 * ════════════════════════════════════════════════════════════════════ */

for (const file of ['attend.html', 'checkin.html']) {
  test(`🔴 ${file}：取參數只走共用的 urlParam，不可以自己再寫一份正則`, () => {
    // ⚠️ 不寫「func」＋「tion q(k){…}」字面樣式——source-scan-tripwire 會把它判成手寫抽取式。
    const html = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const 內文 = html.replace(/<!--[\s\S]*?-->/g, '');
    assert.ok(內文.indexOf('return urlParam(k);') >= 0, 'q() 沒有委派給共用函式');
    assert.ok(!/new RegExp\('\[\?&\]'\+k/.test(內文), '舊的自寫正則還在 ⇒ 換來源時這一頁會靜靜地繼續走舊路');
    assert.match(html, /<script src="assets\/url-token\.js"><\/script>/);
    assert.match(html, /<script src="assets\/liff-relogin\.js"><\/script>/);
  });

  test(`🔴 ${file}：行為面——q() 與 urlParam 對同一組輸入逐字相同（含壞的百分比編碼）`, async () => {
    const { ctx, cleanup } = runPage({ file, search: '?t=STUBTOKEN&act=A1&zz=%E4%B8%AD&bad=%&empty=' });
    await settle();
    try {
      ['t', 'act', 'zz', 'bad', 'empty', '沒有這個參數'].forEach((k) => {
        assert.strictEqual(ctx.q(k), ctx.urlParam(k), 'q("' + k + '") 與 urlParam 不一致');
      });
      assert.strictEqual(ctx.q('zz'), '中', '⬛ decodeURIComponent 沒作用 ⇒ 這組輸入沒有鑑別力');
      assert.strictEqual(ctx.q('bad'), '%', '壞的百分比編碼要回原字串，不可以拋');
    } finally { cleanup(); }
  });

  test(`${file}：TOKEN 只有一個宣告點；LIFF ID 與 hr-stats／board 同一條`, () => {
    const html = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const n = (html.match(/var TOKEN\b/g) || []).length;
    assert.strictEqual(n, 1, '有 ' + n + ' 個 TOKEN 宣告點');
    const pick = (f) => (fs.readFileSync(path.join(ROOT, f), 'utf8').match(/^var LIFF_ID='([^']+)';/m) || [])[1];
    assert.ok(pick(file), file + ' 找不到 LIFF_ID');
    assert.equal(pick(file), pick('hr-stats.html'));
    assert.equal(pick(file), pick('board.html'));
  });
}
