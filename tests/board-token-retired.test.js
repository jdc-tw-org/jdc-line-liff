/**
 * `board.html` 的進場路：**只剩 LINE 登入一條**（`jdc-tw-org/jdc-line-gas#99`，2026-09-18）。
 *
 * 🪦 **本檔 2026-09-12～2026-09-18 之間叫 `board-e1a-wiring.test.js`，驗的是「兩條路」。**
 *    那個前提已經被推翻，不是被放寬——`?t=` 那條路整條拆了。所以本檔**改寫不刪**：
 *    原本 ① 那幾條斷言「帶 `?t=` 不碰 LIFF、請求帶 token」，現在逐條翻面成
 *    「帶 `?t=` **仍然**走 LINE 登入、而且**一顆 token 都送不出去**」。
 *    🔴 直接刪掉它們的話，回歸會變成靜默的：把 `if(TOKEN)return Promise.resolve('token')`
 *       加回去，沒有任何一條會紅。
 *
 * 🔴 **為何非有這一支不可**：`page-load.test.js` 開 board.html 時網址帶著
 *    `?t=STUBTOKEN`。在舊寫法底下它跑的**永遠是舊路** ⇒ 新路一行都沒被執行過而全綠。
 *    （現在同一把網址跑的是 LINE 那條路，那正是本檔第一組要釘住的事。）
 *
 * ⚠️ 手法同 page-load.test.js：把頁面的 script 依序丟進 stub 環境跑，
 *    測的是 board.html 裡真正那幾行字。DOM 與網路是假的。
 *    ⬛ **真瀏覽器的那一半在 `tests/e2e/board-token-retired.spec.js`**——
 *       網址列真的有沒有被改掉、那句話真的有沒有畫出來，假 DOM 量不到。
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
// board.html 有自己的一套環境（見上方註解），這裡只借「照身分挑出那一發」這一支。
const { onlyCall } = require('./helpers/page-stub.js');

const ROOT = path.join(__dirname, '..');

function fakeEl() {
  const el = {
    style: {}, dataset: {}, options: [], children: [], classList: { add() {}, remove() {}, toggle() {} },
    appendChild() {}, removeChild() {}, insertAdjacentHTML() {}, setAttribute() {}, removeAttribute() {},
    // 墓碑那一段會 `parentNode.insertBefore(...)`／`body.insertBefore(...)`。
    // ⚠️ 少一格的症狀是「整段 inline script 在這裡 throw」，而後面的東西全都沒跑
    //    ——那會讓底下每一條都紅在一個與它自己無關的理由上。
    insertBefore() {}, firstChild: null, parentNode: null,
    addEventListener() {}, removeEventListener() {}, querySelector: () => fakeEl(),
    querySelectorAll: () => [], focus() {}, click() {}, remove() {}, scrollIntoView() {},
    textContent: '', innerHTML: '', value: '', checked: false, hidden: false, href: '',
  };
  return el;
}

/** 跑 board.html，回 ctx ＋ 送出去的網址清單。 */
function runBoard({ search, loggedIn = true, idToken = 'IDTOK', sub = 'U_SUB_1', noLiff = false }) {
  const urls = [];
  const timers = new Set();
  const store = {};
  const storage = {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; },
    clear() {}, key: (i) => Object.keys(store)[i] || null, get length() { return Object.keys(store).length; },
  };
  const pending = () => new Promise(() => {});
  const doc = {
    getElementById: () => fakeEl(), querySelector: () => fakeEl(), querySelectorAll: () => [],
    createElement: () => fakeEl(), createTextNode: () => fakeEl(),
    body: fakeEl(), documentElement: fakeEl(), head: fakeEl(),
    addEventListener() {}, removeEventListener() {}, readyState: 'complete',
  };
  const liff = {
    init: () => Promise.resolve(),
    isLoggedIn: () => loggedIn,
    getIDToken: () => idToken,
    getDecodedIDToken: () => ({ sub }),
    login(o) { liff.__loginArgs = o; },
    getProfile: pending, closeWindow() {}, openWindow() {},
    getOS: () => 'ios', isInClient: () => true, getVersion: () => '2.0.0',
    __loginArgs: null, __initCalled: 0,
  };
  const origInit = liff.init;
  liff.init = (...a) => { liff.__initCalled++; return origInit(...a); };

  const ctx = {
    console, document: doc,
    navigator: { userAgent: 'node-stub', clipboard: { writeText: pending } },
    liff: noLiff ? undefined : liff,
    location: {
      href: 'http://localhost/board.html' + search, search,
      pathname: '/board.html', origin: 'http://localhost', hash: '',
      replace() {}, assign() {}, reload() {},
    },
    // 🪦 墓碑會 `history.replaceState` 把 `t` 剝掉。**替身要同時更新 `location`**
    //    ——真瀏覽器就是這樣，而 `liff.login({redirectUri:location.href})` 讀的正是它。
    //    替身若只記一筆而不改 `location`，「剝了沒有」與「剝在 login 之後」兩種
    //    失敗會長得一模一樣（都是 redirectUri 乾淨），那就等於沒測到順序。
    history: {
      replaceState(_s, _t, url) {
        ctx.__replacedUrl = String(url);
        const i = String(url).indexOf('?');
        ctx.location.search = i >= 0 ? String(url).slice(i) : '';
        ctx.location.href = 'http://localhost' + String(url);
      },
      pushState() {},
    },
    localStorage: storage, sessionStorage: storage,
    fetch: (u) => { urls.push(String(u)); return pending(); },
    XMLHttpRequest: function () { return { open() {}, send() {}, setRequestHeader() {}, addEventListener() {} }; },
    URL, URLSearchParams, TextEncoder, TextDecoder,
    Promise, Date, Math, JSON, Object, Array, String, Number, Boolean, RegExp, Error,
    setTimeout: (fn, ms) => { const id = setTimeout(fn, ms); timers.add(id); return id; },
    clearTimeout: (id) => { timers.delete(id); return clearTimeout(id); },
    setInterval: (fn, ms) => { const id = setInterval(fn, ms); timers.add(id); return id; },
    clearInterval: (id) => { timers.delete(id); return clearInterval(id); },
    requestAnimationFrame(fn) { return ctx.setTimeout(fn, 0); },
    alert() {}, confirm: () => false, prompt: () => null,
    addEventListener() {}, removeEventListener() {},
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    getComputedStyle: () => ({ display: 'block', getPropertyValue: () => '' }),
    Event: function (t) { return { type: t }; }, CustomEvent: function (t) { return { type: t }; },
    Blob: function () { return {}; },
    btoa: (s) => Buffer.from(String(s), 'binary').toString('base64'),
    atob: (s) => Buffer.from(String(s), 'base64').toString('binary'),
    crypto: { getRandomValues(a) { for (let i = 0; i < a.length; i++) a[i] = i % 256; return a; },
              subtle: { digest: pending, importKey: pending, encrypt: pending, decrypt: pending } },
    isSecureContext: true, performance: { now: () => 0, getEntriesByType: () => [] },
  };
  ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);

  const html = fs.readFileSync(path.join(ROOT, 'board.html'), 'utf8');
  const re = /<script([^>]*)>([\s\S]*?)<\/script>/g;
  let m;
  const onRej = () => {};
  process.on('unhandledRejection', onRej);
  try {
    while ((m = re.exec(html)) !== null) {
      const src = ((m[1] || '').match(/\bsrc="([^"]+)"/) || [])[1];
      if (src) {
        if (/^https?:|^\/\//.test(src)) continue;
        const p = path.join(ROOT, src);
        if (fs.existsSync(p)) vm.runInContext(fs.readFileSync(p, 'utf8'), ctx, { filename: src, timeout: 5000 });
      } else if (m[2].trim()) {
        vm.runInContext(m[2], ctx, { filename: 'board inline', timeout: 5000 });
      }
    }
  } finally { process.removeListener('unhandledRejection', onRej); }
  const cleanup = () => { for (const id of timers) { clearTimeout(id); clearInterval(id); } timers.clear(); };
  return { ctx, urls, liff, cleanup };
}

