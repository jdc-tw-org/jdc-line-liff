const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripComments } = require('./helpers/source-scan');

/**
 * `assets/back-to-me.js`——功能內頁回分流頁的入口（票 #104）。
 *
 * ══ 🔴 這支測試存在的第一個理由：票上那條量法量不到這次的改動 ═══════════
 *
 * 票上寫的對照組是「改完六頁 `git grep -c "me\.html"` 都 ≥1」。
 * ⬛ 實測（改完之後、功能已經接好時跑）：
 *      board 0／stats 0／hr-stats 0／attend 0／line 0／line-messages 1
 *    **與零點一個字都不差。**
 *
 * 不是改動沒生效，是**那條指令對「只有一份實作」這種做法零鑑別力**：
 * 入口寫在一支共用 asset 裡，六頁各只多一行 `<script src="assets/back-to-me.js">`，
 * 而那一行裡沒有 `me.html` 這七個字。
 * ⇒ 票上同一張表裡的另一句「命中數不等於功能」，在這裡以**反方向**成立了一次：
 *   命中數是 0，功能卻是好的。
 *
 * ⇒ 這支測試就是那個對照組的替代品。它量三件互相獨立的事：
 *   ① **接線**——六頁真的載入那支 asset（而不該載的頁沒有）
 *   ② **只有一份**——返回目標這個字串在會出貨的程式碼裡只出現一次
 *   ③ **真的是入口**——把那支 asset 跑起來，長出來的是一個 `<a href>`，不是註解或字串
 *
 * ② 與 ③ 必須同時成立才有意義：只有②會退化成「有一個字串」，
 * 只有③會退化成「至少有一頁對」。
 *
 * ⚠️ **定義域**：DOM 是假的、沒有瀏覽器。這裡驗的是「掛得上、掛出來的是什麼形狀」，
 *    **不是**「桌面寬度下看得到」——那一格只有真的開頁面才算數。
 */

const ROOT = path.join(__dirname, '..');
const ASSET = 'assets/back-to-me.js';

/** 票 #104 指名的六頁。 */
const SIX = ['board.html', 'stats.html', 'hr-stats.html', 'attend.html',
  'line-messages.html', 'line.html'];

const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const ALL_HTML = fs.readdirSync(ROOT).filter((f) => /\.html$/i.test(f)).sort();

/* ════════════════════════════════════════════════════════════════════════
 * ① 接線：誰載入這支 asset
 * ════════════════════════════════════════════════════════════════════════ */

