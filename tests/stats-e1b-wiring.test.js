/**
 * E1b：`stats.html`（活動紀錄看板，佳岑用）的兩條進場路（2026-09-13）。
 *
 * 🔴 **為何非有這一支不可**：既有碰 `stats.html` 的測試不是抽單支函式配替身
 *    （`board-cache-wiring` 等），就是整頁帶 `?t=STUBTOKEN` 載入（`page-load`）
 *    ⇒ 它們跑的**永遠是舊路**。新路一行都沒被執行過，而它們全綠。
 *
 * ⚠️ 手法與 `attend-checkin-e1b-wiring`／`hr-stats-e1b-wiring` 同型：同一支
 *    `tests/helpers/page-stub.js`（不另抄一份環境——兩份的嚴格度會靜默分歧）。
 *
 * 🔴 **與 attend 的差別，也是這一檔最要緊的一格**：本頁打後端的出口有四十幾處
 *    （五個分頁、各種按鈕、`roster-dl.js` 借走的 jsonp），身分閘門只放在 `jsonp()` 開頭一處。
 *    ⇒ 「沒登入不發車」要用**首載以外的出口**去驗（分頁、寫入、借走的 jsonp），
 *      只驗首載的話，閘門放錯位置（例如只包 FIRST）也會綠。
 *
 * ⚠️ **這一檔證明不了②在線上會通。** 本頁三發 batch 的子項守門在後端仍吃 `p.token`，
 *    會發 LINE 的 4 支與 `getSeniorNotice` 的第二道在 gas 刀 5（未上線）——那一半本 repo 量不到。
 *
 * 🔴 退路「①舊路送出去的網址與改動前逐字相同」刻意做成**一次性實測**，不做常駐夾具
 *    （改動前那份副本一產生就開始腐爛）。證據在交件回報。
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { runPage, settle, execOnly, ROOT } = require('./helpers/page-stub.js');
const S = require('./helpers/source-scan.js');

const FILE = 'stats.html';
/** 本頁首載是好幾層 then ＋ webcrypto 算指紋，三個 setImmediate 不夠。 */
async function drain() { for (let i = 0; i < 15; i++) await settle(); }

/**
 * 讓頁面的 fetch 立刻回 JSONP。只有首載那一發給成功的資料（要驗快取指紋），
 * 其餘一律 `{ok:false}`——不讓假 DOM 上的渲染器去碰它不需要的欄位。
 */
function replying(ctx, urls) {
  ctx.fetch = (u) => {
    urls.push(String(u));
    const sp = new URL(String(u)).searchParams;
    let body = { ok: false, msg: '測試替身' };
    if (sp.get('action') === 'batch' && /listActivities/.test(sp.get('list') || '')) {
      body = { ok: true, results: {
        listActivities: { ok: true, rows: [{ id: 'A1', name: '中秋', status: '開放', open: true, replies: 1 }] },
        getActivityStats: { ok: true, who: '佳岑', activity: { id: 'A1', name: '中秋', status: '開放' },
          counts: { attend: 1, absent: 0, boundNoReply: 0, notBound: 0, total: 1, replied: 1, meat: 1, veg: 0 },
          opinions: [], absentList: [], boundNoReply: [], notBound: [] },
      } };
    }
    return Promise.resolve({ text: () => Promise.resolve('cb(' + JSON.stringify(body) + ')') });
  };
}

/** 首載以外的出口：分頁載入、借給 roster-dl 的 jsonp、一支不需要 confirm 的寫入。 */
function pokeOtherExits(ctx) {
  ctx.loadActs();                 // 「活動」分頁
  ctx.snLoad();                   // 「員工」分頁：年資里程碑
  ctx.loadBindLink();             // 「員工」分頁：重新綁定連結（沒走 queueRead）
  ctx.downloadRosterFlat();       // roster-dl.js 用的是本頁借出去的 jsonp
  ctx.setSt('A1', '開放');        // 寫入（重新開放不需要 confirm）
}

const fp = (s) => crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 12);

/**
 * 等一個 Promise，但最多等 ms。**本頁的閘門失敗形態是「永遠不 resolve」**——
 * 直接 await 的話，閘門壞掉時測試是**卡住**不是**紅**（突變實測：跑到 180 秒逾時，一條紅字都沒有）。
 */
function within(p, ms, what) {
  let t;
  return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error(what + '：' + ms + 'ms 內沒有回來')), ms); })])
    .finally(() => clearTimeout(t));
}

/* ══ 兩條路的首載 ════════════════════════════════════════════════════ */