/** 讓所有已排定的微任務跑完（AUTH_READY 是好幾層 then）。 */
const settle = () => new Promise((r) => setImmediate(() => setImmediate(() => setImmediate(r))));

/* ══ 🪦 舊路的墓碑：網址帶 ?t= 也一樣要走 LINE 登入 ═══════════════════════
 *
 * 下面三條是舊 ① 那三條**逐條翻面**來的（見檔頭）。翻面的意思是：
 * 同一個輸入（`?t=STUBTOKEN`），斷言的內容從「不碰 LIFF／帶 token」
 * 變成「照樣碰 LIFF／一顆 token 都不帶」。
 * ════════════════════════════════════════════════════════════════════ */

test('🪦 帶 ?t= → **仍然**去 LINE 登入（舊路那一行加回來就會紅）', async () => {
  const { ctx, liff, cleanup } = runBoard({ search: '?t=STUBTOKEN' });
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
  const { ctx, urls, cleanup } = runBoard({ search: '?t=STUBTOKEN' });
  await settle();
  try {
    // 🔴 **照身分挑，不照位置**（2026-09-14）：`urls[length-1]` 只在「jsonp 同步發車」這個
    //    **沒寫出來的前提**下才對——本頁首載送的也是同一個 action，前提一破就靜靜量到首載那一發。
    const before = urls.length;
    // 🔴 **刻意仍然傳 `token`／`t` 進去**：這一條要證明的不是「呼叫端沒傳」，
    //    是「傳了也送不出去」——`jsonp` 自己會 `delete`。呼叫端不傳的話這條零鑑別力。
    ctx.jsonp('getHrPending', { token: 'STUBTOKEN', t: 'STUBTOKEN' });
    const u = onlyCall(urls, 'getHrPending', before);
    assert.equal(/[?&]token=/.test(u), false, '還是把 token 送出去了 ⇒ 後端會走舊守門');
    assert.equal(/[?&]t=/.test(u), false, '還是把 t 送出去了 ⇒ 後端會走舊守門');
    assert.match(u, /[?&]idToken=IDTOK/, '沒帶 idToken ⇒ 這一支會永遠驗不過');
  } finally { cleanup(); }
});

