/**
 * **授權名單維護頁 `authz.html` 的接線**（gas `#100`，2026-09-17）。
 *
 * ══ 這一頁唯一會害到人的錯 ═══════════════════════════════════════════════
 *
 * 2026-09-16 16:09–16:16 生產環境：授權名單某一列的「角色」空白 ⇒ 整份作廢
 * ⇒ 四分鐘內走 LINE 登入的人全部進不去。這一頁存在的理由是把守恆
 * 從「存檔之後才發現」搬到「**存檔之前擋下來**」。
 * ⇒ 🔴 **這一檔最重要的那幾條，全都在問「按下存檔之前，他看到了什麼」。**
 *
 * ⚠️ `page-load.test.js` 只證明「載得起來」；它跑完整頁 script 而不看畫面，
 *    所以「檢查沒過卻還是存得下去」它一條都不會紅。
 *
 * ⚠️ 手法沿用 `me-dispatch-wiring.test.js`：把頁面的 script 丟進 stub 環境跑，
 *    測的是 `authz.html` 裡真正那幾行字。DOM 與網路是假的。
 *
 * ⚠️ **夾具全部是假的**（本 repo 是公開的）：內部碼是用內部碼字母表造的假碼、
 *    姓名是「測試甲／乙／丙」。**一格真實資料都沒有。**
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');

/* ══════════════════════════════════════════════════════════════════════
 * 夾具（假資料）
 * ══════════════════════════════════════════════════════════════════════ */

const HDR = ['內部碼', '角色', '狀態', '授予日', '停用日', '備註', '姓名'];
const 甲 = 'JDC-BBBBBB', 乙 = 'JDC-CCCCCC', 丙 = 'JDC-DDDDDD', 丁 = 'JDC-EEEEEE', 戊 = 'JDC-AAAAAA';
/**
 * ⬛ **名冊的部門刻意這樣配**（`#60`，2026-09-18）——三件事缺一，分組那一組尺就瞎了：
 *   ⒜ **`測試單位一` 有兩個人，而且他們在名冊裡不相鄰**（甲…丙）
 *      ⇒ 分組真的得搬動 `丙`。兩人相鄰的話，分不分組畫出來一模一樣。
 *   ⒝ **有一個人的部門是空的**（丁）⇒ 「沒有單位的人不准消失」量得到。
 *      全員都有部門的夾具對那一條零鑑別力。
 *   ⒞ 名冊順序照後端（按內部碼遞增）⇒ 平的清單與分組後的清單**順序不同**。
 *   ⒟ 🔴 **名冊第一個人就是沒填部門的那個**（戊＝`JDC-AAAAAA`）。
 *      ⬛ 這一格是突變逼出來的：沒填的人全排在名冊後面時，「未填那一組墊底」
 *      與「照出現順序」畫出來一模一樣 ⇒ 把墊底那兩行拿掉，**這一檔全綠**
 *      （2026-09-18 實測 M6 存活）。放一個在最前面，那兩種寫法才分得開。
 */
const 單位 = { [戊]: '', [甲]: '測試單位一', [乙]: '測試單位二', [丙]: '測試單位一', [丁]: '' };
const 名單回應 = () => ({
  ok: true, who: '測試甲', header: HDR.slice(),
  rows: [
    [甲, 'admin', '有效', '2026-09-01', '', '', '測試甲'],
    [乙, 'hr', '有效', '2026-09-01', '', '', '測試乙'],
  ],
  roster: [
    { code: 戊, name: '測試戊', unit: 單位[戊] },
    { code: 甲, name: '測試甲', unit: 單位[甲] },
    { code: 乙, name: '測試乙', unit: 單位[乙] },
    { code: 丙, name: '測試丙', unit: 單位[丙] },
    { code: 丁, name: '測試丁', unit: 單位[丁] },
  ],
  rosterCollisions: [],
  // 🔴 後端 gas `#184` 起一定會送這一格（線上 `4710156` 已部署）。
  //    **夾具跟著送**，否則這裡量到的「不分組」是夾具造成的，不是產品。
  rosterUnitColumn: true,
  assignableRoles: ['admin', 'hr', 'activity', 'hrstats', 'messaging'],
  statusValues: ['有效', '停用'],
  current: { pass: true, rowCount: 2, adminCount: 1 },
});

/* ══════════════════════════════════════════════════════════════════════
 * 一個記得住 innerHTML／value／事件的假 DOM
 * ══════════════════════════════════════════════════════════════════════ */

function fakeEl(id) {
  const e = {
    id: id || '', style: {}, dataset: {}, className: '', value: '', hidden: false,
    innerHTML: '', textContent: '', disabled: false, href: '',
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    __on: {}, __kids: [],
    appendChild(c) { this.__kids.push(c); return c; },
    removeChild() {}, insertAdjacentHTML() {}, setAttribute() {}, removeAttribute() {},
    getAttribute: () => null,
    addEventListener(t, f) { (this.__on[t] = this.__on[t] || []).push(f); },
    removeEventListener() {}, querySelector: () => null, querySelectorAll: () => [],
    focus() {}, remove() {},
    click() { (this.__on.click || []).forEach((f) => f({ target: e })); },
    parentNode: null,
  };
  return e;
}

/**
 * 頁面把欄位的座標寫在 `data-n`（第幾列）與 `data-c`（第幾欄）上，這裡照樣模擬。
 *
 * 🔴 **巢狀深度要跟真的那一頁一樣，不可以圖方便少包一層。**（`#117`，2026-09-17）
 *    真實結構是 `.row[data-n] > .det > .fld > 欄位` ⇒ 欄位在第**三**層。
 *    這個替身原本只包兩層，而頁面舊版的取法是寫死的
 *    `f.parentNode.parentNode` ——兩者剛好對上 ⇒ 這一檔全綠。
 *    `#117` 把一列改成「摺起來那一行 ＋ 展開的細節」之後深度變成三層，
 *    **舊取法會取到 `.det`、拿不到 `data-n`、直接 return**
 *    ⇒ 使用者改了一格而草稿沒更新、也沒變髒，畫面停在綠色的「七道都過」，
 *      按下存檔送出的是舊草稿。**零錯誤訊息，而這一檔仍然會全綠。**
 * ⇒ 深度改成跟真頁一致，那種取法才會在這裡就紅。
 *    ⚠️ 真頁改版面時**這個替身要跟著改**——它是一份手抄的結構副本，
 *       沒有任何機械的東西逼它與 `render()` 相等。
 */