test('①舊路：帶 ?t= → 不碰 LIFF，FP 是網址上那串，首載帶 token、不帶 idToken', async () => {
  const { ctx, urls, liff, cleanup } = runPage({ file: FILE, search: '?t=STUBTOKEN&act=A1' });
  await drain();
  try {
    assert.equal(ctx.TOKEN, 'STUBTOKEN');
    assert.equal(ctx.FP, 'STUBTOKEN', '舊路的快取指紋必須與改動前相同（否則佳岑回訪秒開的快取整批失效）');
    assert.equal(ctx.AUTH_OK, true, '①的 AUTH_OK 要同步為真，否則 jsonp 的閘門會讓舊路多繞一圈');
    assert.equal(liff.__initCalled, 0, '舊路不該去初始化 LIFF');
    const e = execOnly(urls);
    assert.ok(e.length >= 1, '舊路沒發車 ⇒ 我把現行行為弄壞了');
    assert.match(e[0], /action=batch/);
    assert.match(e[0], /[?&]token=STUBTOKEN/);
    assert.equal(/idToken=/.test(e[0]), false, '舊路帶了 idToken ⇒ 後端 doGet 會把舊路改道');
  } finally { cleanup(); }
});

test('②新路：沒有 ?t= → 走 LIFF，FP 換成 sub，首載帶 idToken、不帶 token', async () => {
  const { ctx, urls, liff, cleanup } = runPage({ file: FILE, search: '?act=A1' });
  await drain();
  try {
    assert.equal(ctx.TOKEN, '');
    assert.equal(liff.__initCalled, 1, '沒有 ?t= 卻沒去初始化 LIFF ⇒ 新路根本沒跑');
    assert.equal(ctx.FP, 'U_SUB_1', '指紋沒換成 sub');
    const e = execOnly(urls);
    assert.ok(e.length >= 1, '正常情況也沒發車');
    assert.match(e[0], /action=batch/);
    assert.match(e[0], /[?&]idToken=IDTOK/, '首載沒帶憑證');
    assert.equal(/[?&]token=/.test(e[0]), false, '②帶了 token 參數上去（jsonp 會濾掉空值，帶了代表 TOKEN 不是空的）');
  } finally { cleanup(); }
});

test('②還沒登入 → 去登入，redirectUri 保留整串 query（?act= 與 ?mt=）', async () => {
  const { liff, urls, cleanup } = runPage({ file: FILE, search: '?act=A1&mt=MT', loggedIn: false });
  await drain();
  try {
    assert.ok(liff.__loginArgs, '沒有呼叫 liff.login');
    assert.equal(liff.__loginArgs.redirectUri, 'http://localhost/stats.html?act=A1&mt=MT');
    assert.equal(urls.length, 0, '導頁中還送出了請求');
  } finally { cleanup(); }
});

/* ══ 🔴 閘門在 jsonp 一處：首載以外的出口也要擋 ═══════════════════════ */

for (const [名, opts] of [
  ['還沒登入', { loggedIn: false }],
  ['登入了但拿不到憑證', { idToken: '' }],
  ['LIFF 元件整個沒載入', { noLiff: true }],
]) {
  test(`🔴 ${名} → 首載不發車，分頁／roster-dl／寫入這些出口也一發都不送`, async () => {
    const { ctx, urls, cleanup } = runPage(Object.assign({ file: FILE, search: '?act=A1' }, opts));
    await drain();
    try {
      pokeOtherExits(ctx);
      await drain();
      assert.equal(urls.length, 0, '身分沒確認卻送了 ' + urls.length + ' 個請求：' + urls.join(' | '));
    } finally { cleanup(); }
  });
}

test('⬛ 對照組：登入成功時，同一組出口**確實會**送出，而且每一發都帶 idToken、都不帶 token', async () => {
  const { ctx, urls, cleanup } = runPage({ file: FILE, search: '?act=A1' });
  replying(ctx, urls);
  await drain();
  try {
    const n = execOnly(urls).length;
    assert.ok(n >= 1, '首載沒送 ⇒ 下面量的東西沒有前提');
    pokeOtherExits(ctx);
    await drain();
    const e = execOnly(urls);
    const acts = e.slice(n).map((u) => new URL(u).searchParams.get('action'));
    ['listActivities', 'getSeniorNotice', 'getBindLink', 'getRosterExport', 'setActivityStatus'].forEach((a) => {
      assert.ok(acts.indexOf(a) >= 0, a + ' 沒有送出 ⇒ 上面三條「一發都不送」零鑑別力（實送：' + acts.join(',') + '）');
    });
    e.forEach((u) => {
      assert.match(u, /[?&]idToken=IDTOK(&|$)/, '這一發沒帶憑證：' + u);
      assert.equal(/[?&]token=/.test(u), false, '這一發帶了 token：' + u);
    });
  } finally { cleanup(); }
});

