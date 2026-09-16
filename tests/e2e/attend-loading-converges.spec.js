/**
 * #102 —— `attend.html` 的「載入中…」一定會收斂。
 *
 * 🔴 **為何非在真瀏覽器不可**：這一票的病灶是**沒有人接的 promise rejection**。
 *    它在 node 的單元測試裡不存在（那裡沒有那條鏈、也沒有 DOM），而在瀏覽器裡
 *    它**不會讓任何測試變紅**——畫面停著、console 有一行、退出碼 0。
 *    唯一問得出來的方式是開頁、等、看畫面上那一格寫著什麼。
 *
 * ⚠️ 手法照 `attend-checkin-e1b.spec.js`：擋掉真的 LIFF SDK、在頁面 script 之前放替身、
 *    `page.route()` 一律在 `goto()` 之前（儀器早於事件）。
 *
 * 🔴 **兩道防線各有自己的殺手案例，刻意不重疊**（memory feedback_overlapping_guards_untested：
 *    互相覆蓋的防護等於沒人守）：
 *      ① `.catch(chainFailed(...))` —— 殺手案例＝零點①（鏈上拋例外）。拿掉它，零點①在
 *         監看器響之前的那段時間裡是全白的。
 *      ② 監看器（`armLoadGuard`）    —— 殺手案例＝零點②（鏈既不 resolve 也不 reject）。
 *         ①對這一種完全無效，因為根本沒有 rejection 可接。
 *    每一道都各有一條突變測試證明「只有它擋得住」。
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const ATTEND_SRC = fs.readFileSync(path.join(ROOT, 'attend.html'), 'utf8');

/** 監看器的秒數以原始碼為準，測試不自己寫死一個會漂移的數字。 */
const GUARD_MS = Number(/var LOAD_GUARD_MS=(\d+);/.exec(ATTEND_SRC)[1]);

async function blockLiffCdn(page) {
  await page.route(/static\.line-scdn\.net/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
}

function liffStub() {
  return `window.liff = {
    init: function(){ return Promise.resolve(); },
    isLoggedIn: function(){ return true; },
    getIDToken: function(){ return 'IDTOK'; },
    getDecodedIDToken: function(){ return { sub: 'U_sub_1' }; },
    login: function(o){ window.__liffLoginCalled = (o && o.redirectUri) || 1; },
    logout: function(){}, closeWindow: function(){}, openWindow: function(){},
    getOS: function(){ return 'ios'; }, isInClient: function(){ return true; },
    getVersion: function(){ return '2.0.0'; }
  };`;
}

/**
 * 開 attend.html。
 * @param {object} o
 * @param {(u:URL)=>any} o.reply      回 '__HANG__' ＝故意不回應
 * @param {(html:string)=>string} [o.mutate]  突變：改寫送出去的 attend.html
 * @param {boolean} [o.noStatsView]   true ＝ stats-view.js 不載入（對照組②）
 * @param {string}  [o.inject]    等畫面**先安定下來**之後才執行的一段程式
 *   （模擬「有人在這頁加了一條新的載入路徑」。太早注入會被首載的 paint() 蓋掉，
 *    那樣測到的是首載、不是那條新路徑——2026-09-16 第一版就是這樣紅的。）
 * @param {number}  [o.injectWaitMs] 注入之後再等多久
 */
async function open(page, { reply = () => ({ ok: true }), mutate = null, noStatsView = false,
                            inject = '', injectWaitMs = 0, waitMs = 2000 } = {}) {
  const logs = [];
  const sent = [];
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  await blockLiffCdn(page);
  await page.addInitScript(liffStub());
  if (mutate) {
    await page.route(/\/attend\.html(\?|$)/, (route) =>
      route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: mutate(ATTEND_SRC) }));
  }
  if (noStatsView) {
    await page.route(/assets\/stats-view\.js/, (route) =>
      route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: '' }));
  }
  await page.route(/script\.google\.com/, async (route) => {
    const u = new URL(route.request().url());
    sent.push(u.search);
    const body = reply(u);
    if (body === '__HANG__') return;
    await route.fulfill({ status: 200, contentType: 'application/javascript',
      body: 'cb(' + JSON.stringify(body) + ')' });
  });
  await page.goto('/attend.html');
  await page.waitForTimeout(waitMs);
  if (inject) { await page.evaluate(inject); await page.waitForTimeout(injectWaitMs); }
  return { logs, sent };
}

/** 畫面上實際看得見的字（含撤銷覆蓋層）。 */
async function visibleText(page) {
  return (await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('body *').forEach((el) => {
      if (el.children.length) return;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return;
      const t = (el.textContent || '').trim();
      if (t) out.push(t);
    });
    return out;
  })).join(' ⏎ ');
}

