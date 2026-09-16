/**
 * assets/version-probe.js 的純函式（票 #103 的量法）。
 *
 * 🔴 這一檔要證明的只有三件事，而且每一件都附對照組：
 *    ① 判決函式**分得出**「版本一致」與「版本不一致」——分不出的話，
 *       那支量法對任何輸入都印同一句話，什麼都沒測到。
 *    ② 佇列探針分得出「通暢」與「卡住」——後者用一條**真的永遠不結束**的佇列造出來。
 *    ③ 輸出裡**結構上**不可能出現授權字串——不是「這次沒印到」，是餵它一個
 *       塞滿授權參數的網址，斷言輸出裡一個字都不剩。
 */
const { test } = require('node:test');
const assert = require('node:assert');
const P = require('../assets/version-probe.js');

/* ══ ① 版本判決的零點 ══════════════════════════════════════════════ */

test('⬛ 零點：classifyRow 分得出三種世界（同版／不同版／量不到）', () => {
  assert.equal(P.classifyRow({ cached: { hash: 'aaaa' }, server: { hash: 'aaaa' } }), '同版');
  assert.equal(P.classifyRow({ cached: { hash: 'aaaa' }, server: { hash: 'bbbb' } }), '🔴 不同版');
  // 🔴 取不到不可以判成「同版」：那會讓壞掉的量法對所有輸入都說「一切正常」
  assert.equal(P.classifyRow({ cached: null, server: { hash: 'bbbb' } }), '量不到');
  assert.equal(P.classifyRow({ cached: { hash: 'aaaa' }, server: null }), '量不到');
  assert.equal(P.classifyRow(null), '量不到');
});

test('⬛ 零點：hash32 對「差一個位元組」要給不同值（否則上面那條恆真）', () => {
  assert.notEqual(P.hash32('var a=1;'), P.hash32('var a=2;'));
  assert.equal(P.hash32('var a=1;'), P.hash32('var a=1;'));
  assert.equal(P.hash32('x').length, 8, '固定 8 位十六進位，輸出才對得齊');
});

/* ══ ② 佇列探針的零點 ═════════════════════════════════════════════ */

// 受測物就是正式碼在用的那個形狀（board-cache.js 的 queueRead）
function makeQueue() {
  let tail = Promise.resolve();
  return function queueRead(fn) {
    const p = tail.then(fn, fn);
    tail = p.catch(function () { });
    return p;
  };
}

test('⬛ 零點：佇列通暢時回「通暢」', async () => {
  const r = await P.queueProbe(makeQueue(), 300);
  assert.equal(r.state, '通暢', JSON.stringify(r));
});

test('🔴 佇列被一支「永遠不結束」的讀取卡住 → 回「🔴 卡住」', async () => {
  const q = makeQueue();
  // jsonp() 的身分閘門在擋下時回的就是這個東西：`new Promise(function(){})`
  q(function () { return new Promise(function () { }); });
  const r = await P.queueProbe(q, 300);
  assert.equal(r.state, '🔴 卡住', JSON.stringify(r));
  assert.ok(r.why.includes('永遠不結束'), '要說出卡住的意思，不能只給一個狀態字');
});

test('對照組：被**拒絕**的讀取不會卡住佇列（queueRead 接得住拒絕，接不住不結束）', async () => {
  const q = makeQueue();
  q(function () { return Promise.reject(new Error('boom')); }).catch(() => { });
  const r = await P.queueProbe(q, 300);
  assert.equal(r.state, '通暢', '這一格若也是「卡住」，上一條就不是在測「不結束」');
});

test('沒有佇列函式時回「量不到」，不回「通暢」', async () => {
  const r = await P.queueProbe(undefined, 50);
  assert.equal(r.state, '量不到');
});

/* ══ ③ 輸出不得帶出授權字串（本 repo 為 PUBLIC）═══════════════════ */

const 授權網址 = 'https://script.google.com/macros/s/AKfyc_DEPLOY_ID/exec'
  + '?action=batch&token=SECRET_TOKEN_VALUE&idToken=eyJraWQiOiJTECRETJWT'
  + '&list=' + encodeURIComponent(JSON.stringify([{ a: 'listActivities' }, { a: 'getActivityStats', p: { act: 'A1' } }]))
  + '&callback=cb';

test('🔴 redactExec：只留 action 與 batch 子項，授權字串一個字都不剩', () => {
  const out = P.redactExec(授權網址);
  assert.equal(out, 'batch[listActivities,getActivityStats]');
  ['SECRET_TOKEN_VALUE', 'SECRETJWT', 'AKfyc_DEPLOY_ID', 'token', 'idToken'].forEach((s) => {
    assert.ok(!out.includes(s), '輸出帶出了 ' + s);
  });
});

test('對照組：redactExec 認得出單支 action（否則上一條的「沒帶出來」是因為它什麼都沒回）', () => {
  assert.equal(P.redactExec('https://script.google.com/x/exec?action=getSeniorNotice&token=T&year=2025'),
    'getSeniorNotice');
  assert.equal(P.redactExec('https://example.invalid/assets/x.js'), null, '非 /exec 一律不列');
  assert.equal(P.redactExec('https://script.google.com/x/exec?token=T'), null, '沒有 action 就不是一發呼叫');
});

