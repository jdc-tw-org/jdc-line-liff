/**
 * assets/liff-relogin.js 的行為測試。
 *
 * 為何存在（2026-09-13）：後端對 `line_bad_token` 說「請關掉這一頁重新開啟以重新
 * 登入」，而那在結構上是 no-op（實測見受測檔檔頭）⇒ 照做會無限迴圈。這一支把
 * 「真的重新登入一次」落地，而它本身**就是一個迴圈的形狀**，所以最重要的兩條斷言是：
 *   ① **只對「重登會有用」的那兩個代號登出**——「不管什麼代號都登出」在畫面上
 *      長得跟正確行為一模一樣（只有拿別的 reason 當對照組才分得開）。
 *   ② **第二次進來不可以再自動登出**——否則它自己就是那個迴圈。
 *
 * ⚠️ 手法沿用 tests/deny-no-role.test.js：把真的 assets/liff-relogin.js 跑進 vm，
 *    用假的 document／sessionStorage／liff 觀察副作用。**不抄一份等價的判斷來測**
 *    ——抄的那份會漂移，而漂移不報錯。
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'assets', 'liff-relogin.js'), 'utf8');

/**
 * 跑一次（或多次）`reloginOnDeadCredential`，回報所有副作用。
 *
 * @param {object} opt
 *   `store`      'ok'｜'throwWrite'｜'throwRead'｜'seeded'（旗標已存在＝上次已試過）
 *   `liff`       'ok'｜'missing'｜'noLogout'
 *   `responses`  依序餵進去的回應
 */
function run(opt) {
  opt = opt || {};
  const calls = { logout: 0, login: [], appended: [] };
  const mem = new Map();
  if (opt.store === 'seeded') mem.set('JDC_RELOGIN_TRIED', '1');
  const sessionStorage = {
    getItem(k) {
      if (opt.store === 'throwRead') throw new Error('SecurityError');
      return mem.has(k) ? mem.get(k) : null;
    },
    setItem(k, v) {
      if (opt.store === 'throwWrite') throw new Error('QuotaExceededError');
      mem.set(k, v);
    },
  };
  const liff = opt.liff === 'missing' ? undefined
    : opt.liff === 'noLogout' ? { login: () => {} }
      : { logout() { calls.logout += 1; }, login(o) { calls.login.push(o); } };
  const ctx = {
    window: { liff },
    sessionStorage,
    location: { href: 'https://campaign.jdc-corpn.com.tw/board.html?mt=1' },
    document: {
      createElement: () => {
        const el = { _attrs: {}, _html: '', setAttribute(k, v) { this._attrs[k] = v; },
          set innerHTML(v) { this._html = v; }, get innerHTML() { return this._html; } };
        return el;
      },
      body: { appendChild(el) { calls.appended.push(el.innerHTML); } },
    },
  };
  ctx.liff = liff;                       // 受測檔用裸 `liff` 也用 `window.liff`
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx, { filename: 'liff-relogin.js' });
  const fn = vm.runInContext('reloginOnDeadCredential', ctx);
  const returned = (opt.responses || []).map((r) => fn(r));
  return { calls, returned, flag: mem.get('JDC_RELOGIN_TRIED') || null, ctx };
}

const BAD = { ok: false, reason: 'line_bad_token', msg: '（後端那句）' };
const NO = { ok: false, reason: 'line_no_token', msg: '（後端那句）' };

/** 受測檔匯出的常數（給結構斷言用）。 */
const MOD = require(path.join(ROOT, 'assets', 'liff-relogin.js'));

/* ══ ① 該登出的那兩個代號 ═══════════════════════════════════════════════ */

test('line_bad_token 第一次 → 真的 logout 再 login（帶 redirectUri 回原網址）', () => {
  const r = run({ responses: [BAD] });
  assert.equal(r.calls.logout, 1, '沒有 logout ⇒ SDK 不會移除那顆過期的 ID token');
  assert.equal(r.calls.login.length, 1, '沒有 login ⇒ 他被登出之後卡在沒有身分的畫面');
  assert.equal(r.calls.login[0].redirectUri,
    'https://campaign.jdc-corpn.com.tw/board.html?mt=1',
    'redirectUri 沒帶原網址 ⇒ 登入後回不到他本來要看的那一頁（?mt= 等參數會掉）');
  assert.equal(r.flag, '1', '旗標沒寫入 ⇒ 下一輪還會再自動登出一次＝迴圈');
});

