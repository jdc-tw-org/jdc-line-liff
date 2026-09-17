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
const 甲 = 'JDC-BBBBBB', 乙 = 'JDC-CCCCCC', 丙 = 'JDC-DDDDDD';
const 名單回應 = () => ({
  ok: true, who: '測試甲', header: HDR.slice(),
  rows: [
    [甲, 'admin', '有效', '2026-09-01', '', '', '測試甲'],
    [乙, 'hr', '有效', '2026-09-01', '', '', '測試乙'],
  ],
  roster: [{ code: 甲, name: '測試甲' }, { code: 乙, name: '測試乙' }, { code: 丙, name: '測試丙' }],
  rosterCollisions: [],
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