/** 只認**真的 script 標籤**，不認註解或說明文字裡提到的檔名。 */
const LOADS = /<script\b[^>]*\bsrc\s*=\s*["']assets\/back-to-me\.js["']/;

test('⬛ 接線：票上那六頁每一頁都載入 assets/back-to-me.js', () => {
  const missing = SIX.filter((f) => !LOADS.test(read(f)));
  assert.deepStrictEqual(missing, [], '這幾頁沒有載入返回入口：' + missing.join(', '));
});

test('⬛ 對照組：不該有的頁就是沒有（證明上一條不是恆真）', () => {
  // `me.html` 自己是目的地；其餘是不在分流清單上的頁。
  const has = ALL_HTML.filter((f) => !SIX.includes(f) && LOADS.test(read(f)));
  assert.deepStrictEqual(has, [],
    '這幾頁不在票 #104 的範圍內卻掛了返回入口，請確認是刻意的：' + has.join(', '));
  // 🔴 零點：如果偵測樣式壞了，上面那條會因為「誰都偵測不到」而假綠。
  //    這裡反過來釘住「它真的分得出有跟沒有」。
  assert.ok(LOADS.test('<script src="assets/back-to-me.js" defer></script>'), '偵測樣式認不出真的標籤');
  assert.ok(!LOADS.test('<!-- 見 assets/back-to-me.js -->'), '偵測樣式把註解當成載入了');
  assert.ok(ALL_HTML.length >= 10, '母體掃出來只有 ' + ALL_HTML.length + ' 頁 ⇒ 掃描本身退化了');
});

/* ════════════════════════════════════════════════════════════════════════
 * ② 只有一份實作（票的完成定義）
 * ════════════════════════════════════════════════════════════════════════ */

test('🔴 完成定義：返回目標只寫在一個地方（六頁裡一份都沒有）', () => {
  // 🔴 **先剝註解**。`assets/liff-relogin.js` 與 `line-messages.html` 的註解裡都提到
  //    `me.html`，那是說明不是實作。不剝的話這條會變成一盞永遠亮的紅燈，
  //    而永遠亮的紅燈等於沒有紅燈。
  const carriers = [];
  ALL_HTML.concat(fs.readdirSync(path.join(ROOT, 'assets'))
    .filter((f) => f.endsWith('.js')).map((f) => 'assets/' + f))
    .forEach((f) => {
      // 壓縮過的第三方函式庫剝不乾淨也不關本票的事，跳過。
      if (/\.min\.js$/.test(f)) return;
      if ((stripComments(read(f)).match(/\bme\.html\b/g) || []).length) carriers.push(f);
    });
  assert.deepStrictEqual(carriers, [ASSET],
    '返回目標 `me.html` 出現在這幾個檔的實作碼裡：' + carriers.join(', ')
    + '\n只准有一份（票 #104 完成定義）——要改文案或目標時只改 ' + ASSET);
});

test('⬛ 對照組：剝註解這一步真的有作用（否則上一條是假綠）', () => {
  // 拿已知會命中的兩個檔當對照：它們的原文有 me.html、剝完註解之後沒有。
  ['assets/liff-relogin.js', 'line-messages.html'].forEach((f) => {
    const raw = (read(f).match(/\bme\.html\b/g) || []).length;
    const bare = (stripComments(read(f)).match(/\bme\.html\b/g) || []).length;
    assert.ok(raw > 0, f + ' 的原文本來就沒有 me.html ⇒ 這個對照組選錯檔了');
    assert.equal(bare, 0, f + ' 剝完註解還有 me.html ⇒ 它是實作不是註解，要重新判斷');
  });
});

/* ════════════════════════════════════════════════════════════════════════
 * ③ 真的是導覽入口：把 asset 跑起來看長出什麼
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * 一個記帳用的假 DOM。**刻意不共用 `tests/helpers/page-stub.js`**——
 * 那支是別條線在用的共用替身，這一輪不動它（改它等於把本票的驗收摻進別頁的驗收）。
 *
 * 這個替身記三件事：建了什麼節點、掛了哪些事件、以及**任何一種送出**有沒有發生。
 */
function makeEnv() {
  const sent = [];                      // 🔴 所有「把東西送出去」的動作都記在這裡
  const nodes = [];

  function el(tag) {
    const e = {
      tagName: String(tag).toUpperCase(),
      style: { cssText: '' },
      children: [], attrs: {}, listeners: {},
      id: '', textContent: '', href: '', referrerPolicy: '',
      appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
      setAttribute(k, v) { this.attrs[k] = String(v); },
      getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; },
      addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); },
      removeEventListener() {},
      dispatchEvent(ev) { (this.listeners[ev.type] || []).forEach((fn) => fn(ev)); return true; },
      // 🔴 `src` 用 setter 記帳：JSONP＝注入一個 <script src>，那也是一種送出。
      set src(v) { this._src = String(v); if (this._src) sent.push('script-src:' + this._src); },
      get src() { return this._src || ''; },
      parentNode: null,
    };
    nodes.push(e);
    return e;
  }

  const body = el('body');
  const doc = {
    body,
    readyState: 'interactive',
    getElementById: (id) => nodes.find((n) => n.id === id) || null,
    createElement: el,
    createTextNode: (t) => ({ nodeValue: t }),
    addEventListener() {}, removeEventListener() {},
  };

  /** 🔴 被監看的儲存／身分／歷史。**碰一下就留痕跡。** */
  const touched = [];
  const spyStore = (name) => ({
    getItem() { touched.push(name + '.getItem'); return null; },
    setItem() { touched.push(name + '.setItem'); },
    removeItem() { touched.push(name + '.removeItem'); },
    clear() { touched.push(name + '.clear'); },
  });
  const history = {
    pushState() { touched.push('history.pushState'); },
    replaceState() { touched.push('history.replaceState'); },
    back() { touched.push('history.back'); },
    go() { touched.push('history.go'); },
  };
  const liff = {
    login() { touched.push('liff.login'); },
    logout() { touched.push('liff.logout'); },
    getIDToken() { touched.push('liff.getIDToken'); return 'IDTOK'; },
    sendMessages() { sent.push('liff.sendMessages'); return Promise.resolve(); },
    closeWindow() { touched.push('liff.closeWindow'); },
  };

  const ctx = {
    console, document: doc, history, liff,
    localStorage: spyStore('localStorage'), sessionStorage: spyStore('sessionStorage'),
    location: {
      href: 'https://example.invalid/board.html?t=SECRET-TOKEN',
      search: '?t=SECRET-TOKEN', pathname: '/board.html', origin: 'https://example.invalid',
      assign() { touched.push('location.assign'); },
      replace() { touched.push('location.replace'); },
      reload() { touched.push('location.reload'); },
    },
    navigator: {
      userAgent: 'node-stub',
      sendBeacon(u) { sent.push('sendBeacon:' + u); return true; },
    },
    fetch(u) { sent.push('fetch:' + u); return new Promise(() => {}); },
    XMLHttpRequest: function () {
      return { open() {}, setRequestHeader() {}, addEventListener() {}, send(b) { sent.push('xhr:' + b); } };
    },
    Promise, Object, Array, String, Number, Boolean, JSON, Date, Math, Error, RegExp,
    setTimeout, clearTimeout, setInterval, clearInterval,
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  return { ctx, doc, body, sent, touched, nodes };
}