function 假欄位(n, c) {
  const f = fakeEl('');
  f.getAttribute = (k) => (k === 'data-c' ? String(c) : null);
  const fld = fakeEl(''); fld.getAttribute = () => null;          // .fld
  const det = fakeEl(''); det.getAttribute = () => null;          // .det
  const row = fakeEl(''); row.getAttribute = (k) => (k === 'data-n' ? String(n) : null);
  f.parentNode = fld; fld.parentNode = det; det.parentNode = row;
  return f;
}

/**
 * 跑 authz.html。
 * @param {object} o `回應`＝一個 action → JSON 的表；`transportFail`＝連線層壞掉
 */
function run(o) {
  const opt = o || {};
  const 送出 = [];
  const timers = new Set();
  const els = {};
  const get = (id) => (els[id] || (els[id] = fakeEl(id)));
  const doc = {
    getElementById: get, querySelector: () => null, querySelectorAll: () => [],
    createElement: (t) => fakeEl(t), body: fakeEl('body'), documentElement: fakeEl('html'),
    head: fakeEl('head'), addEventListener() {}, readyState: 'complete',
  };
  const liff = {
    __loginArgs: null, __logoutCalled: 0,
    init: (a) => Promise.resolve(a),
    isLoggedIn: () => opt.loggedIn !== false,
    getIDToken: () => (opt.idToken === undefined ? 'IDTOK' : opt.idToken),
    logout() { liff.__logoutCalled++; },
    login(a) { liff.__loginArgs = a; },
    isInClient: () => true, closeWindow() {}, openWindow() {},
  };
  const ctx = {
    console, document: doc, liff: opt.noLiff ? undefined : liff,
    navigator: { userAgent: 'node-stub' },
    location: { href: 'http://localhost/authz.html', search: '', pathname: '/authz.html',
                origin: 'http://localhost', hash: '', replace() {}, assign() {}, reload() {} },
    fetch: (u, init) => {
      const body = String((init && init.body) || '');
      const act = (body.match(/(?:^|&)action=([^&]*)/) || [])[1] || '';
      送出.push({ url: String(u), body, action: act });
      if (opt.transportFail) return Promise.reject(new Error('boom'));
      const 回 = (opt.回應 && opt.回應[act]) || 名單回應();
      const v = typeof 回 === 'function' ? 回(送出.length) : 回;
      return Promise.resolve({ text: () => Promise.resolve('cb(' + JSON.stringify(v) + ')') });
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

  const html = fs.readFileSync(path.join(ROOT, 'authz.html'), 'utf8');
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
        vm.runInContext(m[2], ctx, { filename: 'authz inline', timeout: 5000 });
      }
    }
  } finally { process.removeListener('unhandledRejection', onRej); }
  return { ctx, els, get, liff, 送出,
           cleanup: () => { for (const i of timers) { clearTimeout(i); clearInterval(i); } timers.clear(); } };
}

const settle = () => new Promise((r) => setImmediate(() => setImmediate(() => setImmediate(() => setImmediate(r)))));

/** 觸發一次「使用者改了第 n 列第 c 欄」。走頁面真的掛在容器上的那個監聽。 */
function 改一格(r, n, c, 值) {
  const f = 假欄位(n, c);
  f.value = 值;
  (r.els.list.__on.input || []).forEach((fn) => fn({ target: f }));
}

/* ══════════════════════════════════════════════════════════════════════
 * ⬛ 零點：這個替身真的能把頁面跑起來
 * ══════════════════════════════════════════════════════════════════════ */

test('⬛ 零點：登入正常時，開頁第一發打的是 getAuthzList，而且把名單畫出來', async () => {
  const r = run({});
  await settle();
  assert.equal(r.送出.length >= 1, true, '一發都沒送出 ⇒ 下面每一條都是在驗沒發生的事');
  assert.equal(r.送出[0].action, 'getAuthzList',
    '開頁第一發是 ' + r.送出[0].action + ' ⇒ 分流頁那一列的 gateAction 就指錯了');
  assert.match(r.els.list.innerHTML, /測試甲/, '名單沒有畫出來');
  assert.match(r.els.list.innerHTML, new RegExp(乙), '第二列沒有畫出來');
  assert.equal(r.els.who.textContent, '測試甲', '沒有把「你是誰」留在畫面上');
  r.cleanup();
});

/* ══════════════════════════════════════════════════════════════════════
 * 🔴 Ａ：存檔之前先看到七道守恆的結果
 * ══════════════════════════════════════════════════════════════════════ */

test('🔴 開頁時存檔鈕是關的——還沒檢查過的草稿不可以按得下去', async () => {
  const r = run({});
  await settle();
  assert.equal(r.els.save.disabled, true,
    '🔴 一進來就能按存檔 ⇒ dry-run 變成可以跳過的東西，那就只是把試算表換成網頁');
  r.cleanup();
});

test('🔴 檢查沒過 ⇒ 面板指名是哪一道哪一列，存檔鈕仍然是關的，而且一發 saveAuthzList 都沒送', async () => {
  const r = run({ 回應: { checkAuthzDraft: {
    ok: true, pass: false, gate: '②非空', detail: '第 3 列的「角色」是空的', changes: [],
  } } });
  await settle();
  r.els.check.click();
  await settle();
  assert.match(r.els.panel.innerHTML, /②非空/, '面板沒有講是哪一道：' + r.els.panel.innerHTML);
  assert.match(r.els.panel.innerHTML, /第 3 列/, '面板沒有講是哪一列');
  assert.match(r.els.panel.innerHTML, /角色/, '面板沒有講是哪一欄');
  assert.equal(r.els.panel.className, 'fail');
  assert.equal(r.els.save.disabled, true, '🔴 檢查沒過卻能按存檔');
  // 🔴 就算硬按下去也不可以送出——按鈕的 disabled 只是畫面，這一條驗的是行為。
  r.els.save.click();
  await settle();
  assert.deepStrictEqual(r.送出.filter((s) => s.action === 'saveAuthzList'), [],
    '🔴 檢查沒過卻送出了 saveAuthzList');
  r.cleanup();
});

test('⬛ 對照Ａ：檢查過了 ⇒ 面板攤出「按下去會發生什麼」，存檔鈕才打開', async () => {
  const r = run({ 回應: { checkAuthzDraft: {
    ok: true, pass: true, rowCount: 2, adminCount: 1,
    changes: ['修改 測試乙（' + 乙 + '）／hr：狀態「有效」→「停用」'],
  } } });
  await settle();
  r.els.check.click();
  await settle();
  assert.equal(r.els.panel.className, 'pass',
    '🔴 檢查過了面板卻不是 pass ⇒ 上面那條「沒過就關著」可能只是「永遠關著」');
  assert.match(r.els.panel.innerHTML, /測試乙/, '面板沒有攤出即將發生的改動');
  assert.match(r.els.panel.innerHTML, /停用/);
  assert.equal(r.els.save.disabled, false, '檢查過了存檔鈕仍然是關的');
  r.cleanup();
});

