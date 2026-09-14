/**
 * **分流頁 `me.html` 的接線**（E1b 第 1 項，2026-09-12）。
 *
 * 🔴 **`page-load.test.js` 只證明「載得起來」**——它跑完整頁 script 而不看畫面，
 *    所以「清單畫錯、未遷移的頁做成了可點的連結」它一條都不會紅。
 *    而那正是這一頁唯一會害到人的錯：**點下去必定被擋，而他什麼都沒做錯。**
 *
 * ⚠️ 手法沿用 `board-e1a-wiring.test.js`：把頁面的 script 丟進 stub 環境跑，
 *    測的是 `me.html` 裡真正那幾行字。DOM 與網路是假的。
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');

/** 一顆記得住 innerHTML／textContent 的假元素（畫面內容就是本檔的受測物）。 */
function fakeEl(id) {
  return {
    id: id || '', style: {}, dataset: {}, children: [], className: '',
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    innerHTML: '', textContent: '', value: '', hidden: false, href: '',
    appendChild() {}, removeChild() {}, insertAdjacentHTML() {}, setAttribute() {},
    removeAttribute() {}, addEventListener(t, f) { (this.__on = this.__on || {})[t] = f; },
    removeEventListener() {}, querySelector: () => null, querySelectorAll: () => [],
    focus() {}, click() { if (this.__on && this.__on.click) this.__on.click(); }, remove() {},
  };
}

/**
 * 跑 me.html。
 * @param {object} o  `reply`＝後端要回的 JSON；`transportFail`＝連線層直接壞掉
 */
function runMe(o) {
  const opt = o || {};
  const 送出 = [];
  const timers = new Set();
  const els = {};
  const get = (id) => (els[id] || (els[id] = fakeEl(id)));
  const pending = () => new Promise(() => {});
  const doc = {
    getElementById: get, querySelector: () => null, querySelectorAll: () => [],
    createElement: (t) => fakeEl(t), body: fakeEl('body'), documentElement: fakeEl('html'),
    head: fakeEl('head'), addEventListener() {}, readyState: 'complete',
  };
  const liff = {
    __initCalled: 0, __loginArgs: null, __logoutCalled: 0,
    init(a) { liff.__initCalled++; return Promise.resolve(a); },
    isLoggedIn: () => opt.loggedIn !== false,
    getIDToken: () => (opt.idToken === undefined ? 'IDTOK' : opt.idToken),
    getDecodedIDToken: () => ({ sub: 'U_SUB_1' }),
    logout() { liff.__logoutCalled++; },
    login(a) { liff.__loginArgs = a; },
    getProfile: pending, closeWindow() {}, openWindow() {}, isInClient: () => true,
  };
  const ctx = {
    console, document: doc, liff: opt.noLiff ? undefined : liff,
    navigator: { userAgent: 'node-stub' },
    location: { href: 'http://localhost/me.html', search: '', pathname: '/me.html',
                origin: 'http://localhost', hash: '', replace() {}, assign() {}, reload() {} },
    fetch: (u, init) => {
      送出.push({ url: String(u), body: String((init && init.body) || '') });
      if (opt.transportFail) return Promise.reject(new Error('boom'));
      return Promise.resolve({
        text: () => Promise.resolve('cb(' + JSON.stringify(opt.reply || { ok: true, who: '甲', pages: [] }) + ')'),
      });
    },
    URL, URLSearchParams, Promise, Date, Math, JSON, Object, Array, String, Number,
    Boolean, RegExp, Error, Buffer,
    setTimeout: (f, m) => { const i = setTimeout(f, m); timers.add(i); return i; },
    clearTimeout: (i) => { timers.delete(i); return clearTimeout(i); },
    setInterval: (f, m) => { const i = setInterval(f, m); timers.add(i); return i; },
    clearInterval: (i) => { timers.delete(i); return clearInterval(i); },
    alert() {}, confirm: () => false, addEventListener() {}, removeEventListener() {},
  };
  ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);

  const html = fs.readFileSync(path.join(ROOT, 'me.html'), 'utf8');
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
        vm.runInContext(m[2], ctx, { filename: 'me inline', timeout: 5000 });
      }
    }
  } finally { process.removeListener('unhandledRejection', onRej); }
  return { ctx, els, get, liff, 送出,
           cleanup: () => { for (const i of timers) { clearTimeout(i); clearInterval(i); } timers.clear(); } };
}