test('🪦 網址上的 `t` 被剝掉（而其餘參數原封不動）', async () => {
  const { ctx, cleanup } = runBoard({ search: '?a=1&t=STUBTOKEN&mt=MT9' });
  await settle();
  try {
    assert.equal(ctx.__replacedUrl, '/board.html?a=1&mt=MT9',
      '`t` 沒被剝掉、或順手弄壞了別的參數（`&&` 那一型）');
  } finally { cleanup(); }
});

test('🔴🪦 剝網址排在 liff.login 之前 ⇒ redirectUri 不含那串 token', async () => {
  const { liff, cleanup } = runBoard({ search: '?t=STUBTOKEN', loggedIn: false });
  await settle();
  try {
    assert.ok(liff.__loginArgs, '沒有呼叫 liff.login');
    assert.equal(/[?&]t=/.test(liff.__loginArgs.redirectUri), false,
      'redirectUri 還帶著那串 token ⇒ 它會被原封不動送進 LINE 的轉址鏈');
  } finally { cleanup(); }
});

test('🪦 `t` 在這一頁只有一個來源（剝掉註解之後再數）', () => {
  const html = fs.readFileSync(path.join(ROOT, 'board.html'), 'utf8');
  // 只取 inline script，再剝掉註解——⚠️ 用 `git grep -c` 會數到本檔與 board.html
  //    的註解自己提到的那幾次（那正是 line-messages 那一顆踩過的坑）。
  const code = (html.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g) || []).join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
  const hits = (code.match(/urlToken\s*\(/g) || []).length;
  assert.equal(hits, 1, '`urlToken(` 出現 ' + hits + ' 次；只准有一處，而它只餵墓碑');
  // ⬛ 對照組：同一把尺去數一個已知存在很多次的東西，必須回大於 1，
  //    否則上面那個 1 可能是「剝註解把整段程式碼吃掉了」。
  const ctrl = (code.match(/jsonp\s*\(/g) || []).length;
  assert.ok(ctrl > 1, '對照組回 ' + ctrl + ' ⇒ 這把尺把程式碼吃掉了，上面那個 1 不可採信');
});

/* ══ LINE 登入這條路（原本的 ②，前提沒變，逐字保留）═══════════════════ */

test('沒有 ?t= → 走 LIFF，FP 變成 LINE 的 sub', async () => {
  const { ctx, liff, cleanup } = runBoard({ search: '' });
  await settle();
  try {
    assert.equal(liff.__initCalled, 1, '沒去初始化 LIFF ⇒ 這條路根本沒跑');
    assert.equal(ctx.ID_TOKEN, 'IDTOK');
    assert.equal(ctx.FP, 'U_SUB_1', '指紋沒換成 sub');
  } finally { cleanup(); }
});

test('🔴 指紋不可以是空字串（同一台裝置上 A 的快取會被 B 解開）', async () => {
  const { ctx, cleanup } = runBoard({ search: '' });
  await settle();
  try {
    assert.notEqual(ctx.FP, '', '指紋是空字串 ⇒ 共用裝置上不同人的快取會混在一起');
  } finally { cleanup(); }
});

test('每一支呼叫都自動帶 idToken（憑證只掛在 jsonp 一處）', async () => {
  const { ctx, urls, cleanup } = runBoard({ search: '' });
  await settle();
  try {
    ctx.jsonp('getHrPending', {});
    ctx.jsonp('listOptions', {});
    assert.equal(urls.length >= 2, true, '呼叫沒送出去');
    urls.slice(-2).forEach((u) => {
      assert.match(u, /[?&]idToken=IDTOK/, '有一支沒帶 idToken ⇒ 那一支會永遠驗不過');
      assert.equal(/[?&]token=/.test(u), false, '不該再出現 token 參數（連空的都不該有）');
    });
  } finally { cleanup(); }
});

test('🔴 idToken 是「呼叫當下才取」，不是開頁時取一次存起來', async () => {
  const { ctx, urls, cleanup } = runBoard({ search: '' });
  await settle();
  try {
    // 模擬一小時後 LINE 換了新憑證（人事開著這一頁核准一整個上午是常態）
    ctx.liff.getIDToken = () => 'IDTOK_REFRESHED';
    // 🔴 **照身分挑，不照位置**（2026-09-14）：理由同上一組。
    const before = urls.length;
    ctx.jsonp('getHrPending', {});
    assert.match(onlyCall(urls, 'getHrPending', before), /idToken=IDTOK_REFRESHED/,
      '送出去的還是舊憑證 ⇒ 他會在按下核准時被說「請重新登入」，而他根本沒登出過');
  } finally { cleanup(); }
});

/* ══ 失敗路徑：每一種都要擋住首載，而且不可以帶空憑證送出去 ══════════════ */

test('🔴 還沒登入 → 去登入，且**首載不發車**（不可以帶空憑證打後端）', async () => {
  const { urls, liff, cleanup } = runBoard({ search: '', loggedIn: false });
  await settle();
  try {
    assert.ok(liff.__loginArgs, '沒有呼叫 liff.login');
    assert.equal(liff.__loginArgs.redirectUri, 'http://localhost/board.html',
      'redirectUri 不是本頁 ⇒ 登入後回不來');
    assert.equal(urls.length, 0, '導頁中還送出了 ' + urls.length + ' 個請求');
  } finally { cleanup(); }
});

test('🔴 登入了但拿不到憑證 → 擋住，首載不發車', async () => {
  const { urls, cleanup } = runBoard({ search: '', idToken: '' });
  await settle();
  try {
    assert.equal(urls.length, 0, '拿不到憑證卻照樣送了 ' + urls.length + ' 個請求');
  } finally { cleanup(); }
});

test('🔴 LIFF 元件整個沒載入 → 擋住，首載不發車（fail-closed）', async () => {
  const { urls, cleanup } = runBoard({ search: '', noLiff: true });
  await settle();
  try {
    assert.equal(urls.length, 0, 'LIFF 缺席卻照樣送了 ' + urls.length + ' 個請求');
  } finally { cleanup(); }
});

test('⬛ 對照組：一切正常時首載**確實會**發車（否則上面三條是「反正都不發」）', async () => {
  const { urls, cleanup } = runBoard({ search: '' });
  await settle();
  try {
    assert.equal(urls.length >= 1, true,
      '正常情況也沒發車 ⇒ 上面三條零鑑別力，它們證明的是「這支測試不會發車」');
    assert.match(urls[0], /action=batch/, '首載那一發不是 batch');
    assert.match(urls[0], /idToken=IDTOK/, '首載沒帶憑證');
  } finally { cleanup(); }
});

test('⬛ 對照組：帶 ?t= 進來也一樣會發車，而且帶的是 idToken 不是 token', async () => {
  const { urls, cleanup } = runBoard({ search: '?t=STUBTOKEN' });
  await settle();
  try {
    assert.equal(urls.length >= 1, true, '帶 ?t= 進來就發不了車 ⇒ 舊書籤的人整頁空白');
    assert.match(urls[0], /idToken=IDTOK/);
    assert.equal(/[?&]token=/.test(urls[0]), false);
  } finally { cleanup(); }
});

/* ══ 跨看板連結 ══════════════════════════════════════════════════════ */

// 🪦 2026-09-18 之前這裡是兩列：帶 `?t=` 的鑄造 `stats.html?t=…`。
//    **本頁不再持有 token，也不該再鑄造任何帶 token 的網址**（那等於把舊路又散播一條）
//    ⇒ 兩種入場方式都必須得到同一條不帶參數的網址。留兩列是刻意的：
//    這一條的鑑別力就在「帶 `?t=` 進來也一樣」。
for (const [路, search, want] of [['沒帶 ?t=', '', 'stats.html'], ['🪦 帶 ?t=', '?t=STUBTOKEN', 'stats.html']]) {
  test(`${路}顯示跨看板連結，連到 ${want}`, async () => {
    const { ctx, cleanup } = runBoard({ search });
    await settle();
    try {
      const got = [];
      ctx.document.body.appendChild = (el) => { got.push(el.href); };
      // 🔴 **這一行是這條測試的全部鑑別力所在。** 沒有它，`showAdminSwitch` 會在
      //    第一格 `document.getElementById('adm-switch')`（假 DOM 回的是**真值**）
      //    就 return ⇒ 這條測試量不到任何東西。
      //    2026-09-12 實測：沒有這一行時，拿掉當時的 `if(!TOKEN)return;` 那發突變**全綠**。
      ctx.document.getElementById = () => null;
      ctx.showAdminSwitch(true);
      assert.deepEqual(got, [want],
        '跨看板連結不是不帶參數的 stats.html（帶了 ?t= ＝ 又鑄造了一條舊路出去）');
    } finally { cleanup(); }
  });
}

/* ══ LIFF ID 必須與另外兩頁同一條 ══════════════════════════════════════ */

test('LIFF ID 與 index／welfare 同一條（tools.md：不多開 LIFF ID）', () => {
  const pick = (f, re) => (fs.readFileSync(path.join(ROOT, f), 'utf8').match(re) || [])[1];
  const b = pick('board.html', /^var LIFF_ID='([^']+)';/m);
  const w = pick('line.html', /^var LIFF_ID = '([^']+)';/m);
  const i = pick('index.html', /^\s*var LIFF_ID = '([^']+)';/m);
  assert.ok(b, 'board.html 找不到 LIFF_ID');
  assert.equal(b, w, 'board 與 welfare 的 LIFF ID 不同');
  assert.equal(b, i, 'board 與 index 的 LIFF ID 不同');
});