test('line_no_token 第一次 → 也要 logout＋login（它與 bad_token 同一類處置）', () => {
  const r = run({ responses: [NO] });
  assert.equal(r.calls.logout, 1);
  assert.equal(r.calls.login.length, 1);
});

/* ══ ② 🔴 對照組：不是那兩個代號就**不可以**登出 ═════════════════════════
 *
 * 這一組是「只對正確代號登出」與「不管什麼代號都登出」唯一分得開的地方。
 * 少了它，把 RELOGIN_REASONS 換成「全部」也會全綠。
 */
for (const [name, resp] of [
  ['role_mismatch（拿錯連結，重登沒用）', { ok: false, reason: 'role_mismatch', msg: 'x' }],
  ['role_unresolved（算不出角色，重登沒用）', { ok: false, reason: 'role_unresolved', msg: 'x' }],
  ['line_unbound（沒綁定，重登只會再失敗一次）', { ok: false, reason: 'line_unbound', msg: 'x' }],
  ['line_ambiguous（資料異常，重登沒用）', { ok: false, reason: 'line_ambiguous', msg: 'x' }],
  ['line_upstream（我們壞了，重登沒用）', { ok: false, reason: 'line_upstream', msg: 'x' }],
  ['line_needs_sheet（退路啟動，重登沒用）', { ok: false, reason: 'line_needs_sheet', msg: 'x' }],
  ['token_invalid（舊路的 token，跟 LINE 登入無關）', { ok: false, reason: 'token_invalid', msg: 'x' }],
  ['完全沒有 reason（後端外層 catch）', { ok: false, msg: 'x' }],
  ['連線失敗（本頁自己 catch 出來的）', { ok: false, msg: '連線失敗' }],
  ['ok:true（成功）', { ok: true, rows: [] }],
]) {
  test(`⬛對照 ${name} → 一次都不可以登出`, () => {
    const r = run({ responses: [resp] });
    assert.equal(r.calls.logout, 0, '對這個代號登出＝把人多趕一趟，而重登不會有幫助');
    assert.equal(r.calls.login.length, 0);
    assert.equal(r.calls.appended.length, 0, '不該蓋任何東西上去');
    assert.equal(r.flag, null, '不該燒掉那一次機會');
  });
}

/* ══ ③ 🔴 無窮迴圈那一格 ═══════════════════════════════════════════════ */

test('🔴 第二次進來（旗標已在）→ **不再**自動登出，改說「請聯絡資訊人員」', () => {
  const r = run({ store: 'seeded', responses: [BAD] });
  assert.equal(r.calls.logout, 0, '第二次還登出＝這一支自己就是那個無窮迴圈');
  assert.equal(r.calls.login.length, 0);
  assert.equal(r.calls.appended.length, 1, '什麼都沒說＝他看著一個壞掉的畫面猜');
  assert.match(r.calls.appended[0], /請聯絡資訊人員/);
});

test('🔴 同一次造訪內連兩發：第一發登出，第二發（重新載入後）就不再登出', () => {
  // 第一發在這個 context 內寫下旗標；模擬導頁回來後的新頁面＝同一份 sessionStorage。
  const first = run({ responses: [BAD] });
  assert.equal(first.calls.logout, 1);
  const second = run({ store: 'seeded', responses: [BAD] });
  assert.equal(second.calls.logout, 0, '旗標沒有攔住第二輪 ⇒ 登入/登出會一直來回');
});

/* ══ ④ 並行：一頁首載會同時打好幾支 action ═══════════════════════════════ */

test('同一頁三支 action 幾乎同時回 line_bad_token → 只登出一次', () => {
  const r = run({ responses: [BAD, BAD, BAD] });
  assert.equal(r.calls.logout, 1, '連呼 logout/login ⇒ 導頁被打斷或重複轉址');
  assert.equal(r.calls.login.length, 1);
});