const settle = () => new Promise((r) => setImmediate(() => setImmediate(() => setImmediate(() => setImmediate(r)))));

/**
 * 🔴 **真實那幾列改成讀後端產的那一份，不再手抄**（2026-09-14 線 LN）。
 *
 * ══ 換掉了什麼、為什麼 ═════════════════════════════════════════════════
 *
 * 舊版是 gas `line-platform/roles.js` `DISPATCH_PAGES` 的**手寫副本**，它自己的註解就寫著
 * 「沒有任何機械的東西逼這份與 gas 相等」。後果是實測過的：
 *
 *   ⬛ 2026-09-14 實測：把 gas 的 `lineReady` 欄位連同它的測試一起拿掉
 *      → gas **2497／2497 全綠**、liff **1130／1130 全綠**
 *      → 線上 `me.html` 卻是**可點 0／5、五張卡全灰**，頁尾還說「其中 5 頁還沒改成
 *        LINE 登入，暫時仍要用原本的連結。」**零錯誤訊息**。
 *   ⇒ 這一檔對那件事**結構上免疫**：清單是手抄的，gas 送什麼它都綠。
 *
 * ⇒ 改成讀 `tests/fixtures/action-roles.json` 的 `dispatchPages`——後端
 *   `ci/roles-matrix/export-json.js` 產的，由後端 `ci/roles-matrix/copy-guard.js`
 *   ＋ `roles-matrix-guard.yml` **逐字比對**釘住。同一條契約、同一道守門，不另蓋一個。
 *
 * ⚠️ **守門長在 gas 那一側是刻意的**：真理在 `roles.js`，而 `jdc-line-gas` 是私有 repo
 *    ⇒ 這一端結構上答不出「我這份過期了沒有」。這裡能做的是**在自己這側真的用它**，
 *    讓它一旦過期不只是別的 repo 一個 CI 紅叉，而是這一檔的斷言跟著紅。
 *
 * ⚠️ 重產指令（在 jdc-line-gas 跑）：
 *    `node ci/roles-matrix/export-json.js --out <這裡>/tests/fixtures/action-roles.json`
 */
const 矩陣 = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'action-roles.json'), 'utf8'));

/**
 * 🔴 **刻意捏的示例列**，不是任何真頁。
 *    gas 表上今天每一列都是 `lineReady:true`、也都沒有 `note`，但 `me.html` 的
 *    「不可點＋說得出為什麼＋畫出 note」那段還在——不能因為今天的表用不到就不測，
 *    否則那段什麼時候壞掉都不會有人知道。
 */
const 示例列 = {
  page: '__未遷移示例__.html', title: '示例：尚未遷移的頁',
  gateAction: 'zzExample', lineReady: false, note: '示例註記',
};

const 清單 = {
  ok: true, who: '丁小恆',
  pages: (矩陣.dispatchPages || []).concat([示例列]),
};

/* ══ ⬛ 零點：清單真的是從後端那一份來的 ═══════════════════════════════ */

test('⬛ 零點：後端產的那一份讀得到，而且真的有分流頁那幾列', () => {
  // `dispatchPages` 不見時（副本是舊版、或後端不再出這一段），`清單.pages` 只剩示例列。
  // 下面那些指名 board／messages 的斷言**會紅**——但紅在一句看不懂的正規式比對失敗上，
  // 而讀到的人會去翻 me.html 的畫面邏輯，那裡什麼問題都沒有。
  // 🔴 這一格不是在補一個漏掉的紅燈，是**把紅燈搬到正確的地方**：先問「料有沒有到」，
  //    再問「畫得對不對」。零點答不出來時，下面每一條的紅綠都不值得解讀。
  assert.ok(Array.isArray(矩陣.dispatchPages),
    'action-roles.json 沒有 dispatchPages ⇒ 副本是舊版，在 jdc-line-gas 重產一次');
  assert.ok(矩陣.dispatchPages.length >= 2,
    '後端只給了 ' + 矩陣.dispatchPages.length + ' 列 ⇒ 下面的斷言在一個太小的清單上跑');
  ['board.html', 'messages.html'].forEach((p) => {
    assert.ok(矩陣.dispatchPages.some((r) => r.page === p),
      '後端那份裡沒有 ' + p + '，而下面有斷言指名它 ⇒ 那幾條會紅在看不懂的地方');
  });
});