function runAsset(env) {
  vm.runInContext(read(ASSET), env.ctx, { filename: ASSET });
}

/** 掛上去的那個返回入口。 */
function mounted(env) {
  const bar = env.body.children.find((c) => c.id === 'backtome');
  assert.ok(bar, '跑完 ' + ASSET + ' 之後 body 上沒有 #backtome ⇒ 根本沒掛上');
  const a = bar.children.find((c) => c.tagName === 'A');
  assert.ok(a, '#backtome 裡沒有 <a> ⇒ 掛出來的不是連結');
  return a;
}

test('🔴 跑起來長出的是一個真的連結，不是註解也不是字串', () => {
  const env = makeEnv();
  runAsset(env);
  const a = mounted(env);
  assert.equal(a.tagName, 'A', '不是 <a> ⇒ 不是導覽入口');
  assert.equal(a.href, 'me.html', 'href 不是 me.html');
  assert.ok(a.textContent.trim().length > 0,
    '連結沒有文字 ⇒ 沒有 accessible name，鍵盤與讀屏使用者拿不到它是什麼');
  assert.ok(/回/.test(a.textContent), '連結文字看不出是「回去」：' + JSON.stringify(a.textContent));
});

test('🔴 網址不得帶查詢字串——`?t=` 不可以被帶進網址列', () => {
  const env = makeEnv();
  // 環境裡的 location 明寫著 ?t=SECRET-TOKEN，這一條才問得出「它有沒有順手接上去」。
  assert.ok(env.ctx.location.search.indexOf('t=') >= 0, '對照組沒設好：環境裡根本沒有 ?t=');
  runAsset(env);
  const a = mounted(env);
  assert.ok(a.href.indexOf('?') < 0, 'href 帶了查詢字串：' + a.href);
  assert.ok(a.href.indexOf('SECRET-TOKEN') < 0, '🔴 憑證被帶進連結了：' + a.href);
  assert.equal(a.referrerPolicy, 'no-referrer',
    'referrerPolicy 不是 no-referrer ⇒ 完整網址（含 ?t=）會隨 Referer 標頭送出去');
});

test('🔴 掛載與點擊都不碰身分：沒動 storage、沒動 liff、沒動 history', () => {
  const env = makeEnv();
  runAsset(env);
  const a = mounted(env);
  a.dispatchEvent({ type: 'click', preventDefault() { throw new Error('不該有人攔這個點擊'); } });
  assert.deepStrictEqual(env.touched, [],
    '返回入口碰了這些東西：' + env.touched.join(', ')
    + '\n碰了就有機會讓回到 me.html 之後的角色與原本不同（票 #104 的 🔴 行為那一格）');
});

test('⬛ 副作用：沒有動 history ⇒ 瀏覽器返回鍵維持原行為', () => {
  const env = makeEnv();
  runAsset(env);
  const bare = stripComments(read(ASSET));
  ['pushState', 'replaceState', 'popstate', 'location.replace', 'location.assign']
    .forEach((s) => assert.ok(bare.indexOf(s) < 0,
      ASSET + ' 的實作碼出現 ' + s + ' ⇒ 它開始動歷史紀錄了，返回鍵行為會變'));
  assert.deepStrictEqual(env.touched.filter((t) => t.indexOf('history') === 0), []);
});

