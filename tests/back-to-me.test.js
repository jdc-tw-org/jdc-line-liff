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
 * 票上寫的對照組是「改完那幾頁 `git grep -c "me\.html"` 都 ≥1」。
 * ⬛ 實測（改完之後、功能已經接好時跑）：
 *      board 0／stats 0／hr-stats 0／attend 0／line 0／line-messages 1
 *    **與零點一個字都不差。**
 *
 * 不是改動沒生效，是**那條指令對「只有一份實作」這種做法零鑑別力**：
 * 入口寫在一支共用 asset 裡，各頁只多一行 `<script src="assets/back-to-me.js">`，
 * 而那一行裡沒有 `me.html` 這七個字。
 * ⇒ 票上同一張表裡的另一句「命中數不等於功能」，在這裡以**反方向**成立了一次：
 *   命中數是 0，功能卻是好的。
 *
 * ⇒ 這支測試就是那個對照組的替代品。它量四件互相獨立的事：
 *   ① **接線**——**後端分流表上的每一頁**真的載入那支 asset（而不在表上的頁沒有）
 *   ② **只有一份**——返回目標這個字串在會出貨的程式碼裡只出現一次
 *   ③ **真的是入口**——把那支 asset 跑起來，長出來的是一個 `<a href>`，不是註解或字串
 *   ④ **掛得到那一頁的內容欄**——`MOUNT_IN` 上的選擇器還選得到東西
 *
 * ② 與 ③ 必須同時成立才有意義：只有②會退化成「有一個字串」，
 * 只有③會退化成「至少有一頁對」。
 *
 * ⚠️ **定義域**：DOM 是假的、**沒有版面**。這裡驗的是「掛得上、掛出來的是什麼形狀、
 *    掛到誰底下」，**不是**「看不看得到、有沒有被別的東西蓋住」——
 *    那兩格只有真瀏覽器量得出來（`elementFromPoint`），本檔一個字都不宣稱。
 */

const ROOT = path.join(__dirname, '..');
const ASSET = 'assets/back-to-me.js';

/**
 * 🔴 **`admin.html` 是這條規則唯一的例外**（2026-09-18，`jdc-tw-org/jdc-line-gas#99`）。
 *
 * 規則本身是「**功能內頁**裡一份都沒有」——改文案或改目標時只有一個地方要動。
 * `admin.html` 2026-09-18 起**不再是功能內頁**：它整頁只剩一句「這個入口搬到
 * `me.html` 了」＋一條連結。**指向 `me.html` 就是它存在的全部理由**，
 * 抽掉那一行它就變成一張沒有出口的白紙。
 *
 * ⚠️ **為何不改成載入 `assets/back-to-me.js`**：本檔上面那條對照組要求
 *    「不在後端分流表上的頁不准掛返回入口」，而 `admin.html` 不在分流表上
 *    （它從來就不在）⇒ 掛了會換成那一條紅。兩條規則互斥，只能挑一個例外，
 *    而**具名的例外看得見、`filter` 掉一頁看不見**。
 *
 * 🔴 **解除條件**（可證偽，不是日期）：等舊書籤真的沒人在用了——也就是擁有者
 *    決定把 `admin.html` 整個刪掉的那一天——這一格連同那個檔一起消失。
 *    在那之前不要為了讓清單「乾淨」而把它拿掉：拿掉的唯一辦法是刪掉那條連結，
 *    而那會讓墓碑失去它唯一的功能。
 */
const 墓碑頁 = 'admin.html';
const 允許持有me連結的 = [墓碑頁, ASSET];