test('🔴 檢查過之後又改了一格 ⇒ 檢查結果作廢、存檔鈕關回去（他看過的那一份已經不是這一份了）', async () => {
  const r = run({ 回應: { checkAuthzDraft: { ok: true, pass: true, rowCount: 2, adminCount: 1, changes: [] } } });
  await settle();
  r.els.check.click();
  await settle();
  assert.equal(r.els.save.disabled, false, '⬛ 前置：檢查要先真的打開存檔鈕');

  改一格(r, 1, HDR.indexOf('狀態'), '停用');
  assert.equal(r.els.save.disabled, true,
    '🔴 改過之後存檔鈕還開著 ⇒ 畫面會停在綠色的「七道都過」，而他改的那一格從沒被驗過');
  assert.equal(r.els.panel.className, 'idle');

  r.els.save.click();
  await settle();
  assert.deepStrictEqual(r.送出.filter((s) => s.action === 'saveAuthzList'), [],
    '🔴 改過之後仍然送得出去');
  r.cleanup();
});

test('🔴 送出去的是**檢查過的那一份**，不是當下畫面上那一份（不然 dry-run 什麼都沒保證）', async () => {
  const r = run({ 回應: {
    checkAuthzDraft: { ok: true, pass: true, rowCount: 2, adminCount: 1, changes: [] },
    saveAuthzList: { ok: true, rowCount: 2, adminCount: 1, changes: [], logged: true, logSheet: '授權名單異動紀錄' },
  } });
  await settle();
  r.els.check.click();
  await settle();
  const 驗過的那一份 = decodeURIComponent(
    (r.送出.filter((s) => s.action === 'checkAuthzDraft')[0].body.match(/&rows=([^&]*)/) || [])[1] || '');
  r.els.save.click();
  await settle();
  const 送的 = r.送出.filter((s) => s.action === 'saveAuthzList');
  assert.equal(送的.length, 1, '存檔沒有送出');
  const 存的那一份 = decodeURIComponent((送的[0].body.match(/&rows=([^&]*)/) || [])[1] || '');
  assert.equal(存的那一份, 驗過的那一份,
    '🔴 存檔送的與檢查過的不是同一份 ⇒ dry-run 看過的結果不是即將發生的事');
  assert.ok(驗過的那一份.indexOf(甲) >= 0, '⬛ 零點：草稿是空的 ⇒ 上面那條在比兩個空字串');
  r.cleanup();
});

/* ══════════════════════════════════════════════════════════════════════
 * 🔴 Ｂ：留痕寫失敗要說出來
 * ══════════════════════════════════════════════════════════════════════ */

test('🔴 存檔成功但留痕沒寫成 ⇒ 畫面要說出來（包起來不講比不回報更糟）', async () => {
  const r = run({ 回應: {
    checkAuthzDraft: { ok: true, pass: true, rowCount: 2, adminCount: 1, changes: [] },
    saveAuthzList: { ok: true, rowCount: 2, adminCount: 1, changes: ['修改 測試乙'],
                     logged: false, logError: '分頁被鎖住', logSheet: '授權名單異動紀錄' },
  } });
  await settle();
  r.els.check.click();
  await settle();
  r.els.save.click();
  await settle();
  assert.match(r.els.panel.innerHTML, /異動紀錄沒有寫成功/, '留痕失敗被吞掉了：' + r.els.panel.innerHTML);
  assert.match(r.els.panel.innerHTML, /分頁被鎖住/, '沒有把原因講出來');
  r.cleanup();
});

test('⬛ 對照Ｂ：留痕寫成功時不要跳這句話（否則上面那條是「永遠在喊」）', async () => {
  const r = run({ 回應: {
    checkAuthzDraft: { ok: true, pass: true, rowCount: 2, adminCount: 1, changes: [] },
    saveAuthzList: { ok: true, rowCount: 2, adminCount: 1, changes: [], logged: true, logSheet: '授權名單異動紀錄' },
  } });
  await settle();
  r.els.check.click();
  await settle();
  r.els.save.click();
  await settle();
  assert.ok(r.els.panel.innerHTML.indexOf('沒有寫成功') < 0, '留痕成功卻在喊失敗');
  assert.match(r.els.panel.innerHTML, /授權名單異動紀錄/, '沒有講留到哪裡');
  r.cleanup();
});

/* ══════════════════════════════════════════════════════════════════════
 * 🔴 這一頁不判斷權限、不自己寫一份守恆、不產生 ?t=
 * ══════════════════════════════════════════════════════════════════════ */

test('🔴 整頁不得產生任何帶 ?t= 的連結（登入不是憑證發放機）', () => {
  const src = fs.readFileSync(path.join(ROOT, 'authz.html'), 'utf8');
  assert.ok(!/[?&]t=/.test(src.replace(/\/\*[\s\S]*?\*\//g, '')),
    '🔴 authz.html 裡出現了 `?t=`／`&t=`');
});

test('🔴 送出的呼叫帶 idToken、**一個 token 參數都不帶**（帶了後端就改走舊路）', async () => {
  const r = run({});
  await settle();
  const b = r.送出[0].body;
  assert.match(b, /(^|&)idToken=IDTOK(&|$)/, '沒有帶 idToken：' + b);
  assert.ok(!/(^|&)(t|token)=/.test(b), '🔴 帶了 token 參數 ⇒ 後端會改走 token 那條路：' + b);
  r.cleanup();
});

test('🔴 這一頁不自己判斷角色——原始碼裡不得出現任何角色名的字面比對', () => {
  const src = fs.readFileSync(path.join(ROOT, 'authz.html'), 'utf8');
  // 只看會執行的那一段：把區塊註解剝掉（檔頭本來就在解釋 `#97`，那是說明不是判斷）。
  const 碼 = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ['admin', 'hr', 'activity', 'hrstats', 'messaging'].forEach((role) => {
    assert.ok(碼.indexOf("'" + role + "'") < 0 && 碼.indexOf('"' + role + '"') < 0,
      '🔴 authz.html 的程式碼裡出現角色字面值「' + role + '」'
      + ' ⇒ 前端長出了第二個權限判準，而分流頁問不到那一層（gas#97 的形狀）');
  });
  // ⬛ 零點：這把尺對「真的寫了角色名」的檔會命中（否則上面是恆過）。
  const 有寫的 = fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'action-roles.json'), 'utf8');
  assert.ok(有寫的.indexOf('"admin"') >= 0, '⬛ 對照組失效：矩陣副本裡沒有 admin，換一個對照');
});