/** 兩個資料區的字。回報單說的「下方兩個資料區」就是這兩格。 */
const regions = (page) => page.evaluate(() => ({
  meta: (document.getElementById('meta').textContent || '').trim(),
  content: (document.getElementById('content').textContent || '').trim(),
  placeholderStillThere: !!document.getElementById('load-ph'),
  picker: (function () {
    const s = document.getElementById('act-picker');
    const o = s.options[s.selectedIndex];
    return { shown: getComputedStyle(s).display !== 'none', text: o ? o.textContent : '' };
  })(),
}));

/* ══ 線上那一場的形狀（回報單 2026-09-16）══════════════════════════════════
 * 已關閉、回覆 151。全部活動皆關閉 ⇒ batch 裡帶 act='' 的那支撲空，
 * 前端退回用清單挑最新一場再問一次 ⇒ 走的是 load() 那條鏈。 */
const ROWS = [{ id: 'A9', name: '年度聚餐', status: '關閉', open: false, replies: 151 }];
const NO_OPEN = { ok: false, msg: '目前沒有開放中的活動。' };
const STATS = {
  ok: true, who: 'admin',
  activity: { id: 'A9', name: '年度聚餐', status: '關閉', eventDate: '2026/07/10', deadlineText: '2026/06/30' },
  counts: { attend: 120, absent: 31, boundNoReply: 3, notBound: 2, total: 156, replied: 151, meat: 100, veg: 20 },
  opinions: [], absentList: [], boundNoReply: [], notBound: [],
};
const EMPTY_STATS = {
  ok: true, who: 'admin',
  activity: { id: 'A9', name: '年度聚餐', status: '關閉', eventDate: '2026/07/10', deadlineText: '2026/06/30' },
  counts: { attend: 0, absent: 0, boundNoReply: 0, notBound: 0, total: 0, replied: 0, meat: 0, veg: 0 },
  opinions: [], absentList: [], boundNoReply: [], notBound: [],
};
/** 🔴 零點①的回應：ok:true，但少了 `counts` ⇒ renderStatsHtml 讀 undefined.boundNoReply 而拋。 */
const SHAPE_DRIFT = { ok: true, who: 'admin', activity: { id: 'A9', name: '年度聚餐', status: '關閉' } };

const batchThen = (second) => (u) => (u.searchParams.get('action') === 'batch'
  ? { ok: true, results: { listActivities: { ok: true, rows: ROWS }, getActivityStats: NO_OPEN } }
  : second(u));