/**
 * 🔴 **哪幾頁該有返回入口——讀後端那張表，不在這裡抄一份。**
 *
 * 票 #104 的內文手寫了六頁，而**那份手寫清單漏了一頁**：`authz.html` 在票開出來之後
 * 才上線，它是分流表第 7 列。第一輪施工照著那六頁做完、全套測試全綠——
 * 站上會是 **7 頁裡 6 頁有返回入口，第 7 頁靜默沒有**。
 * 抓到它的不是本檔任何一條斷言，是驗證軌自己去讀了權威來源。
 * ⇒ **這一檔當時對「清單本身是錯的」結構上免疫**：清單是手抄的，抄漏了它照樣全綠。
 *
 * ⇒ 「內頁」的定義不在本檔、也不在票上，在後端 `roles.js` 的 DISPATCH 表。
 *   `tests/fixtures/action-roles.json` 的 `dispatchPages` 是它的機器匯出副本
 *   （`jdc-line-gas`：`node ci/roles-matrix/export-json.js --out <這裡>/tests/fixtures/action-roles.json`），
 *   由 gas 那側的 `copy-guard.js` ＋ `roles-matrix-guard.yml` 逐字釘住。
 *   **同一條契約、同一份副本，不另開一張會漂移的清單**——`me-dispatch-wiring.test.js`
 *   為了一模一樣的理由已經改過一次（它的檔頭記著手抄清單那次的實測數字）。
 *
 * ⚠️ **代價講明：日後分流表新增一頁，本檔會紅。** 修法就是給那一頁也加上
 *   `<script src="assets/back-to-me.js" defer>`。那是刻意的——本輪要防的，
 *   正是「新頁靜默地沒有返回入口」。
 */
const 讀分流頁 = (m) => ((m && m.dispatchPages) || []).map((r) => r && r.page);
const 矩陣 = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'action-roles.json'), 'utf8'));
const 分流頁 = 讀分流頁(矩陣);

const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const ALL_HTML = fs.readdirSync(ROOT).filter((f) => /\.html$/i.test(f)).sort();
const SRC = read(ASSET);

/* ════════════════════════════════════════════════════════════════════════
 * ① 接線：誰載入這支 asset
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * 只認**真的 script 標籤**，不認註解或說明文字裡提到的檔名。
 *
 * 🔴 **一定要先剝註解再比對。** 2026-09-17 實測的一顆存活突變：把載入行整行
 *    用 `<!-- -->` 包起來——**這一檔 19 條全綠，而真瀏覽器裡那排字不見了**
 *    （`document.querySelector('#backtome a')` 回 `null`）。
 *    成因是這個正規式在 HTML 註解**裡面**照樣命中：
 *    「註解也算原始碼」這一格，一個字串比對是分不出來的。
 * ⚠️ 註解掉一行、字串仍在 ⇒ 這正是「看起來還在、其實已經不執行」的那種壞法，
 *    而它在 diff 裡只有兩個符號的差別。
 */