test('🔴 後端送來的每一列都必須帶布林的 lineReady', () => {
  // 🔴 這一條是 `lineReady` 被拆掉時，**liff 這一側**唯一會響的地方。
  //    （gas 那側先響的是 copy-guard：副本與現況逐字不同 ⇒ 退出碼 3。
  //      有人照它的指示重產副本之後，換這一條紅。兩個方向都有人守。）
  //    要拆這個欄位，順序必須是**先改 me.html（已改成「明寫 false 才不可點」）並發布，
  //    再拆後端**；這一條與它一起改，不是在它之前悄悄消失。
  矩陣.dispatchPages.forEach((r) => {
    assert.equal(typeof r.lineReady, 'boolean',
      r.page + ' 的 lineReady 是 ' + JSON.stringify(r.lineReady)
      + ' ⇒ 後端不再宣告這一欄。me.html 現在會把它當「可點」（刻意的，見 me.html 檔頭），'
      + '但清單與畫面的契約已經變了，要一起處理。');
  });
});

/* ══ ⬛ 對照組先行 ═══════════════════════════════════════════════════════ */

test('⬛ 對照組：登入正常時，真的打了 listMyPages 並把清單畫出來', async () => {
  const r = runMe({ reply: 清單 });
  await settle();
  try {
    assert.equal(r.liff.__initCalled, 1, 'LIFF 沒被初始化 ⇒ 這一頁的身分那一段根本沒跑');
    assert.equal(r.送出.length, 1, '沒有送出任何呼叫（或送了不只一次）');
    assert.match(r.送出[0].body, /(^|&)action=listMyPages(&|$)/, '打的不是 listMyPages');
    assert.match(r.get('who').textContent, /丁小恆/, '畫面沒說出是以誰的身分進來的');
    assert.ok(r.get('list').innerHTML.length > 50, '清單是空的 ⇒ 下面那些斷言在驗沒發生的事');
  } finally { r.cleanup(); }
});

/* ══ 🔴 這一頁不可以碰 token ══════════════════════════════════════════════ */

test('🔴 送出的呼叫帶 idToken、**一個 token 參數都不帶**（帶了後端就改走舊路）', async () => {
  const r = runMe({ reply: 清單 });
  await settle();
  try {
    const b = r.送出[0].body;
    assert.match(b, /(^|&)idToken=IDTOK(&|$)/, '沒帶 idToken ⇒ 後端永遠認不出他是誰');
    assert.equal(/(^|&)t(oken)?=/.test(b), false,
      '帶了 token 參數 ⇒ 後端 `_hasTok` 成立、整條路改走 gateAction，'
      + '而這一頁存在的前提就是他手上沒有那串。送出的是：' + b);
  } finally { r.cleanup(); }
});