test('⬛ 重複掛載只會有一份（不會在頁尾疊出兩顆）', () => {
  const env = makeEnv();
  runAsset(env);
  runAsset(env);
  const bars = env.body.children.filter((c) => c.id === 'backtome');
  assert.equal(bars.length, 1, '掛了 ' + bars.length + ' 份');
});

/* ════════════════════════════════════════════════════════════════════════
 * 🔴 ④ `line.html` 返回不得送出任何東西
 *
 * 票上原句：「不會送出草稿、驗證碼或訊息」，而且明講**要拿得出證據，
 * 不是「我沒按送出」**。下面三條各自獨立，任一條紅都代表這個保證破了：
 *
 *   (a) 結構：那一頁沒有 `<form>`，所以「返回」在結構上不是一次提交
 *   (b) 結構：那一頁沒有任何離頁觸發的送出（unload 家族／sendBeacon）
 *   (c) 執行：把返回入口掛起來、點下去，所有傳輸原語的計數器是 0
 *       ——**而且同一段輸出裡附一條對照組，證明那些計數器真的會數**
 * ════════════════════════════════════════════════════════════════════════ */

test('🔴 (a) 六頁都沒有 <form> ⇒ 返回在結構上不可能是一次提交', () => {
  const withForm = SIX.filter((f) => /<form\b/i.test(stripComments(read(f))));
  assert.deepStrictEqual(withForm, [],
    '這幾頁有 <form>：' + withForm.join(', ')
    + '\n有 form 的話，返回入口的位置與型別就要重新判斷（<a> 仍不提交，但旁邊的東西會）');
  // ⬛ 對照組：這個偵測樣式真的認得出 form。
  assert.ok(/<form\b/i.test('<form action="/x">'), '偵測樣式壞了');
});

test('🔴 (b) line.html 沒有離頁觸發的送出（unload 家族／sendBeacon）', () => {
  const bare = stripComments(read('line.html'));
  const found = ['beforeunload', 'pagehide', 'sendBeacon', "'unload'", '"unload"']
    .filter((s) => bare.indexOf(s) >= 0);
  assert.deepStrictEqual(found, [],
    'line.html 出現了離頁觸發點：' + found.join(', ')
    + '\n⇒「按返回不會送出東西」這個保證要重新驗，不能再靠「它沒有這種處理」');
  // ⬛ 對照組：樣式本身有鑑別力（否則上面那條是「什麼都找不到」的假綠）。
  assert.ok(stripComments("x.addEventListener('beforeunload', f)").indexOf('beforeunload') >= 0,
    '偵測樣式認不出真的 beforeunload');
  assert.ok(stripComments('/* beforeunload 是刻意沒有的 */').indexOf('beforeunload') < 0,
    '偵測樣式把註解也算進去了 ⇒ 這會變成一盞永遠亮的紅燈');
});

test('🔴 (c) 掛上返回入口並點下去：傳輸計數器全 0，且同一條測試證明計數器會數', () => {
  const env = makeEnv();
  runAsset(env);
  const a = mounted(env);
  a.dispatchEvent({ type: 'click', preventDefault() {} });

  // 受測：什麼都沒送出去。
  assert.deepStrictEqual(env.sent, [],
    '🔴 返回入口送出了東西：' + env.sent.join(', '));
  // 順帶釘住「它根本沒有註冊任何點擊處理」——沒有處理就沒有東西可以送。
  assert.deepStrictEqual(Object.keys(a.listeners), [],
    '返回入口掛了事件處理：' + Object.keys(a.listeners).join(', ')
    + '\n⇒「<a href> 送不出東西」這個結構論證不再成立，要改用行為證據');

  // ⬛ **對照組**：同一組計數器、同一個環境，跑四種送出各一次。
  //    這一段若沒有讓 sent 長出四筆，上面那個 `[]` 就什麼都沒證明。
  vm.runInContext(
    'fetch("https://example.invalid/exec");'
    + 'navigator.sendBeacon("https://example.invalid/b");'
    + 'new XMLHttpRequest().send("payload");'
    + 'liff.sendMessages([]);'
    + 'document.createElement("script").src = "https://example.invalid/jsonp";',
    env.ctx);
  assert.equal(env.sent.length, 5,
    '對照組只數到 ' + env.sent.length + ' 筆（應為 5）⇒ 計數器本身壞了，'
    + '上面那個「全 0」是量測失效，不是沒送出');
});