/** 突變：把新加的收斂拿掉。**一定要驗替換真的發生了**，否則突變是空包彈、測試永遠綠。 */
function strip(html, needle, replacement, label) {
  const n = html.split(needle).length - 1;
  if (!n) throw new Error('突變沒有生效（找不到 ' + label + '）：這一條測試什麼都沒測到');
  return html.split(needle).join(replacement);
}
const killCatch = (html) => {
  const n = (html.match(/\.catch\(chainFailed\('[^']+'\)\)/g) || []).length;
  if (n < 4) throw new Error('突變沒有生效：只找到 ' + n + ' 個 chainFailed 掛點');
  return html.replace(/\.catch\(chainFailed\('[^']+'\)\)/g, '');
};
const killGuard = (html) => strip(html, '},LOAD_GUARD_MS);', '},2147483647);', '監看器的秒數');

/* ══ 🔴 零點① —— 鏈上拋例外 ══════════════════════════════════════════════ */

test('🔴 零點①（突變：拿掉 .catch）→ 回報單的畫面重現：選單有、兩區永遠「載入中…」、零錯誤訊息', async ({ page }) => {
  const { logs } = await open(page, { reply: batchThen(() => SHAPE_DRIFT), mutate: killCatch });
  const r = await regions(page);
  console.log('【零點①·突變後】區塊：', JSON.stringify(r));
  console.log('【零點①·突變後】看得見：', await visibleText(page));
  // 選單選得到那一場——第一段資料有回來（回報單原文）
  expect(r.picker.text).toBe('年度聚餐（已關閉・回覆 151）');
  // 下方兩區停在「載入中…」，而且沒有資料、沒有空狀態、沒有錯誤訊息
  expect(r.meta).toBe('載入中…');
  expect(r.content).toBe('載入中…');
  expect(r.placeholderStillThere).toBe(true);
  // 🔴 而畫面上「什麼都沒說」正是這一票最惡的地方：唯一的痕跡在 console 裡
  expect(logs.filter((l) => l.startsWith('[pageerror]')).length).toBeGreaterThan(0);
});

test('零點①（現行碼）→ 收斂成一句講得出來的話，「載入中…」不留在畫面上', async ({ page }) => {
  await open(page, { reply: batchThen(() => SHAPE_DRIFT) });
  const r = await regions(page);
  console.log('【零點①·修好後】區塊：', JSON.stringify(r));
  expect(r.placeholderStillThere, '佔位還在＝沒收斂').toBe(false);
  expect(r.content).toContain('載入時發生錯誤');
  expect(r.content, '紅字下面還寫著「載入中」，那句是假話').not.toContain('載入中…');
});

/* ══ 🔴 零點② —— 鏈既不 resolve 也不 reject（.catch 對這一種無效）══════════ */

const FORGOT_TO_SETTLE = 'beginLoading();';   // 新載入路徑：佔了位，然後什麼都沒做

test('🔴 零點②（突變：關掉監看器）→ 有人加了新載入路徑卻忘了收斂 ⇒ 永遠「載入中…」', async ({ page }) => {
  test.setTimeout(GUARD_MS + 40000);
  await open(page, { reply: batchThen(() => STATS), mutate: killGuard,
    inject: FORGOT_TO_SETTLE, injectWaitMs: GUARD_MS + 4000 });
  const r = await regions(page);
  console.log('【零點②·突變後】區塊：', JSON.stringify(r));
  expect(r.placeholderStillThere).toBe(true);
  expect(r.content).toBe('載入中…');
});

test('零點②（現行碼）→ 監看器把它講出來（.catch 這一道對它完全無效）', async ({ page }) => {
  test.setTimeout(GUARD_MS + 40000);
  await open(page, { reply: batchThen(() => STATS),
    inject: FORGOT_TO_SETTLE, injectWaitMs: GUARD_MS + 4000 });
  const r = await regions(page);
  console.log('【零點②·修好後】區塊：', JSON.stringify(r));
  expect(r.placeholderStillThere).toBe(false);
  expect(r.content).toContain('資料一直沒有回來');
});

/* ══ 對照組① —— 四種結局的畫面都分得出來 ════════════════════════════════ */

const OUTCOMES = [
  ['有資料', batchThen(() => STATS)],
  ['空資料', batchThen(() => EMPTY_STATS)],
  ['無權限', batchThen(() => ({ ok: false, msg: '無權限或連結已失效。', reason: 'token_invalid' }))],
  ['連線失敗', batchThen(() => ({ ok: false, msg: '連線失敗，請重新整理。' }))],
];

/**
 * ⚠️ **四種結局一定要各用一個全新的 context。** 同一個 page 連跑四次的話，
 *    本頁的持久快取（localStorage，同源）會留到下一次——2026-09-16 第一版就是這樣：
 *    「空資料」那次存進去的 0，被「無權限」那次當成秒開快取畫出來，
 *    於是無權限的畫面上出現一整張全 0 的統計卡。**四格畫面看起來都不一樣，
 *    但差異來自上一格的殘留，不是來自這一格的結局。**
 */
test('對照組①：有資料／空資料／無權限／連線失敗——四種畫面兩兩都不一樣', async ({ browser }) => {
  const seen = {};
  for (const [tag, reply] of OUTCOMES) {
    const ctx = await browser.newContext({ baseURL: test.info().project.use.baseURL });
    const p = await ctx.newPage();
    await open(p, { reply });
    const r = await regions(p);
    seen[tag] = { visible: await visibleText(p), content: r.content, ph: r.placeholderStillThere };
    console.log('【對照組① ' + tag + '】', JSON.stringify(seen[tag].visible).slice(0, 260));
    expect(r.placeholderStillThere, tag + '：還停在「載入中…」').toBe(false);
    await ctx.close();
  }
  const keys = Object.keys(seen);
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      expect(seen[keys[i]].visible,
        keys[i] + ' 與 ' + keys[j] + ' 的畫面長一樣＝這一格沒過').not.toBe(seen[keys[j]].visible);
    }
  }
});

/* ══ 對照組② —— 7/31 的舊路仍然走同一個 fatal()，訊息一字不變 ══════════════ */

const OLD_FATAL = '頁面元件載入失敗，請重新整理。若從主畫面圖示開啟仍不行，請改用 Safari 開一次連結。';

test('對照組②：stats-view.js 沒載進來 → 仍然是同一個 fatal()，那句話一字不變', async ({ page }) => {
  expect(ATTEND_SRC, '原始碼裡的那句話被改動過了').toContain(OLD_FATAL);
  await open(page, { reply: batchThen(() => STATS), noStatsView: true });
  const r = await regions(page);
  console.log('【對照組②】區塊：', JSON.stringify(r));
  expect(r.content).toBe(OLD_FATAL);
  expect(r.placeholderStillThere).toBe(false);
});

/* ══ 沒壞掉的那條：正常情況照舊 ════════════════════════════════════════ */

test('回歸：全部活動已關閉、第二發成功 → 統計照樣畫出來（監看器不誤傷）', async ({ page }) => {
  const { logs, sent } = await open(page, { reply: batchThen(() => STATS) });
  const txt = await visibleText(page);
  expect(txt).toContain('年度聚餐');
  expect(txt).toContain('（admin）');
  expect(txt).not.toContain('載入中…');
  expect(sent.length).toBe(2);
  expect(logs.filter((l) => l.startsWith('[pageerror]'))).toEqual([]);
});