test('redactExec：action 名只留英數底線（後端若回奇怪的字，不會被原樣印出去）', () => {
  assert.equal(P.redactExec('https://x/exec?action=' + encodeURIComponent('<img src=x>')), 'imgsrcx');
  assert.equal(P.redactExec('https://x/exec?action=' + encodeURIComponent('<>')), null);
});

/* ══ 報告本文 ═════════════════════════════════════════════════════ */

const 樣本 = {
  rows: [
    { name: 'stats.html', isDoc: true, verdict: '同版', cached: { hash: 'aaaaaaaa' }, server: { hash: 'aaaaaaaa' }, fromCache: false },
    { name: 'board-cache.js', isDoc: false, verdict: '同版', cached: { hash: 'cccccccc' }, server: { hash: 'cccccccc' }, fromCache: true },
  ],
  docLastModified: 'Tue, 16 Sep 2026 09:00:00 GMT',
  gasFingerprint: 'deadbeef',
  calls: [{ action: 'batch[listActivities]', ms: 1800, endedAt: 2400 }],
  promises: [{ name: 'AUTH_READY', state: '已完成', ms: 12 }, { name: 'FIRST(首載批次)', state: '等待中', ms: null }],
  queue: { state: '通暢', ms: 1, why: '' },
  at: '2026/9/16 19:00:00', sincePageStart: 5000,
};

test('🔴 renderReport：兩種世界印出來的東西不一樣（一致 vs 不一致）', () => {
  const 一致 = P.renderReport(樣本);
  const 不一致 = P.renderReport(Object.assign({}, 樣本, {
    rows: [
      { name: 'stats.html', isDoc: true, verdict: '🔴 不同版', cached: { hash: 'aaaaaaaa' }, server: { hash: 'zzzzzzzz' }, fromCache: true },
      樣本.rows[1],
    ],
  }));
  assert.notEqual(一致, 不一致, '兩種世界印一樣的東西 ⇒ 這支量法什麼都沒測到');
  assert.ok(一致.includes('同版 2、不同版 0'), 一致);
  assert.ok(不一致.includes('不同版 1'), 不一致);
  assert.ok(不一致.includes('🔴 不同版 stats.html'), 不一致);
});

test('renderReport：頁面本身永遠列出來，同版的其他資源不占行', () => {
  const t = P.renderReport(樣本);
  assert.ok(t.includes('stats.html'), '版本的錨不能被摺掉');
  assert.ok(!t.includes('board-cache.js'), '同版的資源不逐行印（手機上一行都是成本）');
});

test('🔴 renderReport：自檢那一行一定在，而且三個判決都對', () => {
  const t = P.renderReport(樣本);
  assert.ok(t.includes('已知同版→同版／已知不同版→🔴 不同版／取不到→量不到'), t);
});

test('🔴 renderReport：伺服器沒送 Last-Modified 時要講出來（document.lastModified 會退回「現在」）', () => {
  const t = P.renderReport(Object.assign({}, 樣本, { docLastModified: '' }));
  assert.ok(t.includes('伺服器沒送'), t);
  assert.ok(t.includes('不可以當版本用'), t);
});

test('renderReport：佇列卡住時，那一行要自己說得出是什麼意思', () => {
  const t = P.renderReport(Object.assign({}, 樣本, {
    queue: { state: '🔴 卡住', ms: 6000, why: '排進去等了 6000ms 還沒輪到，前面有一支讀取永遠不結束' },
  }));
  assert.ok(t.includes('讀取佇列：🔴 卡住'), t);
  assert.ok(t.includes('永遠不結束'), t);
});

test('renderReport：一發 /exec 都沒完成時要明說，不可以印成空白', () => {
  const t = P.renderReport(Object.assign({}, 樣本, { calls: [] }));
  assert.ok(t.includes('沒有已完成的 /exec'), t);
});

test('🔴 renderReport：後端沒有版本欄位這件事要印在報告裡（量不到就說量不到）', () => {
  assert.ok(P.renderReport(樣本).includes('回應本身沒有版本欄位'));
});

/* ══ trackPromise ═════════════════════════════════════════════════ */

test('trackPromise：等待中／已完成／失敗 三種狀態分得出來', async () => {
  const reg = [];
  P.trackPromise(reg, '會完成', Promise.resolve(1));
  P.trackPromise(reg, '會失敗', Promise.reject(new Error('x')));
  P.trackPromise(reg, '不結束', new Promise(function () { }));
  P.trackPromise(reg, '不是 Promise', null);
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(reg.map((r) => r.name + ':' + r.state),
    ['會完成:已完成', '會失敗:🔴 失敗', '不結束:等待中', '不是 Promise:量不到']);
});

test('🔴 trackPromise 追蹤一個被拒絕的 Promise，不可以自己生出沒人接的拒絕', async () => {
  const seen = [];
  const on = (e) => seen.push(e);
  process.on('unhandledRejection', on);
  const p = Promise.reject(new Error('boom'));
  P.trackPromise([], 'x', p);
  p.catch(() => { });                       // 原本那顆由呼叫端自己接（頁面上是 SECOND_DONE 那行）
  await new Promise((r) => setTimeout(r, 50));
  process.off('unhandledRejection', on);
  assert.deepEqual(seen, [], '量測自己製造了新的錯誤：' + seen.map(String).join(','));
});

test('shortName：長網址收成檔名，查詢字串不留', () => {
  assert.equal(P.shortName('https://x.example/a/b/stats.html?t=SECRET#z'), 'stats.html');
});