const LOADS = /<script\b[^>]*\bsrc\s*=\s*["']assets\/back-to-me\.js["']/;
/** 讀一頁、**剝掉註解**之後的原始碼。接線那兩條一律走這支，不要直接用 `read`。 */
const 剝 = (f) => stripComments(read(f));

test('⬛ 零點：該有返回入口的那幾頁是從後端分流表讀來的，不是本檔手寫的', () => {
  assert.ok(Array.isArray(矩陣.dispatchPages),
    'action-roles.json 沒有 dispatchPages ⇒ 副本是舊版，在 jdc-line-gas 重產一次。\n'
    + '⚠️ 不要改成在這裡手寫一份補救——那正是本輪漏掉 authz.html 的成因。');
  assert.ok(分流頁.length >= 7,
    '分流表只讀到 ' + 分流頁.length + ' 頁 ⇒ 下面每一條都在一份太小的清單上跑'
    + '（2026-09-17 實測是 7 頁）');
  分流頁.forEach((p) => {
    assert.ok(typeof p === 'string' && /^[\w.-]+\.html$/.test(p),
      '分流表有一列的 page 不像檔名：' + JSON.stringify(p) + ' ⇒ 抽法或副本的形狀變了');
    assert.ok(fs.existsSync(path.join(ROOT, p)),
      '分流表列了 ' + p + '，但這個 repo 裡沒有這個檔 ⇒ 副本與站台對不起來，先查那個');
  });
  // 🔴 本輪的成因本身釘成一條。後端真的把它下架時這條要跟著改，不是自動放寬。
  assert.ok(分流頁.indexOf('authz.html') >= 0,
    'authz.html 不在分流表裡了 ⇒ 若後端確實下架了它，本條與 authz.html 的載入行一起改');
  // ⬛ 對照組：同一支抽法餵一根已知的針，命中必須 +1
  //    ——證明 `分流頁` 是真的從那份副本讀出來的，不是一個寫死的陣列。
  const 針 = 讀分流頁({ dispatchPages: (矩陣.dispatchPages || []).concat([{ page: '__針__.html' }]) });
  assert.equal(針.length, 分流頁.length + 1,
    '注入一列之後抽出來的頁數沒有變 ⇒ 抽法根本沒在讀那份副本');
  assert.ok(針.indexOf('__針__.html') >= 0, '抽法讀不到注入那一列的 page 欄');
  assert.deepStrictEqual(讀分流頁({}), [], '副本缺 dispatchPages 時抽法應回空陣列，好讓上面第一條說話');
});

test('⬛ 接線：分流表上的每一頁都載入 assets/back-to-me.js', () => {
  const missing = 分流頁.filter((f) => !LOADS.test(剝(f)));
  assert.deepStrictEqual(missing, [],
    '這幾頁在後端分流表上，卻沒有載入返回入口：' + missing.join(', ')
    + '\n⇒ 使用者從 me.html 點進去之後回不來（票 #104）');
});

test('⬛ 對照組：不在分流表上的頁就是沒有（證明上一條不是恆真）', () => {
  const has = ALL_HTML.filter((f) => 分流頁.indexOf(f) < 0 && LOADS.test(剝(f)));
  assert.deepStrictEqual(has, [],
    '這幾頁不在後端分流表上卻掛了返回入口，請確認是刻意的：' + has.join(', '));
  // ⬛ 這條尺自己的零點：認得出真的標籤、認不出被註解掉的標籤。
  assert.ok(LOADS.test(stripComments('<script src="assets/back-to-me.js" defer></script>')),
    '偵測樣式認不出真的標籤 ⇒ 上面兩條的綠燈都不值得解讀');
  assert.ok(!LOADS.test(stripComments('<!-- 見 assets/back-to-me.js -->')),
    '偵測樣式把說明文字當成載入了');
  // 🔴 這一格是 2026-09-17 那顆存活突變留下的尺：**整行被註解掉**。
  //    只比對字串的話這裡會是 true，而頁面上那排字已經不見了。
  assert.ok(!LOADS.test(stripComments('<!-- <script src="assets/back-to-me.js" defer></script> -->')),
    '🔴 被 `<!-- -->` 包起來的載入行仍然被算成「有載入」'
    + ' ⇒ 接線那兩條對「註解掉一行」是瞎的（實測：真瀏覽器裡返回入口消失，本檔全綠）');
  assert.ok(ALL_HTML.length >= 10, '母體掃出來只有 ' + ALL_HTML.length + ' 頁 ⇒ 掃描本身退化了');
});

/* ════════════════════════════════════════════════════════════════════════
 * ② 只有一份實作（票的完成定義）
 * ════════════════════════════════════════════════════════════════════════ */

test('🔴 完成定義：返回目標只寫在一個地方（每一個內頁裡一份都沒有）', () => {
  // 🔴 **先剝註解**。`assets/liff-relogin.js` 與 `line-messages.html` 的註解裡都提到
  //    `me.html`，那是說明不是實作。不剝的話這條會變成一盞永遠亮的紅燈，
  //    而永遠亮的紅燈等於沒有紅燈。
  const carriers = [];
  ALL_HTML.concat(fs.readdirSync(path.join(ROOT, 'assets'))
    .filter((f) => f.endsWith('.js')).map((f) => 'assets/' + f))
    .forEach((f) => {
      if (/\.min\.js$/.test(f)) return;           // 壓縮過的第三方庫不關本票的事
      if ((stripComments(read(f)).match(/\bme\.html\b/g) || []).length) carriers.push(f);
    });
  assert.deepStrictEqual(carriers, 允許持有me連結的,
    '返回目標 `me.html` 出現在這幾個檔的實作碼裡：' + carriers.join(', ')
    + '\n只准有一份（票 #104 完成定義）——要改文案或目標時只改 ' + ASSET
    + '\n（唯一的例外是 admin.html，它是墓碑頁；理由與解除條件見本檔上面那一格）');
});

test('⬛ 對照組：剝註解這一步真的有作用（否則上一條是假綠）', () => {
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
 * 那支是別條線在用的共用替身，這一輪不動它。
 *
 * 這個替身記四件事：建了什麼節點、掛了哪些事件、**任何一種送出**有沒有發生、
 * 以及**既有節點有沒有被動過**（新位置在頂端 ⇒ 「會不會弄壞既有的東西」才是真風險）。
 */
function makeEnv(opts) {
  const o = opts || {};
  const sent = [];
  const touched = [];
  const nodes = [];
  const removed = [];

  function el(tag) {
    const e = {
      tagName: String(tag).toUpperCase(),
      style: { cssText: '' },
      children: [], attrs: {}, listeners: {},
      id: '', className: '', textContent: '', href: '', referrerPolicy: '',
      appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
      insertBefore(c, ref) {
        const i = ref ? this.children.indexOf(ref) : -1;
        if (i < 0) this.children.push(c); else this.children.splice(i, 0, c);
        c.parentNode = this; return c;
      },
      removeChild(c) { removed.push(c); return c; },
      setAttribute(k, v) { this.attrs[k] = String(v); },
      getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; },
      addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); },
      removeEventListener() {},
      dispatchEvent(ev) { (this.listeners[ev.type] || []).forEach((fn) => fn(ev)); return true; },
      // 🔴 `src` 用 setter 記帳：JSONP＝注入一個 <script src>，那也是一種送出。
      set src(v) { this._src = String(v); if (this._src) sent.push('script-src:' + this._src); },
      get src() { return this._src || ''; },
      get firstChild() { return this.children.length ? this.children[0] : null; },
      parentNode: null,
    };
    nodes.push(e);
    return e;
  }

  const body = el('body');
  const head = el('head');
  // 既有節點：模擬「這一頁本來就有東西在頂端」。
  const existing = el('div'); existing.id = 'existing-top';
  body.appendChild(existing);
  // `MOUNT_IN` 要選到的容器（只有 line-messages 那條路會用到）。
  const host = o.host === undefined ? null : o.host;

  const doc = {
    body, head,
    readyState: 'interactive',
    getElementById: (id) => nodes.find((n) => n.id === id) || null,
    createElement: el,
    createTextNode: (t) => ({ nodeValue: t, __text: true }),
    querySelector: (sel) => { touched.push('querySelector:' + sel); return host; },
    documentElement: el('html'),
    addEventListener() {}, removeEventListener() {},
  };

  const spyStore = (name) => ({
    getItem() { touched.push(name + '.getItem'); return null; },
    setItem() { touched.push(name + '.setItem'); },
    removeItem() { touched.push(name + '.removeItem'); },
    clear() { touched.push(name + '.clear'); },
  });
  const history = {
    pushState() { touched.push('history.pushState'); },
    replaceState() { touched.push('history.replaceState'); },
    back() { touched.push('history.back'); }, go() { touched.push('history.go'); },
  };
  const liff = {
    login() { touched.push('liff.login'); }, logout() { touched.push('liff.logout'); },
    getIDToken() { touched.push('liff.getIDToken'); return 'IDTOK'; },
    sendMessages() { sent.push('liff.sendMessages'); return Promise.resolve(); },
    closeWindow() { touched.push('liff.closeWindow'); },
  };

  const page = o.page || 'board.html';
  const ctx = {
    console, document: doc, history, liff,
    localStorage: spyStore('localStorage'), sessionStorage: spyStore('sessionStorage'),
    location: {
      href: 'https://example.invalid/' + page + '?t=SECRET-TOKEN',
      search: '?t=SECRET-TOKEN', pathname: '/' + page, origin: 'https://example.invalid',
      assign() { touched.push('location.assign'); },
      replace() { touched.push('location.replace'); },
      reload() { touched.push('location.reload'); },
    },
    navigator: { userAgent: 'node-stub', sendBeacon(u) { sent.push('sendBeacon:' + u); return true; } },
    fetch(u) { sent.push('fetch:' + u); return new Promise(() => {}); },
    XMLHttpRequest: function () {
      return { open() {}, setRequestHeader() {}, addEventListener() {}, send(b) { sent.push('xhr:' + b); } };
    },
    Promise, Object, Array, String, Number, Boolean, JSON, Date, Math, Error, RegExp,
    setTimeout, clearTimeout, setInterval, clearInterval,
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  return { ctx, doc, body, head, existing, sent, touched, removed, nodes };
}

function runAsset(env) { vm.runInContext(SRC, env.ctx, { filename: ASSET }); }

/** 掛上去的那個返回入口與它的容器。 */
function mounted(env, hostNode) {
  const h = hostNode || env.body;
  const bar = h.children.find((c) => c.id === 'backtome');
  assert.ok(bar, '跑完 ' + ASSET + ' 之後容器上沒有 #backtome ⇒ 根本沒掛上');
  const a = bar.children.find((c) => c.tagName === 'A');
  assert.ok(a, '#backtome 裡沒有 <a> ⇒ 掛出來的不是連結');
  return { bar, a };
}

test('🔴 跑起來長出的是一個真的連結，不是註解也不是字串', () => {
  const env = makeEnv();
  runAsset(env);
  const { a } = mounted(env);
  assert.equal(a.tagName, 'A', '不是 <a> ⇒ 不是導覽入口');
  assert.equal(a.href, 'me.html', 'href 不是 me.html');
  assert.ok(a.textContent.trim().length > 0,
    '連結沒有文字 ⇒ 沒有 accessible name，鍵盤與讀屏使用者拿不到它是什麼');
  assert.ok(/回/.test(a.textContent), '連結文字看不出是「回去」：' + JSON.stringify(a.textContent));
});

test('🔴 位置：掛在容器的**最前面**（左上角＝內容欄的第一個東西）', () => {
  const env = makeEnv();
  runAsset(env);
  assert.equal(env.body.children[0].id, 'backtome',
    '#backtome 不是第一個子節點 ⇒ 它不在頂端了（擁有者 2026-09-17：「那顆鈕放左上角」）');
  assert.equal(env.body.children[1].id, 'existing-top', '既有的第一個節點被擠掉了');
});

test('🔴 網址不得帶查詢字串——`?t=` 不可以被帶進網址列', () => {
  const env = makeEnv();
  assert.ok(env.ctx.location.search.indexOf('t=') >= 0, '對照組沒設好：環境裡根本沒有 ?t=');
  runAsset(env);
  const { a } = mounted(env);
  assert.ok(a.href.indexOf('?') < 0, 'href 帶了查詢字串：' + a.href);
  assert.ok(a.href.indexOf('SECRET-TOKEN') < 0, '🔴 憑證被帶進連結了：' + a.href);
  assert.equal(a.referrerPolicy, 'no-referrer',
    'referrerPolicy 不是 no-referrer ⇒ 完整網址（含 ?t=）會隨 Referer 標頭送出去');
});

test('🔴 掛載與點擊都不碰身分：沒動 storage、沒動 liff、沒動 history', () => {
  const env = makeEnv();
  runAsset(env);
  const { a } = mounted(env);
  a.dispatchEvent({ type: 'click', preventDefault() { throw new Error('不該有人攔這個點擊'); } });
  const bad = env.touched.filter((t) => t.indexOf('querySelector') !== 0);
  assert.deepStrictEqual(bad, [],
    '返回入口碰了這些東西：' + bad.join(', ')
    + '\n碰了就有機會讓回到 me.html 之後的角色與原本不同（票 #104 的 🔴 行為那一格）');
});

test('🔴 不動既有節點：沒有移除、沒有改寫頁面原本就有的東西', () => {
  const env = makeEnv();
  const before = { id: env.existing.id, html: env.existing.innerHTML, kids: env.existing.children.length };
  runAsset(env);
  assert.deepStrictEqual(env.removed, [], '移除了既有節點：' + env.removed.length + ' 個');
  assert.equal(env.existing.id, before.id);
  assert.equal(env.existing.children.length, before.kids, '往既有節點裡塞了東西');
  // 🔴 這是新位置帶進來的風險：頂端本來就有東西（商標、標題列、身分閘）。
  //    ⚠️ 「有沒有被**遮住**」這一格假 DOM 答不了（沒有版面）——那條在 e2e。
});

test('⬛ 副作用：沒有動 history ⇒ 瀏覽器返回鍵維持原行為', () => {
  const env = makeEnv();
  runAsset(env);
  const bare = stripComments(SRC);
  ['pushState', 'replaceState', 'popstate', 'location.replace', 'location.assign']
    .forEach((s) => assert.ok(bare.indexOf(s) < 0,
      ASSET + ' 的實作碼出現 ' + s + ' ⇒ 它開始動歷史紀錄了，返回鍵行為會變'));
  assert.deepStrictEqual(env.touched.filter((t) => t.indexOf('history') === 0), []);
});

test('⬛ 重複掛載只會有一份（不會在頂端疊出兩排）', () => {
  const env = makeEnv();
  runAsset(env);
  runAsset(env);
  assert.equal(env.body.children.filter((c) => c.id === 'backtome').length, 1, '掛了不只一份');
  assert.equal(env.head.children.filter((c) => c.id === 'backtome-css').length, 1, '樣式塞了不只一塊');
});

/* ════════════════════════════════════════════════════════════════════════
 * ④ 「淡」不可以把可用性一起淡掉
 * ════════════════════════════════════════════════════════════════════════ */

test('🔴 淡的是視覺不是語意：鍵盤聚焦時有看得見的框，而且不是靠 outline:none', () => {
  const env = makeEnv();
  runAsset(env);
  const st = env.head.children.find((c) => c.id === 'backtome-css');
  assert.ok(st, '沒有注入樣式 ⇒ 七頁裡五頁不載 ui.css，那排字會變成瀏覽器預設的藍色連結');
  const css = st.children.map((c) => c.nodeValue || '').join('');
  assert.ok(/#backtome a:focus-visible\{[^}]*outline:[^}]*\}/.test(css),
    '沒有 :focus-visible 的 outline ⇒ 鍵盤使用者走到這排字時畫面上沒有任何提示');
  assert.ok(!/outline: *none/.test(css), '把 outline 關掉了');
  assert.ok(/#backtome a:hover/.test(css), '沒有 hover 回饋');
});

test('🔴 每一個 CSS 變數都要有 fallback（七頁裡只有兩頁載入 ui.css）', () => {
  const env = makeEnv();
  runAsset(env);
  const css = env.head.children.find((c) => c.id === 'backtome-css')
    .children.map((c) => c.nodeValue || '').join('');
  const vars = css.match(/var\(--[\w-]+[^)]*\)/g) || [];
  assert.ok(vars.length >= 4, '只找到 ' + vars.length + ' 個 CSS 變數 ⇒ 抽法壞了');
  const naked = vars.filter((v) => v.indexOf(',') < 0);
  assert.deepStrictEqual(naked, [],
    '這些變數沒有 fallback：' + naked.join(', ')
    + '\n沒載 ui.css 的那五頁會靜靜拿到預設值，而且不會報錯');
});

/* ════════════════════════════════════════════════════════════════════════
 * ⑤ MOUNT_IN：頂端結構特殊的頁，選擇器還選得到東西
 * ════════════════════════════════════════════════════════════════════════ */

/** 從實作碼裡把 `MOUNT_IN` 那張表讀出來——測試不自己抄一份會漂移的副本。 */
function mountTable() {
  const m = /var MOUNT_IN = \{([\s\S]*?)\};/.exec(stripComments(SRC));
  assert.ok(m, '讀不到 MOUNT_IN ⇒ 抽法壞了（不是「表是空的」）');
  const out = {};
  (m[1].match(/'([^']+)'\s*:\s*'([^']+)'/g) || []).forEach((row) => {
    const p = /'([^']+)'\s*:\s*'([^']+)'/.exec(row);
    out[p[1]] = p[2];
  });
  return out;
}

test('🔴 MOUNT_IN 上的選擇器在那一頁的原始碼裡還找得到（選不到會靜靜退回 body）', () => {
  const table = mountTable();
  assert.ok(Object.keys(table).length >= 1, 'MOUNT_IN 抽出來是空的 ⇒ 下面什麼都沒驗到');
  Object.keys(table).forEach((page) => {
    assert.ok(分流頁.indexOf(page) >= 0,
      'MOUNT_IN 列了一頁不在後端分流表上：' + page + ' ⇒ 那一頁根本不該掛返回入口');
    const html = read(page);
    // 選擇器是後代式（`.a .b`）時，逐段都要在原始碼裡出現。
    table[page].trim().split(/\s+/).forEach((part) => {
      const cls = part.replace(/^\./, '');
      assert.ok(new RegExp('class\\s*=\\s*"[^"]*\\b' + cls + '\\b').test(html),
        page + ' 裡找不到 class="' + cls + '"（MOUNT_IN 寫的是 ' + table[page] + '）'
        + '\n⇒ 選不到就會靜靜退回 document.body，那排字的位置會跑掉而且零錯誤訊息');
    });
  });
});

test('⬛ 對照組：選得到容器時真的掛進容器，選不到時才退回 body', () => {
  const table = mountTable();
  const page = Object.keys(table)[0];
  // 選得到
  const hostEnv = makeEnv({ page: page, host: null });
  const fakeHost = hostEnv.doc.createElement('div');
  fakeHost.className = 'stickytop';
  hostEnv.doc.querySelector = () => fakeHost;
  runAsset(hostEnv);
  assert.equal(fakeHost.children[0] && fakeHost.children[0].id, 'backtome',
    '選得到容器卻沒掛進去（頁：' + page + '）');
  assert.ok(!hostEnv.body.children.some((c) => c.id === 'backtome'), '同時也掛到 body 上了');

  // 選不到 ⇒ 退回 body，而且補上自己的內距
  const fallback = makeEnv({ page: page, host: null });
  runAsset(fallback);
  const bar = fallback.body.children.find((c) => c.id === 'backtome');
  assert.ok(bar, '選不到容器時沒有退回 body ⇒ 那一頁會完全沒有返回入口');
  assert.equal(bar.className, 'pad', '退回 body 時沒有補內距 ⇒ 會貼著畫面邊緣');
});

/* ════════════════════════════════════════════════════════════════════════
 * 🔴 ⑥ `line.html` 返回不得送出任何東西
 *
 * 票上原句：「不會送出草稿、驗證碼或訊息」，而且明講**要拿得出證據，
 * 不是「我沒按送出」**。下面三條各自獨立，任一條紅都代表這個保證破了。
 * ════════════════════════════════════════════════════════════════════════ */

test('🔴 (a) 分流表上的頁都沒有 <form> ⇒ 返回在結構上不可能是一次提交', () => {
  const withForm = 分流頁.filter((f) => /<form\b/i.test(stripComments(read(f))));
  assert.deepStrictEqual(withForm, [], '這幾頁有 <form>：' + withForm.join(', '));
  assert.ok(/<form\b/i.test('<form action="/x">'), '偵測樣式壞了');
});

test('🔴 (b) line.html 沒有離頁觸發的送出（unload 家族／sendBeacon）', () => {
  const bare = stripComments(read('line.html'));
  const found = ['beforeunload', 'pagehide', 'sendBeacon', "'unload'", '"unload"']
    .filter((s) => bare.indexOf(s) >= 0);
  assert.deepStrictEqual(found, [],
    'line.html 出現了離頁觸發點：' + found.join(', ')
    + '\n⇒「按返回不會送出東西」這個保證要重新驗');
  assert.ok(stripComments("x.addEventListener('beforeunload', f)").indexOf('beforeunload') >= 0,
    '偵測樣式認不出真的 beforeunload');
  assert.ok(stripComments('/* beforeunload 是刻意沒有的 */').indexOf('beforeunload') < 0,
    '偵測樣式把註解也算進去了 ⇒ 這會變成一盞永遠亮的紅燈');
});

test('🔴 (c) 掛上返回入口並點下去：傳輸計數器全 0，且同一條測試證明計數器會數', () => {
  const env = makeEnv({ page: 'line.html' });
  runAsset(env);
  const { a } = mounted(env);
  a.dispatchEvent({ type: 'click', preventDefault() {} });

  assert.deepStrictEqual(env.sent, [], '🔴 返回入口送出了東西：' + env.sent.join(', '));
  assert.deepStrictEqual(Object.keys(a.listeners), [],
    '返回入口掛了事件處理：' + Object.keys(a.listeners).join(', ')
    + '\n⇒「<a href> 送不出東西」這個結構論證不再成立，要改用行為證據');

  // ⬛ **對照組**：同一組計數器、同一個環境，跑五種送出各一次。
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