test('🔴 ②idToken 是「呼叫當下才取」：開頁之後換了 token，下一發帶的是新的', async () => {
  const { ctx, urls, cleanup } = runPage({ file: FILE, search: '?act=A1' });
  replying(ctx, urls);
  await drain();
  try {
    ctx.liff.getIDToken = () => 'IDTOK_REFRESHED';
    ctx.loadBindLink();
    await drain();
    const last = execOnly(urls).pop();
    assert.match(last, /action=getBindLink/);
    assert.match(last, /idToken=IDTOK_REFRESHED/, '送出去的還是開頁時那顆');
  } finally { cleanup(); }
});

/* ══ 快取指紋：②不可以落在空字串那一格 ═══════════════════════════════ */

for (const [路, search, want] of [['②', '?act=A1', 'U_SUB_1'], ['⬛①（對照組）', '?t=STUBTOKEN&act=A1', 'STUBTOKEN']]) {
  test(`🔴 ${路} 首載 batch 存進快取的鍵，指紋是 ${want} 的、不是空字串的`, async () => {
    const { ctx, urls, cleanup } = runPage({ file: FILE, search });
    replying(ctx, urls);
    await drain();
    try {
      const keys = [];
      for (let i = 0; i < ctx.localStorage.length; i++) keys.push(ctx.localStorage.key(i));
      const mine = keys.filter((k) => k.indexOf('jdcBoard:v1:' + fp(want) + ':') === 0);
      assert.ok(mine.length >= 1, '沒有任何鍵落在 ' + want + ' 的指紋下（實際：' + keys.join(', ') + '）');
      assert.equal(keys.filter((k) => k.indexOf('jdcBoard:v1:' + fp('') + ':') === 0).length, 0,
        '有鍵落在空字串的指紋下 ⇒ 同一台裝置上不同人的快取會混在一起');
    } finally { cleanup(); }
  });
}

for (const [路, search, want] of [['②', '?act=A1', 'U_SUB_1'], ['⬛①（對照組）', '?t=STUBTOKEN&act=A1', 'STUBTOKEN']]) {
  test(`🔴 ${路} 開頁解密快取（cacheBootstrap）用的指紋是 ${want}——要等登入完才開，不能先拿空字串開`, async () => {
    const { ctx, cleanup } = runPage({ file: FILE, search });
    // 頁面同步跑完之後、任何微任務之前換上計數器：CACHE_READY 若排在 AUTH_READY 後面，
    // 呼叫會發生在這之後而被記到；若在頂層同步呼叫（突變 M12），這裡永遠記不到。
    const seen = [];
    const orig = ctx.cacheBootstrap;
    ctx.cacheBootstrap = (t, n) => { seen.push(t); return orig(t, n); };
    await drain();
    try {
      assert.deepEqual(seen, [want], '開快取的指紋不對 ⇒ ②回訪秒顯永遠落空，或讀到空字串那一格');
    } finally { cleanup(); }
  });
}

/* ══ jsonp 出口接了 liff-relogin，而且中間兩層（surfaceErr／denyNoRole）沒吃掉 reason ══ */

test('🔴 line_bad_token → 真的登出＋重新登入', async () => {
  const { ctx, urls, cleanup } = runPage({ file: FILE, search: '?act=A1' });
  await drain();
  try {
    let out = 0;
    ctx.liff.logout = () => { out++; };
    ctx.fetch = (u) => { urls.push(String(u));
      return Promise.resolve({ text: () => Promise.resolve('cb({"ok":false,"reason":"line_bad_token","msg":"x"})') }); };
    await within(ctx.jsonp('getBindLink', { token: ctx.TOKEN }, 1000), 3000, '登入完之後的 jsonp');
    assert.equal(out, 1, '憑證死了卻沒有登出 ⇒ 照畫面「關掉重開」會無限迴圈');
  } finally { cleanup(); }
});

test('⬛ 對照組：重登沒用的代號（line_unbound）不登出，而且 reason 原樣交還', async () => {
  const { ctx, urls, cleanup } = runPage({ file: FILE, search: '?act=A1' });
  await drain();
  try {
    let out = 0;
    ctx.liff.logout = () => { out++; };
    ctx.fetch = (u) => { urls.push(String(u));
      return Promise.resolve({ text: () => Promise.resolve('cb({"ok":false,"reason":"line_unbound","msg":"x"})') }); };
    const r = await within(ctx.jsonp('getBindLink', { token: ctx.TOKEN }, 1000), 3000, '登入完之後的 jsonp');
    assert.equal(out, 0);
    assert.equal(r.reason, 'line_unbound', '回應被吃掉了——後面的失敗畫面拿不到它');
  } finally { cleanup(); }
});

/* ══ 兩個跨頁連結 ═════════════════════════════════════════════════════ */