/* ══ ⑤ 旗標拿不到時的方向：寧可不登出 ═══════════════════════════════════ */

test('🔴 旗標寫不進去（無痕/封鎖 storage）→ 不登出，說實話', () => {
  const r = run({ store: 'throwWrite', responses: [BAD] });
  assert.equal(r.calls.logout, 0, '沒有防線還登出＝無限迴圈，而那是這次要修的東西本身');
  assert.equal(r.calls.appended.length, 1);
  assert.match(r.calls.appended[0], /請聯絡資訊人員/);
});

test('🔴 旗標讀不到（getItem 拋）→ 當成「已經試過」，不登出', () => {
  const r = run({ store: 'throwRead', responses: [BAD] });
  assert.equal(r.calls.logout, 0);
  assert.equal(r.calls.appended.length, 1);
  assert.match(r.calls.appended[0], /請聯絡資訊人員/);
});

/* ══ ⑥ SDK 不在時不可以炸掉整頁 ═════════════════════════════════════════ */

for (const [name, liff] of [['liff 整個不在', 'missing'], ['liff.logout 不是函式', 'noLogout']]) {
  test(`${name} → 不拋錯、不登出、講一句話`, () => {
    const r = run({ liff, responses: [BAD] });
    assert.equal(r.calls.logout, 0);
    assert.equal(r.calls.appended.length, 1);
    assert.equal(r.flag, null, 'SDK 不在就不該燒掉那一次機會');
  });
}

/* ══ ⑦ 不吃掉別人的回應 ═══════════════════════════════════════════════ */

test('回傳值原樣交還 ⇒ 各頁的失敗畫面與 board-cache 的判讀一個都不少', () => {
  const r = run({ responses: [BAD] });
  assert.strictEqual(r.returned[0], BAD, '換掉了回應物件 ⇒ 下游拿到的不是後端說的那一份');
});

/* ══ ⑧ 結構斷言 ═══════════════════════════════════════════════════════ */

test('🔴 旗標鍵不可以用 `LIFF_STORE:` 開頭——liff.logout() 會把那個前綴洗掉', () => {
  assert.ok(MOD.RELOGIN_FLAG_KEY.indexOf('LIFF_STORE') !== 0,
    '旗標與 SDK 共用前綴 ⇒ logout() 會順手刪掉防迴圈的旗標，而症狀就是無限迴圈');
});

test('🔴 跨 repo 對齊：會觸發重新登入的代號**恰好**是後端「重登會有用」那兩個', () => {
  assert.deepEqual(MOD.RELOGIN_REASONS.slice().sort(),
    ['line_bad_token', 'line_no_token'],
    '多一個＝對重登沒用的人也被趕去重登；少一個＝那一種人留在死巷裡');
});

test('文案不可以再叫人「關掉這一頁重新開啟」——那正是這次要修掉的 no-op', () => {
  assert.ok(MOD.RELOGIN_EXHAUSTED_MSG.indexOf('關掉這一頁重新開啟') === -1);
  assert.ok(MOD.RELOGIN_GOING_MSG.indexOf('關掉這一頁重新開啟') === -1);
});

/* ══ ⑨ 兩頁真的掛上了、也真的接在解析出口上 ═══════════════════════════════
 *
 * ⚠️ 判斷正確但**沒有人呼叫它**，與判斷錯掉的差別在畫面上看不出來
 *    （兩者都是「什麼都沒發生」）。
 */
for (const page of ['board.html', 'hr-stats.html']) {
  test(`${page} 有載入 liff-relogin.js，且掛在 jsonp 的解析出口上`, () => {
    const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
    assert.match(html, /<script src="assets\/liff-relogin\.js"><\/script>/,
      '沒載入 ⇒ reloginOnDeadCredential 是 undefined，每一支呼叫都會 ReferenceError');
    assert.match(html, /reloginOnDeadCredential\(denyNoRole\(JSON\.parse/,
      '沒接在解析出口 ⇒ 只有某幾個呼叫點會被涵蓋，而漏掉的那些是靜默的');
  });
}