test('🔴 整頁不得產生任何帶 ?t= 的連結（登入不是憑證發放機，2026-09-12 拍板）', () => {
  const html = fs.readFileSync(path.join(ROOT, 'me.html'), 'utf8');
  // 只看程式碼與標記，註解裡講這件事是刻意的（那正是它被寫下來的原因）。
  const 去註解 = html.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
  assert.equal(/\?t=|[?&]t=['"+]|urlToken\s*\(/.test(去註解), false,
    'me.html 出現了 `?t=` 或 urlToken() ⇒ 它開始經手那串憑證了');
  // ⬛ 對照組：這把尺分得出「有」——board.html 就真的有（它兩條路都走）。
  const board = fs.readFileSync(path.join(ROOT, 'board.html'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
  assert.equal(/\?t=|urlToken\s*\(/.test(board), true,
    '連 board.html 都掃不到 `?t=` ⇒ 這把尺什麼都沒測到，上面那條的綠燈是假的');
});

/* ══ 🔴 可點與不可點 ════════════════════════════════════════════════════ */

test('🔴 lineReady:true → 真的可點的 <a>；lineReady:false → 沒有 <a>，而且說得出為什麼', async () => {
  const r = runMe({ reply: 清單 });
  await settle();
  try {
    const h = r.get('list').innerHTML;
    assert.match(h, /<a class="card" href="board\.html">/,
      '已遷移的頁沒做成連結 ⇒ 他明明進得去，卻沒有入口');
    assert.match(h, /人事異動看板/);
    assert.match(h, /<a class="card" href="messages\.html">/,
      'messages.html（lineReady:true）沒做成連結 ⇒ 分流頁翻了可點，畫面卻還是灰的');
    // 🔴 未遷移的頁（示例列）：出現在畫面上，但不是連結。
    assert.match(h, /示例：尚未遷移的頁/, '未遷移的頁被藏起來了 ⇒ 「沒權限」與「還沒做好」變同一個畫面');
    assert.equal(/<a[^>]+href="__未遷移示例__\.html"/.test(h), false,
      '未遷移的頁做成了可點的連結 ⇒ 點下去必定被擋，而他什麼都沒做錯');
    assert.match(h, /尚未支援 LINE 登入/, '不可點的那一列沒說出為什麼');
    assert.match(h, /示例註記/, 'note 沒畫出來 ⇒ 「這一格還有別的條件」這件事被吞掉了');
  } finally { r.cleanup(); }
});

test('⬛ 對照組：把 lineReady 反過來，可點／不可點必須整個對調（否則上面是恆真）', async () => {
  // 2026-09-14 線 LR：改成把 `清單` 逐列反轉（原本手寫一份反過來的兩列——那又是一份會與 `清單` 分歧的副本）。
  const r = runMe({ reply: Object.assign({}, 清單, {
    pages: 清單.pages.map((p) => Object.assign({}, p, { lineReady: !p.lineReady })),
  }) });
  await settle();
  try {
    const h = r.get('list').innerHTML;
    assert.equal(/<a[^>]+href="board\.html"/.test(h), false, 'lineReady 反過來了，board 卻還是連結 ⇒ 這一格根本沒看 lineReady');
    assert.equal(/<a[^>]+href="messages\.html"/.test(h), false, 'lineReady 反過來了，messages 卻還是連結');
    assert.match(h, /<a class="card" href="__未遷移示例__\.html">/, '示例列反成 true 卻沒變連結');
  } finally { r.cleanup(); }
});

test('🔴 後端整個沒送 lineReady 這個 key → 照樣可點，頁尾不得冒出「還沒改成 LINE 登入」', async () => {
  // 🔴 **這一條釘的是 `!== false` 那個判準本身**（2026-09-14 線 LN）。
  //    上面每一條餵的資料都帶著這個 key，所以 `if (p.lineReady)` 與
  //    `if (p.lineReady !== false)` 在它們眼裡完全一樣——**把判準改回舊寫法，
  //    上面 13 條沒有一條會紅**（實測：改回去後 liff 全套 1132／1132 仍全綠）。
  //    ⇒ 少了這一格，(a) 那個改動可以被任何人無聲地改回去。
  //
  // 🔴 為何這個輸入值得測：`lineReady` 是後端**宣告**的欄位，而宣告欄位會腐爛。
  //    它不見的時候（後端改版、欄位被拆、回應被中間層改寫），舊寫法的畫面是
  //    **五張卡全灰＋頁尾一句「暫時仍要用原本的連結」**，零錯誤訊息——
  //    畫面說了一句假話，把人推去找他可能根本沒有的舊連結。
  const 沒有那個key = {
    ok: true, who: '丁小恆',
    pages: 矩陣.dispatchPages.map((p) => {
      const c = Object.assign({}, p);
      delete c.lineReady;
      return c;
    }),
  };
  const r = runMe({ reply: 沒有那個key });
  await settle();
  try {
    const h = r.get('list').innerHTML;
    const 連結數 = (h.match(/<a class="card"/g) || []).length;
    assert.equal(連結數, 沒有那個key.pages.length,
      '後端沒送 lineReady，' + 沒有那個key.pages.length + ' 列裡只有 ' + 連結數 + ' 列可點'
      + ' ⇒ 判準又變回「true 才可點」，`undefined` 被當成「這一頁還沒好」。');
    assert.equal(/尚未支援 LINE 登入/.test(h), false,
      '後端沒講，畫面卻替它講了「尚未支援 LINE 登入」⇒ 這是一句沒有依據的話');
    assert.equal(r.get('foot').textContent, '',
      '頁尾說了「還有幾頁沒開放」，而後端根本沒宣告任何一頁沒開放：'
      + JSON.stringify(r.get('foot').textContent));
  } finally { r.cleanup(); }
});

test('⬛ 對照組：同一批資料**明寫** lineReady:false → 必須全部變灰（證明上一條不是「永遠可點」）', async () => {
  // 沒有這一格，上一條可以靠「把 else 分支整段刪掉」通過——那才是真的壞掉。
  const 明寫false = {
    ok: true, who: '丁小恆',
    pages: 矩陣.dispatchPages.map((p) => Object.assign({}, p, { lineReady: false })),
  };
  const r = runMe({ reply: 明寫false });
  await settle();
  try {
    const h = r.get('list').innerHTML;
    assert.equal((h.match(/<a class="card"/g) || []).length, 0,
      '明寫 false 卻還是可點 ⇒ `!== false` 那一格根本沒在看值，上一條的綠燈是假的');
    assert.match(h, /尚未支援 LINE 登入/, '明寫 false 的那幾列沒說出為什麼');
    assert.match(r.get('foot').textContent, /還沒改成 LINE 登入/,
      '後端明說了有頁面沒開放，頁尾卻不講 ⇒ 使用者不知道要去找舊連結');
  } finally { r.cleanup(); }
});

/* ══ 🔴 空清單與失敗：每一種要講不同的話 ═══════════════════════════════ */

test('🔴 空清單 → 不是錯誤畫面，而且要把「你是誰」留在畫面上', async () => {
  const r = runMe({ reply: { ok: true, who: '丁小祥', pages: [] } });
  await settle();
  try {
    assert.match(r.get('who').textContent, /丁小祥/,
      '空清單時沒說出身分 ⇒ 「我沒權限」與「我登入成了另一個 LINE 帳號」在畫面上一模一樣');
    assert.equal(/msg-err/.test(r.get('list').innerHTML), false,
      '空清單畫成紅色錯誤 ⇒ 他會以為系統壞了而一直重試');
  } finally { r.cleanup(); }
});

/**
 * 🔴 **空清單那段話說的是「這裡列不出來」，不是「你沒有頁面可以進」（2026-09-14）。**
 *
 * ══ 為何補這一條 ═══════════════════════════════════════════════════════
 *
 * 改之前，全 repo **只有一條**在碰這段文案（上一條測試的
 * `assert.match(..., /沒有可以進入的頁面/)`），而它釘的是**那句斷言本身**——
 * 也就是說，那句話說了假話的時候，測試是綠的、而且正是它在把假話釘住。
 * ⬛ 量過：`git grep -c` 全 repo，「登入成另一個 LINE 帳號」只有 `me.html` 一處
 * （＝**零測試**），「沒有可以進入的頁面」兩處（`me.html` 與上面那一行）。
 *
 * 它為什麼是假話：清單只列後端 `DISPATCH_PAGES` 上有的頁。不在那張表上、
 * 但當事人天天用固定連結進得去的頁（2026-09-14 已知至少一頁、兩種角色會走到這裡），
 * 這一段一個字都不會提 ⇒ **有頁可進的人被告知他沒有，然後被指去查自己的 LINE 帳號。**
 *
 * ══ 這一條釘三件事，每一件都能單獨被突變抓到 ═══════════════════════════
 *
 *   ① **範圍**：說的是「列不出來」，不是「沒有」。
 *   ② **處置**：要講出「有些頁不在這份清單上，原本的連結繼續用」。
 *      ——這是走到這一格的人**最可能**的處置，所以它必須出現。
 *   ③ **順序**：「可能登錯帳號」要留著（它是真的可能），但**不可以排在 ② 前面**。
 *      排在前面＝把人推去查一個大多數時候沒問題的東西。
 *
 * ⚠️ ③ 用的是「兩段文字在 innerHTML 裡誰先出現」，不是行號、不是第幾個 `<p>`。
 *    行號與序號會因為無關的改動而漂（`feedback_position_is_not_identity`）；
 *    這裡問的是「讀的人先讀到哪一句」，那正是順序本身，不是拿位置去推定別的東西。
 *
 * ⚠️ **這一條刻意不逐字釘整段文案。** 文案會為了人而改（`assets/deny-no-role.js`
 *    那次實測：拿文案當判準，11 種措辭有 9 種會讓處置靜默消失）。
 *    釘的是這三件事在不在、誰先誰後。
 */
test('🔴 空清單那段話：講「這裡列不出來」而不是「你沒有」，且「可能登錯帳號」不排第一', async () => {
  const r = runMe({ reply: { ok: true, who: '丁小祥', pages: [] } });
  await settle();
  try {
    const h = r.get('list').innerHTML;

    // ① 範圍：不可以斷言「沒有可以進入的頁面」。
    assert.equal(/沒有可以進入的頁面/.test(h), false, [
      '🔴 空清單畫面又說出「沒有可以進入的頁面」。',
      '   那是一句關於他的斷言，而清單只看得到 DISPATCH_PAGES 那張表',
      '   ⇒ 用固定連結進得去的人會被告知他沒有頁面可進。',
      '   要講的是「這裡列不出來」，不是「你沒有」。',
    ].join('\n'));

    // ② 處置：要講出「有些頁不在這份清單上、原本的連結繼續用」。
    assert.match(h, /不會出現在這份清單上/,
      '空清單沒講出「有些頁面本來就不在這份清單上」⇒ 他只會讀成「我沒權限」');
    assert.match(h, /請繼續用原本的連結/,
      '空清單沒給出最可能的處置（繼續用原本的連結）⇒ 他會去找系統維護者要一個他早就有的東西');

    // ③ 順序：登錯帳號要留著，但排在 ② 後面。
    const 登錯帳號 = h.indexOf('登入成另一個 LINE 帳號');
    const 原本的連結 = h.indexOf('請繼續用原本的連結');
    assert.ok(登錯帳號 >= 0,
      '「可能登入成另一個 LINE 帳號」整段不見了 ⇒ 那是真實的可能性，拿掉它會讓真的登錯的人卡住');
    assert.ok(原本的連結 >= 0 && 登錯帳號 > 原本的連結, [
      '🔴 「可能登錯 LINE 帳號」出現在「繼續用原本的連結」之前（或後者不存在）。',
      '   位置：登錯帳號=' + 登錯帳號 + '、原本的連結=' + 原本的連結,
      '   把登錯帳號排前面 ⇒ 他會先去查自己的 LINE，而那多半沒問題。',
    ].join('\n'));

    // ⬛ 對照組：上面三格都是在**有東西可讀**的字串上算的。
    //    沒有這一格，整段 innerHTML 變成空字串時 ①（否定式）會通過，
    //    而那時 ②③ 的失敗訊息會把人指向文案，真正的成因卻是畫面根本沒畫。
    assert.ok(h.length > 0 && /msg-info/.test(h),
      '⬛ 空清單根本沒畫出 msg-info 區塊 ⇒ 上面那三格算的是空字串，這一輪什麼都沒測到');
  } finally { r.cleanup(); }
});

test('🔴 憑證壞掉 → 給「重新登入」鈕；權限算不出來 → 不給（重登對後者永遠沒用）', async () => {
  const 壞憑證 = runMe({ reply: { ok: false, msg: '請重新登入。', reason: 'line_bad_token' } });
  await settle();
  const 算不出角色 = runMe({ reply: { ok: false, msg: '系統目前讀不到您的權限設定。', reason: 'role_unresolved' } });
  await settle();
  try {
    assert.match(壞憑證.get('list').innerHTML, /重新登入/, '憑證過期卻沒給重登的路');
    assert.match(壞憑證.get('list').innerHTML, /請重新登入。/, '沒把後端那句話原樣顯示出來');
    assert.equal(/id="relogin"/.test(算不出角色.get('list').innerHTML), false,
      '「讀不到權限設定」也給了重登鈕 ⇒ 他會一直重登一直失敗，而問題根本不在他身上');
    assert.match(算不出角色.get('list').innerHTML, /讀不到您的權限設定/);
  } finally { 壞憑證.cleanup(); 算不出角色.cleanup(); }
});

test('🔴 按下重新登入要先 logout 再 login（只 login 會帶著同一把過期憑證直接回來）', async () => {
  const r = runMe({ reply: { ok: false, msg: '請重新登入。', reason: 'line_no_token' } });
  await settle();
  try {
    r.get('relogin').click();
    assert.equal(r.liff.__logoutCalled, 1, '沒有先登出 ⇒ 他會一直按、一直失敗');
    assert.ok(r.liff.__loginArgs, '沒有去登入');
  } finally { r.cleanup(); }
});

test('🔴 連線失敗與「伺服器說不行」講不同的話（一個重試有用、一個永遠沒用）', async () => {
  const 斷線 = runMe({ transportFail: true });
  await settle();
  const 被拒 = runMe({ reply: { ok: false, msg: '此連結非您的權限範圍。', reason: 'role_mismatch' } });
  await settle();
  try {
    assert.notEqual(斷線.get('who').textContent, 被拒.get('who').textContent,
      '兩種失敗講同一句話 ⇒ 其中一種的人會被指錯路');
    assert.match(斷線.get('list').innerHTML, /連線|網路/);
    assert.equal(/id="relogin"/.test(斷線.get('list').innerHTML), false,
      '斷線卻叫他重新登入 ⇒ 重登不會讓網路變好');
  } finally { 斷線.cleanup(); 被拒.cleanup(); }
});

/* ══ 🔴 還沒登入：不可以帶著空憑證去打後端 ════════════════════════════ */

test('🔴 還沒登入 → 去 LINE 登入，且一個呼叫都不發（空憑證打後端＝製造一發必定失敗）', async () => {
  const r = runMe({ loggedIn: false });
  await settle();
  try {
    assert.ok(r.liff.__loginArgs, '沒有呼叫 liff.login');
    assert.equal(r.liff.__loginArgs.redirectUri, 'http://localhost/me.html',
      'redirectUri 不是本頁 ⇒ 登完回不來');
    assert.deepStrictEqual(r.送出, [], '還沒登入就發車了');
  } finally { r.cleanup(); }
});

test('🔴 登入了卻拿不到憑證 → 明講是後台設定問題，而且不發車', async () => {
  const r = runMe({ idToken: '' });
  await settle();
  try {
    assert.deepStrictEqual(r.送出, [], '拿不到憑證還是發車了 ⇒ 換來一句看不懂的後端錯誤');
    assert.match(r.get('list').innerHTML, /重新整理不會好|資訊人員/,
      '沒說出「重新整理不會好」⇒ 他會一直重整');
  } finally { r.cleanup(); }
});

test('🔴 LIFF SDK 根本沒載進來 → 出聲，不要停在「確認身分中…」', async () => {
  const r = runMe({ noLiff: true });
  await settle();
  try {
    assert.equal(/確認身分中/.test(r.get('who').textContent), false,
      '停在初始文案 ⇒ 使用者只會看到一頁不動的畫面，而沒有人知道是哪一段壞了');
    assert.match(r.get('list').innerHTML, /LINE 的元件/);
  } finally { r.cleanup(); }
});

/* ══ 🔴 清單是後端算的，不是這一頁算的 ════════════════════════════════ */

test('🔴 頁面清單不得寫死在前端（寫死＝兩份會分歧，而分歧長成「點了被擋」）', () => {
  const html = fs.readFileSync(path.join(ROOT, 'me.html'), 'utf8');
  const 去註解 = html.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
  ['board.html', 'stats.html', 'hr-stats.html', 'messages.html', 'staff.html'].forEach((p) => {
    assert.equal(去註解.indexOf("'" + p + "'") >= 0 || 去註解.indexOf('"' + p + '"') >= 0, false,
      'me.html 的程式碼裡寫死了 ' + p + ' ⇒ 它開始自己維護一份清單了');
  });
  // ⬛ 對照組：這把尺掃得到真的有寫死頁名的東西（本檔自己就有那五個字串）。
  const 自己 = fs.readFileSync(__filename, 'utf8');
  assert.equal(自己.indexOf("'board.html'") >= 0, true,
    '連本檔自己都掃不到 ⇒ 上面那條的「沒有」只是尺壞了');
});