for (const [路, search, want] of [['②', '?act=A1', 'board.html'], ['⬛①（對照組）', '?t=STUBTOKEN', 'board.html?t=STUBTOKEN']]) {
  test(`${路} 管理者的「人事異動看板」連結是 ${want}`, async () => {
    const { ctx, cleanup } = runPage({ file: FILE, search });
    await drain();
    try {
      const got = [];
      // 🔴 鑑別力在這一行：假 DOM 的 getElementById 回真值，不改的話 showAdminSwitch 第一格就 return。
      const orig = ctx.document.getElementById;
      ctx.document.getElementById = (id) => (id === 'adm-switch' ? null : orig(id));
      ctx.document.body.appendChild = (el) => { got.push(el.href); };
      ctx.showAdminSwitch(true);
      assert.deepEqual(got, [want]);
    } finally { cleanup(); }
  });
}

// E1b（2026-09-13，線 WL）：wall.html 已有 LINE 登入 ⇒ ②也開，網址不帶 `?t=`。
for (const [路, search, want] of [['②', '?act=A1', 'wall.html?act=A1'], ['⬛①（對照組）', '?t=STUBTOKEN', 'wall.html?t=STUBTOKEN&act=A1']]) {
  test(`${路}「進場人數」開 ${want}`, async () => {
    const { ctx, cleanup } = runPage({ file: FILE, search });
    await drain();
    try {
      const opened = [];
      const msg = { textContent: '', className: '' };
      ctx.open = (u) => { opened.push(u); };
      const orig = ctx.document.getElementById;
      ctx.document.getElementById = (id) => (id === 'ti-act' ? { value: 'A1' } : id === 'sm-msg' ? msg : orig(id));
      ctx.openArrival();
      assert.deepEqual(opened, [want], search.indexOf('t=') >= 0
        ? '舊路開出去的網址變了 ⇒ 我把現行行為弄壞了'
        : '②沒有開 wall.html（或開成了 wall.html?t= 這種必定失敗的網址）');
      assert.equal(msg.textContent, '', '開了視窗還掛著錯誤訊息');
    } finally { cleanup(); }
  });
}

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
  // 本頁載入的本地 asset 一支都不可以自己帶憑證（roster-dl 借的是本頁的 jsonp）
  const html = fs.readFileSync(path.join(ROOT, FILE), 'utf8');
  const assets = (html.match(/<script src="(assets\/[^"]+)"/g) || []).map((s) => s.match(/"([^"]+)"/)[1]);
  assert.ok(assets.indexOf('assets/roster-dl.js') >= 0, '⬛ asset 清單抽不到 roster-dl.js ⇒ 這一段沒掃到東西');
  assets.forEach((a) => {
    if (/\.min\.js$/.test(a)) return;
    const src = S.stripComments(fs.readFileSync(path.join(ROOT, a), 'utf8'));
    assert.equal(n(src, /\bidToken\b/g), 0, a + ' 自己在組 idToken');
  });
});

test('🔴 身分閘門就在 jsonp 開頭（排在組參數之前）', () => {
  const src = S.stripComments(S.fnSrc('jsonp', FILE));
  const gate = src.indexOf('if(!AUTH_OK)return AUTH_READY.then(');
  const build = src.indexOf('var qs=');
  assert.ok(gate > 0, 'jsonp 開頭沒有身分閘門');
  assert.ok(gate < build, '閘門排在組網址之後');
});

test('🔴 取參數只走共用的 urlParam，舊的自寫正則不在了；script 載入順序對', () => {
  const html = fs.readFileSync(path.join(ROOT, FILE), 'utf8');
  const 內文 = html.replace(/<!--[\s\S]*?-->/g, '');
  assert.ok(內文.indexOf('return urlParam(k);') >= 0, 'q() 沒有委派給共用函式');
  assert.ok(!/new RegExp\('\[\?&\]'\+k/.test(內文), '舊的自寫正則還在 ⇒ 換來源時這一頁會靜靜地繼續走舊路');
  const at = (s) => html.indexOf(s);
  const inline = html.indexOf('<script>');
  ['<script src="https://static.line-scdn.net/liff/edge/2/sdk.js"></script>',
   '<script src="assets/url-token.js"></script>',
   '<script src="assets/liff-relogin.js"></script>',
   '<script src="assets/deny-no-role.js"></script>'].forEach((tag) => {
    assert.ok(at(tag) > 0, '少載了 ' + tag);
    assert.ok(at(tag) < inline, tag + ' 排在內嵌 script 之後 ⇒ 內嵌那段一跑就 ReferenceError');
  });
});

test('🔴 行為面：q() 與 urlParam 對同一組輸入逐字相同（含壞的百分比編碼）', async () => {
  const { ctx, cleanup } = runPage({ file: FILE, search: '?t=STUBTOKEN&act=A1&zz=%E4%B8%AD&bad=%&empty=' });
  await drain();
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