test('🔴 這一頁不自己寫一份守恆——值域與欄名都來自後端那一發，不寫死在前端', () => {
  const src = fs.readFileSync(path.join(ROOT, 'authz.html'), 'utf8');
  const 碼 = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  // 七欄的欄名只能出現在「畫面標籤」那幾處，不可以有一份寫死的表頭陣列。
  assert.ok(!/\[\s*'內部碼'\s*,/.test(碼), '🔴 前端寫死了一份表頭 ⇒ 第 ① 道在這裡變成兩份');
  assert.ok(碼.indexOf('r.header') >= 0 || 碼.indexOf('HDR = r.header') >= 0,
    '🔴 欄名不是從後端那一發拿的');
  assert.ok(碼.indexOf('r.assignableRoles') >= 0, '🔴 角色值域不是從後端拿的');
  assert.ok(碼.indexOf('r.statusValues') >= 0, '🔴 狀態值域不是從後端拿的');
});

/* ══════════════════════════════════════════════════════════════════════
 * 其餘：失敗路徑要說得出「接下來該做什麼」
 * ══════════════════════════════════════════════════════════════════════ */

test('🔴 名單現在是壞的 ⇒ 這一頁照樣打得開，而且一進來就講它壞在哪', async () => {
  const 壞 = Object.assign(名單回應(), {
    current: { pass: false, gate: '②非空', detail: '第 3 列的「角色」是空的' },
  });
  const r = run({ 回應: { getAuthzList: 壞 } });
  await settle();
  assert.match(r.els.meta.innerHTML, /②非空/, '沒有講現況壞在哪：' + r.els.meta.innerHTML);
  assert.match(r.els.meta.innerHTML, /第 3 列/);
  assert.match(r.els.list.innerHTML, /測試甲/,
    '🔴 名單壞掉時這一頁就畫不出東西 ⇒ 唯一的救法又變成回去開試算表');
  r.cleanup();
});

test('⬛ 對照：現況合法時不要喊（否則上面那條是「永遠在喊」）', async () => {
  const r = run({});
  await settle();
  assert.ok(r.els.meta.innerHTML.indexOf('沒有') < 0, '現況合法卻在喊：' + r.els.meta.innerHTML);
  assert.match(r.els.meta.innerHTML, /通過七道守恆/);
  r.cleanup();
});

test('🔴 連線失敗與「伺服器說不行」講不同的話（一個重試有用、一個永遠沒用）', async () => {
  const a = run({ transportFail: true });
  await settle();
  assert.match(a.els.who.textContent, /連不上伺服器/);
  a.cleanup();

  const b = run({ 回應: { getAuthzList: { ok: false, msg: '無權限或連結已失效。', reason: 'token_invalid' } } });
  await settle();
  assert.match(b.els.who.textContent, /無法確認您的權限/);
  assert.match(b.els.list.innerHTML, /無權限或連結已失效/);
  b.cleanup();
});

test('🔴 憑證壞掉 ⇒ 給「重新登入」鈕；權限算不出來 ⇒ 不給（重登對後者永遠沒用）', async () => {
  const a = run({ 回應: { getAuthzList: { ok: false, msg: '請重新登入', reason: 'line_bad_token' } } });
  await settle();
  assert.match(a.els.list.innerHTML, /id="relogin"/, '憑證壞掉卻沒給重新登入鈕');
  a.cleanup();

  const b = run({ 回應: { getAuthzList: { ok: false, msg: '無權限', reason: 'role_mismatch' } } });
  await settle();
  assert.ok(b.els.list.innerHTML.indexOf('relogin') < 0, '權限問題卻給了重新登入鈕（按了永遠沒用）');
  b.cleanup();
});

test('🔴 還沒登入 ⇒ 去 LINE 登入，而且一個呼叫都不發（空憑證打後端＝製造一發必定失敗）', async () => {
  const r = run({ loggedIn: false });
  await settle();
  assert.ok(r.liff.__loginArgs, '沒有去登入');
  assert.deepStrictEqual(r.送出, [], '還沒登入就發車了');
  r.cleanup();
});

test('🔴 登入了卻拿不到憑證 ⇒ 明講是後台設定問題，而且不發車', async () => {
  const r = run({ idToken: '' });
  await settle();
  assert.match(r.els.who.textContent, /拿不到登入憑證/);
  assert.match(r.els.list.innerHTML, /後台的設定問題/);
  assert.deepStrictEqual(r.送出, []);
  r.cleanup();
});

test('🔴 LIFF SDK 根本沒載進來 ⇒ 出聲，不要停在「確認身分中…」', async () => {
  const r = run({ noLiff: true });
  await settle();
  assert.match(r.els.who.textContent, /LINE 元件沒有載入/);
  r.cleanup();
});

test('🔴 名冊有重複的內部碼 ⇒ 要講（那幾位在清單裡選不到，而「選不到」與「沒有碼」處置不同）', async () => {
  const r = run({ 回應: { getAuthzList: Object.assign(名單回應(), { rosterCollisions: [丙] }) } });
  await settle();
  assert.match(r.els.foot.textContent, /重複的內部碼/, '名冊碰撞被吞掉了');
  r.cleanup();
});

test('⬛ 對照：名冊沒有碰撞時不要喊', async () => {
  const r = run({});
  await settle();
  assert.equal(r.els.foot.textContent, '');
  r.cleanup();
});

test('🔴 新增一列：沒選人就按 ⇒ 不加進草稿，而且說得出為什麼', async () => {
  const r = run({});
  await settle();
  const 之前 = r.els.list.innerHTML;
  r.els.newcode.value = '';
  r.els.add.click();
  assert.equal(r.els.list.innerHTML, 之前, '沒選人卻加了一列');
  assert.match(r.els.msg.textContent, /選一個人/);
  r.cleanup();
});

test('⬛ 對照：選了人按新增 ⇒ 真的多一列，而且狀態鈕回到「要重新檢查」', async () => {
  const r = run({ 回應: { checkAuthzDraft: { ok: true, pass: true, rowCount: 2, adminCount: 1, changes: [] } } });
  await settle();
  r.els.check.click();
  await settle();
  assert.equal(r.els.save.disabled, false, '⬛ 前置：檢查要先打開存檔鈕');
  r.els.newcode.value = 丙;
  r.els.newrole.value = 'hr';
  r.els.add.click();
  assert.match(r.els.list.innerHTML, new RegExp(丙), '新增的那一列沒有畫出來');
  assert.match(r.els.list.innerHTML, /測試丙/, '新增的那一列沒有帶姓名（要人用內部碼認人＝等於沒做）');
  assert.equal(r.els.save.disabled, true, '🔴 新增之後存檔鈕還開著 ⇒ 新的那一列從沒被驗過');
  r.cleanup();
});

/* ══════════════════════════════════════════════════════════════════════
 * `#117`：版面改成「一列一行」之後，三件會靜默壞掉的事
 *
 * ⚠️ **這三條是原始碼斷言，不是行為測試。** 上面那個假 DOM 的 `classList`
 *    與 `querySelector` 都是空殼，量不到「展開」「篩選」「日期鈕」真的做了什麼
 *    ——那一半是在真瀏覽器裡量的（`#117` 留言貼了 26 條的輸出與兩個突變）。
 *    這三條只釘住**structure**：壞掉的寫法連 diff 上都看不出有問題。
 * ⚠️ 一律先剝註解再掃——檔頭本來就在解釋這些寫法為何不可以用
 *    （`feedback_comment_is_source_code`：註解會讓自己的斷言假通過）。
 * ══════════════════════════════════════════════════════════════════════ */

/**
 * ⚠️ **取函式本體走 `helpers/source-scan.js`，不自己寫抽取式。**
 *    第一版是手寫的「找到 `function X()` 再切到下一個 function」——
 *    `tests/source-scan-tripwire.test.js` 當場把它抓出來。那支存在的理由就是
 *    這種近似抽取法會在版面一改時靜靜少取一段，而**少取跟「這頁沒有」一模一樣**。
 */
const S = require('./helpers/source-scan.js');

test('🔴 篩選／排序不可以重畫清單——重畫會抹掉使用者正在打的字', () => {
  ['套用篩選', '排列'].forEach((名) => {
    const 體 = S.stripComments(S.fnSrc(名, 'authz.html'));
    assert.ok(體.indexOf('render()') < 0,
      '🔴 ' + 名 + '() 裡呼叫了 render() ⇒ 每次篩選/排序都重畫整份清單'
      + ' ⇒ 使用者打到一半的字與勾選會被靜靜換掉（本專案為此誤發過一次訊息）。'
      + ' 篩選要用 class 切換、排序要用 appendChild 搬節點。');
    assert.ok(體.indexOf('innerHTML') < 0,
      '🔴 ' + 名 + '() 裡動了 innerHTML ⇒ 同上，那也是一次重畫');
  });
  // ⬛ 對照組：這把尺對「真的呼叫了 render()」的函式體會命中（否則上面是恆過）。
  // ⚠️ 對照組的字串裡刻意**不寫** `function` 那個字：`source-scan-tripwire` 的判準是
  //    「有沒有字串字面量含 `function␣`」，寫了它就會被判成在手寫抽取式（實測紅過一次）。
  assert.ok(S.stripComments('f(){ render(); }').indexOf('render()') >= 0,
    '⬛ 對照組失效：這把尺連明明有 render() 的碼都認不出來');
  // ⬛ 零點：這兩支真的取得到（取不到時 fnSrc 會丟例外，但零點要明說）。
  assert.ok(S.fnSrc('render', 'authz.html').length > 100, '⬛ 零點：render 取不到 ⇒ 上面兩條的定義域是空的');
});

test('🔴 停用日是一顆鈕，不是常駐的輸入框（`#117` 的 Ｄ）', () => {
  const 碼 = S.stripComments(fs.readFileSync(path.join(ROOT, 'authz.html'), 'utf8'));
  assert.ok(/data-act="date"/.test(碼),
    '🔴 找不到停用日那顆鈕 ⇒ Ｄ 沒有落地，或它的標記改名了');
  // 🔴 鈕面上要看得出已經設了哪一天——沒有這一格，「已設」與「沒設」長得一樣。
  // ⚠️ 要掃的是 `render()` **裡面**有沒有用它，不是「全檔找不找得到這個名字」：
  //    後者在「render 改掉了、但函式還定義著」時**照樣綠**（實測突變紅 0 條）。
  const 畫 = S.stripComments(S.fnSrc('render', 'authz.html'));
  assert.ok(畫.indexOf('停用日鈕(') >= 0,
    '🔴 render() 沒有用 停用日鈕() 產生鈕面的字 ⇒ 已設的日期可能沒顯示在鈕上');
  assert.ok(畫.indexOf('data-act="date"') >= 0,
    '🔴 render() 沒有畫出停用日那顆鈕');
  // 🔴 這顆鈕**不可以**碰狀態欄：`#100` 拍板「停用是改狀態不刪列」，兩件事分開。
  // 🔴 這顆鈕**不可以**碰狀態欄：`#100` 拍板「停用是改狀態不刪列」，兩件事分開。
  //    整支 `接上監聽` 都掃——只切那個 if 的前 200 字，是另一種「自己寫抽取式」，
  //    而寫法一長就靜靜少掃到（少掃跟「乾淨」一模一樣）。
  const 監聽 = S.stripComments(S.fnSrc('接上監聽', 'authz.html'));
  assert.ok(監聽.indexOf("act === 'date'") >= 0, '⬛ 零點：找不到日期鈕的處理分支');
  assert.ok(監聽.indexOf('狀態值域') < 0 && 監聽.indexOf('iStat') < 0,
    '🔴 監聽裡動到了狀態欄 ⇒ 按停用日可能變成「按了就停用」，那是另一件事');
});

test('🔴 取「這是第幾列」要往上走到底，不可以寫死巢狀層數', () => {
  const 碼 = S.stripComments(fs.readFileSync(path.join(ROOT, 'authz.html'), 'utf8'));
  assert.ok(碼.indexOf('parentNode.parentNode') < 0,
    '🔴 又出現 parentNode.parentNode ⇒ 版面一改巢狀深度就取不到 data-n，'
    + ' 而失敗的長相是「改了一格卻沒變髒」：畫面停在綠色的「七道都過」，'
    + ' 送出去的是沒有那一格的舊草稿，零錯誤訊息。');
  // ⚠️ 問**引擎**有沒有這支，不要拿字串 'function 哪一列(' 去比對原始碼：
  //    那個字串本身含 `function␣` ⇒ `source-scan-tripwire` 會把這一檔判成手寫抽取式
  //    （實測紅過一次）。而且問引擎本來就比較準——改成 `var 哪一列 = function` 也算數。
  assert.ok(S.fnNames('authz.html').indexOf('哪一列') >= 0,
    '🔴 往上走到底的那支不見了');
  // ⬛ 對照組：這把尺對真的寫死層數的碼會命中。
  assert.ok('var box = f.parentNode.parentNode;'.indexOf('parentNode.parentNode') >= 0,
    '⬛ 對照組失效');
});

/* ══════════════════════════════════════════════════════════════════════
 * 🔴 改別的欄位，不可以動到停用日那顆鈕（`#117` 驗證軌 2026-09-17 抓到的）
 *
 * ══ 這一顆為什麼躲過了所有既有的尺 ═══════════════════════════════════
 *
 * ① **行為量測看的是 `JSON.stringify(草稿)`** —— 而草稿**確實一格都沒動**，
 *    壞的是**呈現**。判準對「資料有沒有變」有鑑別力，對「畫面說了什麼」沒有。
 * ② **上面那個假 DOM 的 `querySelector` 一律回 null** ⇒ `同步同欄` 裡更新鈕面的
 *    那四行**從來沒有被執行過**。沒有被執行的碼，斷言再多也不會紅。
 * ⇒ 🔴 **是驗證軌看截圖看出來的，不是任何一條斷言喊的。**
 *
 * ══ 所以這一條刻意不用上面那個假欄位 ═══════════════════════════════════
 *
 * 它自己造一個**查得到子元素**的假列（`querySelector`／`querySelectorAll` 真的會回東西），
 * 那段碼才會真的跑到。⚠️ 加一條在假 DOM 下同樣回 null 的斷言等於什麼都沒加
 *    ——它會綠，而且永遠綠。
 *
 * ══ 為何這一格會害到人 ═════════════════════════════════════════════════
 *
 * 🔴 **不是 ISO 形狀的停用日（`2026/03/15`、`未定`），全頁只有鈕面看得到它**
 *    ——`<input type="date">` 吃不下那種值，顯示成空白。
 *    鈕面一被蓋掉，那個值在畫面上**再也顯示不出來**，而草稿裡還留著。
 *    ⇒ 使用者看到「沒設停用日」，於是去設一個——把原值覆蓋掉。**零錯誤訊息。**
 * ══════════════════════════════════════════════════════════════════════ */

/** 一個「查得到子元素」的假列：`同步同欄` 那段碼要跑得到才測得到。 */
function 假列可查(n, 欄位們, 鈕) {
  const kids = 欄位們.slice();
  const row = fakeEl('');
  row.getAttribute = (k) => (k === 'data-n' ? String(n) : null);
  row.querySelectorAll = (sel) => {
    const m = /\[data-c="(\d+)"\]/.exec(sel);
    if (!m) return [];
    return kids.filter((f) => f.getAttribute('data-c') === m[1]);
  };
  row.querySelector = (sel) => {
    if (sel === '[data-act="date"]') return 鈕;
    if (sel === '.dpop [data-c]') return null;
    const all = row.querySelectorAll(sel);
    return all.length ? all[0] : null;
  };
  kids.forEach((f) => { f.parentNode = row; });
  if (鈕) 鈕.parentNode = row;
  return row;
}

function 假格(c) {
  const f = fakeEl('');
  f.getAttribute = (k) => (k === 'data-c' ? String(c) : null);
  return f;
}

test('🔴 在備註打字，不可以把停用日那顆鈕的字蓋掉（非 ISO 值全頁只剩鈕面看得到）', async () => {
  const r = run({});
  await settle();
  const iTo = HDR.indexOf('停用日'), iNote = HDR.indexOf('備註');
  assert.ok(iTo >= 0 && iNote >= 0 && iTo !== iNote, '⬛ 零點：欄位索引取不到');

  const 原值 = '2026/03/15';                     // 刻意用**非 ISO**：全頁只有鈕面看得到它
  const 鈕 = fakeEl('');
  鈕.getAttribute = (k) => (k === 'data-act' ? 'date' : null);
  鈕.textContent = '停用日　' + 原值;
  let 有has = true;
  鈕.classList = { add: () => { 有has = true; }, remove: () => { 有has = false; },
                   toggle() {}, contains: () => 有has };

  const 備註格 = 假格(iNote);
  const 列 = 假列可查(0, [備註格, 假格(iTo)], 鈕);

  // ⬛ 零點：這個替身真的會讓那段碼跑到——先用**停用日那一欄**證明鈕面會被更新。
  const 停用日格 = 假格(iTo);
  停用日格.parentNode = 列;
  停用日格.value = '2026-12-31';
  (r.els.list.__on.input || []).forEach((fn) => fn({ target: 停用日格 }));
  assert.match(鈕.textContent, /2026-12-31/,
    '⬛ 零點失敗：改停用日那一欄時鈕面沒被更新 ⇒ 這個替身根本沒跑到那段碼，下面那條等於沒測');

  // 把鈕面放回原本那個非 ISO 值，再改**備註**。
  鈕.textContent = '停用日　' + 原值;
  有has = true;
  // ⚠️ 上面那個零點**真的**改了草稿的停用日那一格（它就是在改那一欄）。
  //    所以下面要比的是「改備註前後」，不是「跟最初的值比」——
  //    拿最初的值比會紅在一件我自己剛做的事情上（第一版就是這樣紅的）。
  const 改備註前的停用日 = r.ctx.草稿[0][iTo];
  備註格.value = '隨便打的備註';
  (r.els.list.__on.input || []).forEach((fn) => fn({ target: 備註格 }));

  assert.match(鈕.textContent, new RegExp(原值.replace(/\//g, '\\/')),
    '🔴 在備註打字把停用日那顆鈕的字蓋掉了（現在是「' + 鈕.textContent + '」）'
    + ' ⇒ 擁有者那條 Ｄ 的檢核破了；而且非 ISO 的值全頁只剩鈕面看得到，'
    + ' 蓋掉之後畫面再也顯示不出原值，使用者會以為沒設過。');
  assert.equal(有has, true,
    '🔴 在備註打字把鈕的 has 樣式拔掉了 ⇒ 「已設」與「沒設」在畫面上長得一樣');
  // 🔴 而且草稿那一格不可以被碰到——它才是存檔會送出去的東西。
  assert.equal(r.ctx.草稿[0][iTo], 改備註前的停用日,
    '🔴 備註那一發改到了停用日那一格（草稿）');
  assert.equal(r.ctx.草稿[0][iNote], '隨便打的備註', '⬛ 零點：備註那一格本來就該被寫進去');

  /* 🔴 **還要把備註「清空」再看一次——上面那一段自己擋不住一半的回歸。**
   *    （`#117` 驗證軌第二輪 2026-09-17）
   *
   * ⚠️ 上面只在備註**打字**（非空值）⇒ 走到的永遠是 `classList.add('has')`
   *    ⇒ 那句 `assert.equal(有has, true)` 在那個情境**沒有任何一條路會是 false**。
   *    它讀起來在守「has 不可以被拔掉」，實際上是**一盞永遠的綠燈**。
   * ⬛ 實測（樹外真瀏覽器那把尺抓到的）：把守門改成**只擋 `textContent`、不擋 class**——
   *      if (Number(c) === 欄('停用日')) b.textContent = 停用日鈕(值);
   *      if (值) b.classList.add('has'); else b.classList.remove('has');   // ← 沒守住
   *    ⇒ **補這一段之前，repo 全套 1254 綠、退出碼 0、紅 0 條**，而真瀏覽器紅 2 條。
   * 🔴 為什麼那一半也會害到人：`has` 被拔掉之後，「已設 2026/03/15」與「沒設」
   *    在畫面上**長得一模一樣**——那正是票上 Ｄ 明寫不可以發生的事。
   * ⇒ 清空才走得到 `remove('has')`，這一步是那條斷言唯一能是 false 的路。 */
  const 清空前的停用日 = r.ctx.草稿[0][iTo];
  備註格.value = '';
  (r.els.list.__on.input || []).forEach((fn) => fn({ target: 備註格 }));

  assert.equal(有has, true,
    '🔴 把備註清空就把停用日那顆鈕的 has 樣式拔掉了'
    + ' ⇒ 「已設 ' + 原值 + '」與「沒設」在畫面上長得一模一樣，票上 Ｄ 的檢核破了。');
  assert.match(鈕.textContent, new RegExp(原值.replace(/\//g, '\\/')),
    '🔴 把備註清空就把停用日那顆鈕的字蓋掉了（現在是「' + 鈕.textContent + '」）');
  assert.equal(r.ctx.草稿[0][iTo], 清空前的停用日,
    '🔴 清空備註那一發改到了停用日那一格（草稿）');
  assert.equal(r.ctx.草稿[0][iNote], '', '⬛ 零點：備註那一格確實被清成空字串了（這一步真的跑到）');
  r.cleanup();
});

/* ══════════════════════════════════════════════════════════════════════
 * `#60`：人員下拉按單位分組——**而且一個人都不可以少**
 *
 * 🔴 這一節守的壞法是最安靜的那種：分組寫錯時畫面上是一份**看起來完全正常**的
 *    清單，只是他要找的那個人選不到。沒有錯誤訊息、沒有紅字、數不出少了誰。
 * ⇒ 所以判準不是「有沒有 optgroup」，是**人數守恆**與**value 逐字不變**。
 *
 * ⚠️ 量的是 `#newcode` 的 innerHTML 字串本身——那正是頁面真的塞進 DOM 的東西。
 *    這個假 DOM 不會把它剖析成節點，所以下面用字串取法，**而且先證明取法有鑑別力**
 *    （零點那一條：平的清單要量得出 0 個 optgroup、分組要量得出 2 個）。
 * ══════════════════════════════════════════════════════════════════════ */

/** `#newcode` 裡每一個 `<option>`（含最前面那顆空值的「（選一個人）」）。 */
const 選項們 = (html) => [...String(html).matchAll(/<option value="([^"]*)">([^<]*)<\/option>/g)]
  .map((m) => ({ 值: m[1], 字: m[2] }));
/** 人：**排除空值那一顆**。人數守恆數的是這個。 */
const 人們 = (html) => 選項們(html).filter((o) => o.值 !== '');
/** 每一組的名字，**照它們在 innerHTML 裡出現的順序**。 */
const 組們 = (html) => [...String(html).matchAll(/<optgroup label="([^"]*)">/g)].map((m) => m[1]);

test('⬛ 零點：量法分得出「平的」與「分組的」——先證明這把尺不是永遠的綠燈', async () => {
  const 平 = run({ 回應: { getAuthzList: Object.assign(名單回應(), { rosterUnitColumn: false }) } });
  await settle();
  const 分 = run({});
  await settle();
  assert.equal(組們(平.els.newcode.innerHTML).length, 0,
    '⬛ 不分組的那一份量到了 optgroup ⇒ 取法壞掉，下面每一條都不算數');
  assert.equal(組們(分.els.newcode.innerHTML).length, 3,
    '⬛ 分組的那一份量到 ' + 組們(分.els.newcode.innerHTML).length
    + ' 組（夾具是「測試單位一×2、測試單位二×1、沒填×1」⇒ 應該是 2 個具名組 ＋ 未填那一組＝3）');
  平.cleanup(); 分.cleanup();
});

test('🔴 人數守恆：分組前後，下拉裡選得到的人數一模一樣', async () => {
  const 平 = run({ 回應: { getAuthzList: Object.assign(名單回應(), { rosterUnitColumn: false }) } });
  await settle();
  const 分 = run({});
  await settle();
  const 名冊人數 = 名單回應().roster.length;
  const a = 人們(平.els.newcode.innerHTML), b = 人們(分.els.newcode.innerHTML);
  assert.equal(a.length, 名冊人數, '⬛ 前置：平的清單本來就該有 ' + 名冊人數 + ' 個人');
  assert.equal(b.length, 名冊人數,
    '🔴 分組之後只剩 ' + b.length + ' 個人（名冊 ' + 名冊人數 + ' 個）'
    + ' ⇒ 有人在下拉裡選不到了，而畫面上看不出來。少的是：'
    + JSON.stringify(a.map((o) => o.值).filter((v) => b.every((o) => o.值 !== v))));
  assert.deepStrictEqual(b.map((o) => o.值).slice().sort(), a.map((o) => o.值).slice().sort(),
    '🔴 分組前後選得到的「那一群人」不是同一群');
  平.cleanup(); 分.cleanup();
});

test('🔴 送出的 value 一個字都不變——分組是純呈現，值仍然是內部碼', async () => {
  const r = run({});
  await settle();
  const 期望 = 名單回應().roster;
  const 得到 = 人們(r.els.newcode.innerHTML);
  期望.forEach((p) => {
    const hit = 得到.filter((o) => o.值 === p.code);
    assert.equal(hit.length, 1,
      '🔴 ' + p.code + ' 在下拉裡出現 ' + hit.length + ' 次（該是 1 次）'
      + ' ⇒ value 被動過（分組不可以改送出去的值）');
    assert.equal(hit[0].字, p.name, '🔴 ' + p.code + ' 的顯示字被換成了「' + hit[0].字 + '」');
  });
  // 反向：沒有任何一顆 option 的 value 變成單位名或姓名。
  得到.forEach((o) => {
    assert.equal(期望.some((p) => p.code === o.值), true,
      '🔴 下拉裡多出一個不在名冊裡的 value：' + JSON.stringify(o.值));
  });
  r.cleanup();
});

test('🔴 沒填部門的人不准消失——他落在「（未填部門）」那一組，而且那一組在最後', async () => {
  const r = run({});
  await settle();
  const html = r.els.newcode.innerHTML;
  const g = 組們(html);
  assert.equal(g[g.length - 1], '（未填部門）',
    '🔴 沒填部門的那一組不在最後（現在的組序是 ' + JSON.stringify(g) + '）');
  // 他真的在那一組裡面，不是被塞在別組或掉在外面。
  const 尾 = html.slice(html.lastIndexOf('<optgroup label="（未填部門）">'));
  assert.equal(人們(尾).map((o) => o.值).indexOf(丁) >= 0, true,
    '🔴 名冊部門欄空白的那個人不在「（未填部門）」組裡 ⇒ 他去哪了？'
    + ' 整份下拉是：' + html);
  r.cleanup();
});

test('🔴 分組真的發生了：同一個部門的兩個人被排在一起（就算名冊裡不相鄰）', async () => {
  const r = run({});
  await settle();
  const html = r.els.newcode.innerHTML;
  assert.deepStrictEqual(組們(html), ['測試單位一', '測試單位二', '（未填部門）'],
    '🔴 組序不是「各組第一個人在名冊裡出現的順序」＋未填那一組墊底');
  const 序 = 人們(html).map((o) => o.值);
  assert.deepStrictEqual(序, [甲, 丙, 乙, 戊, 丁],
    '🔴 分組後的人序不對。名冊原順序是 ' + JSON.stringify(名單回應().roster.map((p) => p.code))
    + ' ⇒ 沒有分組的話會是那一串（丙 沒有被搬到 甲 旁邊）');
  r.cleanup();
});

test('🔴 rosterUnitColumn:false ⇒ 退回平的清單，而且在畫面上講出來（不可以靜靜不分組）', async () => {
  const r = run({ 回應: { getAuthzList: Object.assign(名單回應(), { rosterUnitColumn: false }) } });
  await settle();
  assert.equal(組們(r.els.newcode.innerHTML).length, 0, '名冊沒有部門欄卻還是分了組');
  assert.equal(人們(r.els.newcode.innerHTML).length, 名單回應().roster.length,
    '🔴 退回平的清單的時候人少了');
  assert.match(r.els.foot.textContent, /員工名冊沒有「部門」欄/,
    '🔴 名冊沒有部門欄 ⇒ 分組不會成立，而畫面上一個字都沒講（現在是 '
    + JSON.stringify(r.els.foot.textContent) + '）');
  r.cleanup();
});

test('🔴 後端沒送 rosterUnitColumn（舊版）⇒ 也退回平的清單，但講的是另一句話', async () => {
  const 回 = 名單回應();
  delete 回.rosterUnitColumn;
  const r = run({ 回應: { getAuthzList: 回 } });
  await settle();
  assert.equal(組們(r.els.newcode.innerHTML).length, 0, '後端沒說有部門欄，這裡卻自己分了組');
  assert.match(r.els.foot.textContent, /可能還是舊版/,
    '🔴 「名冊沒有部門欄」與「後端還沒送這一格」處置不同（補欄 vs 部署），'
    + ' 畫面上要分得出來。現在是 ' + JSON.stringify(r.els.foot.textContent));
  // ⚠️ 這兩句話的差別很細，所以判準用的是**兩邊各自獨有**的片語，不是「有沒有部門兩個字」
  //    ——後者在兩句話裡都出現得到，那種寫法會是一盞永遠的燈。
  assert.equal(/員工名冊沒有「部門」欄/.test(r.els.foot.textContent), false,
    '🔴 後端沒回報，卻對他說「名冊沒有部門欄」——那是一句我們不知道的話');
  r.cleanup();
});

test('🔴 全名冊都沒填部門 ⇒ 全部落在「（未填部門）」，不是靜靜擠成一坨看不出原因', async () => {
  const 回 = 名單回應();
  回.roster = 回.roster.map((p) => ({ code: p.code, name: p.name, unit: '' }));
  const r = run({ 回應: { getAuthzList: 回 } });
  await settle();
  assert.deepStrictEqual(組們(r.els.newcode.innerHTML), ['（未填部門）'],
    '🔴 大家都沒填部門的時候，那一組要看得出是「未填」');
  assert.equal(人們(r.els.newcode.innerHTML).length, 回.roster.length, '🔴 人數守恆破了');
  r.cleanup();
});

test('🔴 部門只有空白字元 ⇒ 算沒填（不可以長出一個名字是空白的組）', async () => {
  const 回 = 名單回應();
  // ⚠️ 挑 i===1（甲，本來有部門的那個）。挑 i===0 的話他本來就沒填，這一條什麼都沒測到。
  回.roster = 回.roster.map((p, i) => ({ code: p.code, name: p.name, unit: i === 1 ? '   ' : p.unit }));
  const r = run({ 回應: { getAuthzList: 回 } });
  await settle();
  assert.equal(組們(r.els.newcode.innerHTML).indexOf('   '), -1,
    '🔴 長出了一個名字是空白的組：' + JSON.stringify(組們(r.els.newcode.innerHTML)));
  assert.equal(人們(r.els.newcode.innerHTML).length, 回.roster.length, '🔴 人數守恆破了');
  r.cleanup();
});

test('⬛ 對照：分組不會動到「角色」那個下拉（它本來就沒有組，也不該長出組）', async () => {
  const r = run({});
  await settle();
  assert.equal(組們(r.els.newrole.innerHTML).length, 0, '角色下拉被分了組');
  assert.equal(組們(r.els.fst.innerHTML).length, 0, '狀態篩選被分了組');
  assert.equal(組們(r.els.frole.innerHTML).length, 0, '角色篩選被分了組');
  r.cleanup();
});
