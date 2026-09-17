/**
 * #102／#111／#119 —— `attend.html` 的「載入中…」一定會收斂。
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
 *      ② 監看器（`armLoadGuard`）    —— 殺手案例＝零點②、零點③（鏈既不 resolve 也不 reject）。
 *         ①對這一種完全無效，因為根本沒有 rejection 可接。
 *    每一道都各有一條突變測試證明「只有它擋得住」。
 *
 * 🔴 **②那一道有三個呼叫點（兩處上發條＋一處拆發條），所以它需要三個案例**
 *    （#111 補了一個、#119 補完剩下兩個）。`armLoadGuard()` 內含 `clearTimeout` 再
 *    `setTimeout` ⇒ **全頁只有一顆計時器**，三處互相覆蓋 ⇒ 隨便怎麼突變都不會紅。
 *    有鑑別力的案例只能靠**時間點與路徑**構造：
 *      `:133` 開頁那一發  —— 零點②（t≈2 秒注入，此時它還沒燒掉）
 *                            ＋ **零點④**（首載整批沒發車 ⇒ 其餘兩處都碰不到）
 *      `:112` `beginLoading()` 裡那一發 —— **零點③**（先等它燒掉，再讓下一輪卡住）
 *      `:217` `startAuth()` 裡的拆發條  —— **零點⑤**（導頁後等過時限，那句話必須還在）
 *    在 #111 之前只有 `:133` 被涵蓋到；#111 之後 `:133`／`:217` 各自整行刪掉，
 *    整套 e2e 仍然 167/167 全綠、exit=0（2026-09-17 在 `afbf75c` 上實測，
 *    `attend.html` md5 4fd0167→3cdac2f／→0eb10f1；`:112` 那一刀是 →630dc9f）。
 *    ⇒ **同一道防線的每一個呼叫點各自要有案例**；條數不是判準，位置才是。
 *
 * 🔴 **儀器必須活過被測事件**（#119 的真正教訓）：`:217` 曾被說成有「間接涵蓋」，
 *    因為 `attend-checkin-e1b.spec.js` 驗過「正在前往 LINE 登入…」那句話——但它
 *    **t≈1.7 秒**就收工，而那一發 **t≈25 秒**才會蓋掉那句話。
 *    ⇒ 本檔每一條長案例都用 `expectOutlivedGuard()` 直接問頁面自己的時鐘。
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
 * @param {string}  [o.liff]  LIFF 替身的原始碼（預設＝正常登入的那一份）。
 *   零點④⑤ 要換掉它：一個讓 `liff.init()` 永遠不 settle，一個讓 `isLoggedIn()` 回 false。
 */
async function open(page, { reply = () => ({ ok: true }), mutate = null, noStatsView = false,
                            inject = '', injectWaitMs = 0, waitMs = 2000,
                            liff = liffStub() } = {}) {
  const logs = [];
  const sent = [];
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  await blockLiffCdn(page);
  await page.addInitScript(liff);
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

/* ══ 🔴 零點③ —— 首載成功、開頁那一發燒掉之後，才有一輪卡住 ═══════════════
 *
 * #111：`armLoadGuard` 有兩個呼叫點，而零點②只擋得住**開頁那一發**（`:133`）。
 *
 * 🔴 **時間點就是這一條的全部**。一定要先等過 `LOAD_GUARD_MS`，讓開頁那一發燒掉
 *    （燒的時候畫面已經畫好 ⇒ 它什麼都不做、也不留任何痕跡），**之後**才讓下一輪卡住。
 *    早一秒，擋住它的就是開頁那一發，這一條就什麼都沒測到——那正是 #102 的漏洞。
 *
 * 卡住的方式用真的那一種：**佇列頭卡住**（`attend.html` 檔頭列的「佇列前面那支卡住」）。
 * `queueRead` 的工作排在 `GAS_TAIL` 後面，前面那支永遠不完成 ⇒ `load()` 這條鏈
 * **既不 resolve 也不 reject** ⇒ `.catch(chainFailed('切換活動'))` 對它完全無效，
 * 唯一擋得住的就是 `beginLoading()` 裡那一發。附帶：這一輪**一個請求都沒送出去**。
 *
 * ⚠️ 代價：兩段等待各一個 `LOAD_GUARD_MS`，單條約 55 秒。這是量一個 25 秒計時器的底價。
 *    **不要把 `LOAD_GUARD_MS` 改小來換速度**——那會變成在測一個線上不存在的設定。
 * ⚠️ 切過去的那一場**必須沒有快取**（本輪是同一個 context 裡第一次看 A8）。
 *    命中快取的話 `paint(cached)` 會把佔位換掉，監看器的述詞就永遠不成立，
 *    這一條會變成「怎麼改都綠」。
 */

/** 兩場活動。都已關閉 ⇒ `pickDefaultActivity` 挑最後一筆（A9），選單可以切到 A8。 */
const TWO_ROWS = [
  { id: 'A8', name: '春酒', status: '關閉', open: false, replies: 88 },
  { id: 'A9', name: '年度聚餐', status: '關閉', open: false, replies: 151 },
];
const batchRowsThen = (rows, second) => (u) => (u.searchParams.get('action') === 'batch'
  ? { ok: true, results: { listActivities: { ok: true, rows: rows }, getActivityStats: NO_OPEN } }
  : second(u));

/** 突變：只刪 `beginLoading()` 裡那一發。開頁那一發沒有縮排，不會被誤傷。 */
const killArmInBeginLoading = (html) => {
  const needle = '\n  armLoadGuard();\n';
  const n = html.split(needle).length - 1;
  if (n !== 1) throw new Error('突變沒有生效：`beginLoading()` 裡那一發找到 ' + n + ' 處（預期 1）'
    + '——這一條測試什麼都沒測到');
  return html.split(needle).join('\n');
};

/** 佇列頭卡住＝下一支 `queueRead` 的工作永遠不會被呼叫。
 *  ⚠️ 一定要寫成「不回傳那個 Promise」的函式。寫成字串運算式的話 `page.evaluate`
 *     會把那個永不 settle 的 Promise 當回傳值去等，卡住的變成測試本身。 */
const STALL_QUEUE = () => { window.GAS_TAIL = new Promise(function () {}); };

/** 首載成功 → 等過發條時限 → 切換活動且該輪卡住。回傳最後的畫面。 */
async function firstLoadThenStuckSwitch(page, { mutate = null } = {}) {
  const { sent } = await open(page, { reply: batchRowsThen(TWO_ROWS, () => STATS), mutate, waitMs: 3000 });
  const afterFirst = await regions(page);
  expect(afterFirst.placeholderStillThere,
    '首載就沒畫出來 ⇒ 後面測到的不是「發條燒掉之後」那一段').toBe(false);
  const first = await page.evaluate(() => document.getElementById('act-picker').value);

  // ① 等過開頁那一發的時限，讓它燒掉。畫面已經畫好，所以它應該什麼都不說。
  await page.waitForTimeout(GUARD_MS + 3000);
  const afterBurn = await regions(page);
  expect(afterBurn.content,
    '畫面已經畫好，開頁那一發卻仍然開口＝誤傷').not.toContain('資料一直沒有回來');

  // ② 佇列頭卡住，然後用選單切到另一場（那一場在這個 context 裡沒有快取）
  await page.evaluate(STALL_QUEUE);
  const sentBefore = sent.length;
  const other = TWO_ROWS.map((r) => r.id).filter((id) => id !== first)[0];
  await page.selectOption('#act-picker', other);
  await page.waitForTimeout(2000);
  const during = await regions(page);
  expect(during.placeholderStillThere,
    '切換活動沒有回到「載入中…」＝這一輪根本沒開始，這一條測不到東西').toBe(true);
  expect(sent.length,
    '卡住的那一輪居然送出了請求＝佇列頭沒卡住，這一條測到的是別的東西').toBe(sentBefore);

  // ③ 再等過一個時限。現行碼會在這裡講話，突變之後永遠不會。
  await page.waitForTimeout(GUARD_MS + 5000);
  return { r: await regions(page), sent, sentBefore, first, other };
}

test('🔴 零點③（突變：拿掉 beginLoading() 裡那一發）→ 開頁那一發燒掉後切換活動卡住 ⇒ 回到「永遠載入中」', async ({ page }) => {
  test.setTimeout(2 * GUARD_MS + 70000);
  const { r, sent, sentBefore, other } = await firstLoadThenStuckSwitch(page, { mutate: killArmInBeginLoading });
  console.log('【零點③·突變後】切到 ' + other + '，區塊：', JSON.stringify(r));
  console.log('【零點③·突變後】看得見：', await visibleText(page));
  expect(r.placeholderStillThere).toBe(true);
  expect(r.content).toBe('載入中…');
  expect(sent.length, '全程零外部請求：卡住的那一輪一個都沒送出去').toBe(sentBefore);
});

test('零點③（現行碼）→ 切換活動那一輪卡住，beginLoading() 裡那一發把它講出來', async ({ page }) => {
  test.setTimeout(2 * GUARD_MS + 70000);
  const { r, sent, sentBefore, other } = await firstLoadThenStuckSwitch(page);
  console.log('【零點③·修好後】切到 ' + other + '，區塊：', JSON.stringify(r));
  expect(r.placeholderStillThere,
    '「切換活動」這條路沒收斂：開頁那一發已經燒掉，只剩 beginLoading() 裡那一發擋得住它').toBe(false);
  expect(r.content,
    '「切換活動」那一輪既不 resolve 也不 reject，而畫面上一句話都沒有').toContain('資料一直沒有回來');
  expect(r.content, '紅字下面還寫著「載入中」，那句是假話').not.toContain('載入中…');
  expect(sent.length, '全程零外部請求：卡住的那一輪一個都沒送出去').toBe(sentBefore);
});

/* ══ 🔴 零點④⑤ 共用的零件 ═══════════════════════════════════════════════
 *
 * #119：碰得到這顆計時器的地方有三處，#111 之後只有 `:112` 被釘住。
 * 另外兩處在 `afbf75c` 上實測**零涵蓋**——各自整行刪掉，整套 e2e 167 條全綠、exit=0
 * （`attend.html` md5 4fd0167→3cdac2f／→0eb10f1）。
 *
 * 🔴 **為什麼「隨便怎麼突變都不會紅」**：`armLoadGuard()` 內含 `clearTimeout` 再
 *    `setTimeout` ⇒ **全頁只有一顆計時器**，三處互相覆蓋。有鑑別力的案例只能靠
 *    **時間點與路徑**構造出來——零點③是「先等過一個時限讓開頁那一發燒掉」，
 *    零點④是「首載整批根本沒發車，`beginLoading()` 一次都沒被呼叫過」，
 *    零點⑤是「唯一的一顆已經被拆掉，所以它不該開口」。**位置才是判準，條數不是。**
 */

/** LIFF 替身的定點替換。**一定要驗替換真的發生了**，否則注入是空包彈、測試永遠綠。 */
function swapInStub(src, needle, replacement, label) {
  const n = src.split(needle).length - 1;
  if (n !== 1) throw new Error('替身沒改到（' + label + '）：找到 ' + n + ' 處（預期 1）'
    + '——這一條測試什麼都沒測到');
  return src.split(needle).join(replacement);
}

/** 🔴 零點④的故障注入：`liff.init()` 的 promise **永遠不 settle**（不是 reject）。 */
const liffInitHangs = () => swapInStub(liffStub(),
  'init: function(){ return Promise.resolve(); },',
  'init: function(){ window.__liffInitCalled = 1; return new Promise(function(){}); },',
  'init 改成永遠不 settle');

/** ⬛ 對照組用：`liff.init()` **被拒絕**——有人接得住的那一種。 */
const liffInitRejects = () => swapInStub(liffStub(),
  'init: function(){ return Promise.resolve(); },',
  "init: function(){ window.__liffInitCalled = 1; return Promise.reject(new Error('INIT_BOOM')); },",
  'init 改成 reject');

/** 🔴 零點⑤的故障注入：沒登入 ⇒ 走 `startAuth()` 的導頁那一支。
 *  替身的 `login()` 刻意**不真的導頁**——那正是原始碼註解講的「導頁若慢了一步」。 */
const liffNotLoggedIn = () => swapInStub(liffStub(),
  'isLoggedIn: function(){ return true; },',
  'isLoggedIn: function(){ return false; },',
  'isLoggedIn 改成 false');

/** 突變：只刪**開頁那一發**（`:133`，頂格沒有縮排）。
 *  `beginLoading()` 裡那一發有兩格縮排、定義那一行是 `function armLoadGuard(){`，都不會被誤傷。 */
const killArmAtModuleLevel = (html) => {
  const needle = '\narmLoadGuard();\n';
  const n = html.split(needle).length - 1;
  if (n !== 1) throw new Error('突變沒有生效：開頁那一發找到 ' + n + ' 處（預期 1）'
    + '——這一條測試什麼都沒測到');
  return html.split(needle).join('\n');
};

/** 突變：只刪 `startAuth()` 裡的**拆發條**（六格縮排）。
 *  `armLoadGuard()` 自己那一行是兩格縮排，不會被誤傷。 */
const killDisarmInStartAuth = (html) => {
  const needle = '\n      if(_loadGuard)clearTimeout(_loadGuard);\n';
  const n = html.split(needle).length - 1;
  if (n !== 1) throw new Error('突變沒有生效：拆發條那一處找到 ' + n + ' 處（預期 1）'
    + '——這一條測試什麼都沒測到');
  return html.split(needle).join('\n');
};

/**
 * 🔴 **儀器活過被測事件了沒有——問頁面自己的時鐘，不靠「我寫的等待夠長」這種保證。**
 *
 * #119 的成因就是這一格：有人拿一條 **t≈1.7 秒**就收工的測試，去宣稱一件 **t≈25 秒**
 * 才發生的事「有間接涵蓋」。儀器提早關機與「沒有缺陷」在輸出上長得一模一樣。
 */
async function expectOutlivedGuard(page, tag) {
  const elapsed = await page.evaluate(() => performance.now());
  console.log('【' + tag + '】量完時頁面時鐘 ' + Math.round(elapsed) + ' ms（發條時限 ' + GUARD_MS + ' ms）');
  expect(elapsed,
    tag + '：量完時頁面時鐘還沒走過發條時限 ⇒ 儀器在事發之前就收工了，這一條什麼都沒測到')
    .toBeGreaterThan(GUARD_MS + 1000);
}

/* ══ 🔴 零點④ —— 開頁那一發：首載**整批都還沒發車**就卡住 ═══════════════════
 *
 * 🔴 **真路徑是「`liff.init()` 的 promise 永遠不 settle」——不是 reject。**
 *    `AUTH_READY` 不 settle ⇒ `FIRST`／`CACHE_READY`／`bootP` 全部不發車 ⇒
 *    `load()` 一次都沒被呼叫過 ⇒ **`beginLoading()` 裡那一發根本沒上過發條**，
 *    `.catch(chainFailed(...))` 也一個都不會觸發（沒有 rejection 可接）。
 *    ⇒ 整頁只剩開頁那一發擋得住，這才是「只有這一道擋得住」的案例。
 *
 * ⚠️ **拿 reject 當故障注入是一把零鑑別力的尺**：`startAuth()` 自己的 `.catch` 會接住
 *    並走 `authHalt()`，而它把 `#content` 清空 ⇒ 佔位不見 ⇒ 監看器的述詞永遠不成立。
 *    `queueRead` 的 `GAS_TAIL.then(fn, fn)` 是同一個形狀：**接得住被拒絕的工作，
 *    接不住永遠不結束的**。下面 ⬛ 對照組把這件事實測出來，不只是寫在註解裡。
 */

test('🔴 零點④（突變：拿掉開頁那一發）→ liff.init() 永遠不 settle ⇒ 首載整批沒發車、畫面永遠「載入中…」', async ({ page }) => {
  test.setTimeout(GUARD_MS + 60000);
  const { sent } = await open(page, { reply: batchThen(() => STATS), mutate: killArmAtModuleLevel,
    liff: liffInitHangs(), waitMs: 2000 });
  expect(await page.evaluate(() => window.__liffInitCalled),
    '故障注入沒生效：liff.init() 沒被呼叫過').toBe(1);
  const early = await regions(page);
  expect(early.placeholderStillThere,
    't≈2 秒就有人畫過東西 ⇒ 注入的不是「整批沒發車」，這一條測到的是別的東西').toBe(true);

  await page.waitForTimeout(GUARD_MS + 4000);
  await expectOutlivedGuard(page, '零點④·突變後');
  const r = await regions(page);
  console.log('【零點④·突變後】區塊：', JSON.stringify(r));
  console.log('【零點④·突變後】看得見：', await visibleText(page));
  expect(r.placeholderStillThere).toBe(true);
  expect(r.content).toBe('載入中…');
  expect(r.meta).toBe('載入中…');
  expect(sent.length, '首載整批都沒發車，這一輪不該有任何請求送出去').toBe(0);
});

test('零點④（現行碼）→ 開頁那一發把它講出來（beginLoading() 裡那一發根本沒上過發條）', async ({ page }) => {
  test.setTimeout(GUARD_MS + 60000);
  const { sent } = await open(page, { reply: batchThen(() => STATS),
    liff: liffInitHangs(), waitMs: 2000 });
  expect(await page.evaluate(() => window.__liffInitCalled),
    '故障注入沒生效：liff.init() 沒被呼叫過').toBe(1);
  expect((await regions(page)).placeholderStillThere,
    't≈2 秒就有人畫過東西 ⇒ 注入的不是「整批沒發車」').toBe(true);

  await page.waitForTimeout(GUARD_MS + 4000);
  await expectOutlivedGuard(page, '零點④·現行碼');
  const r = await regions(page);
  console.log('【零點④·現行碼】區塊：', JSON.stringify(r));
  expect(r.placeholderStillThere,
    '身分那一關卡住、首載整批沒發車，而畫面上一句話都沒有').toBe(false);
  expect(r.content).toContain('資料一直沒有回來');
  expect(r.content, '紅字下面還寫著「載入中」，那句是假話').not.toContain('載入中…');
  expect(sent.length, '首載整批都沒發車，這一輪不該有任何請求送出去').toBe(0);
});

test('⬛ 對照組（零點④）：改用「liff.init() 被拒絕」當故障注入 ⇒ 等過發條時限，突變前後仍然一模一樣', async ({ browser }) => {
  test.setTimeout(2 * GUARD_MS + 90000);
  const shots = {};
  for (const [tag, mutate] of [['現行碼', null], ['突變（刪開頁那一發）', killArmAtModuleLevel]]) {
    const ctx = await browser.newContext({ baseURL: test.info().project.use.baseURL });
    const p = await ctx.newPage();
    await open(p, { reply: batchThen(() => STATS), mutate, liff: liffInitRejects(), waitMs: 2000 });
    expect(await p.evaluate(() => window.__liffInitCalled), tag + '：故障注入沒生效').toBe(1);
    await p.waitForTimeout(GUARD_MS + 4000);
    await expectOutlivedGuard(p, '⬛對照組④ ' + tag);
    const r = await regions(p);
    shots[tag] = JSON.stringify(r);
    console.log('【⬛對照組④ ' + tag + '】', shots[tag]);
    expect(r.meta, 'reject 這條路是 startAuth() 自己的 .catch 接走的').toContain('確認身分時失敗');
    expect(r.placeholderStillThere,
      'authHalt() 會把 #content 清掉 ⇒ 監看器的述詞永遠不成立').toBe(false);
    await ctx.close();
  }
  expect(shots['突變（刪開頁那一發）'],
    '🔴 reject 版居然分得出突變前後 ⇒「接得住被拒絕的、接不住永遠不結束的」這段推理要重寫')
    .toBe(shots['現行碼']);
});

/* ══ 🔴 零點⑤ —— 拆發條：未登入導頁後，那句更具體的話必須活過發條時限 ══════════
 *
 * `startAuth()` 走未登入那一支時，`#content` 仍然是佔位（`authBlock(msg,false)` 刻意
 * 不清它——那是「正要離開這一頁」，不是「載入失敗」）。⇒ **監看器的述詞這時是成立的**，
 * 不拆發條的話，`fatal()` 會在 `LOAD_GUARD_MS` 到期時把 `#meta` 清空、把
 * 「正在前往 LINE 登入…」換成一句更含糊的「資料一直沒有回來」。
 *
 * 🔴 **這一格唯一的難處是時間軸。** 既有那條驗「正在前往 LINE 登入…」的測試
 *    （`attend-checkin-e1b.spec.js`）在 **t≈1.7 秒**就量完收工，而這一發要 **t≈25 秒**
 *    才會蓋掉那句話 ⇒ 它對這一格是**零涵蓋**，不是「間接涵蓋」。
 *    下面 ⬛ 對照組把「早收工的尺量不到」這件事實測出來。
 *
 * ⚠️ 替身的 `login()` 不真的導頁 ⇒ 頁面留在原地，正好是原始碼註解說的
 *    「導頁若慢了一步」。真的導頁走掉的話，這一格根本不需要存在。
 */

test('🔴 零點⑤（突變：拿掉 startAuth() 裡的拆發條）→ 導頁後等過發條時限 ⇒ 更具體的那句話被蓋掉', async ({ page }) => {
  test.setTimeout(GUARD_MS + 60000);
  const { sent } = await open(page, { reply: batchThen(() => STATS), mutate: killDisarmInStartAuth,
    liff: liffNotLoggedIn(), waitMs: 2000 });
  expect(await page.evaluate(() => window.__liffLoginCalled),
    '故障注入沒生效：沒走到導頁那一支').toBeTruthy();
  const early = await regions(page);
  expect(early.meta, '導頁那句話一開始就該在').toContain('正在前往 LINE 登入');
  expect(early.placeholderStillThere,
    '#content 已經被清掉 ⇒ 監看器的述詞本來就不成立，這一條測不到拆發條').toBe(true);

  await page.waitForTimeout(GUARD_MS + 4000);
  await expectOutlivedGuard(page, '零點⑤·突變後');
  const r = await regions(page);
  console.log('【零點⑤·突變後】區塊：', JSON.stringify(r));
  console.log('【零點⑤·突變後】看得見：', await visibleText(page));
  expect(r.meta,
    '拆發條被拿掉了，導頁那句話卻沒被蓋掉 ⇒ 要嘛這一刀沒切到東西，'
    + '要嘛整頁根本沒有計時器可拆（開頁那一發也被拿掉了）——兩種都代表這一條沒在測拆發條')
    .not.toContain('正在前往 LINE 登入');
  expect(r.content).toContain('資料一直沒有回來');
  expect(sent.length, '導頁中不該送出任何請求').toBe(0);
});

test('零點⑤（現行碼）→ 導頁後等過發條時限，「正在前往 LINE 登入…」必須還在', async ({ page }) => {
  test.setTimeout(GUARD_MS + 60000);
  const { sent } = await open(page, { reply: batchThen(() => STATS),
    liff: liffNotLoggedIn(), waitMs: 2000 });
  expect(await page.evaluate(() => window.__liffLoginCalled),
    '故障注入沒生效：沒走到導頁那一支').toBeTruthy();
  // 🔴 「監看器的述詞這時是成立的」要在**事發之前**量。放到等待之後才量的話，
  //    突變讓它開口、`fatal()` 把佔位換掉，這一格反而會替突變背書說「本來就測不到」。
  const early = await regions(page);
  expect(early.placeholderStillThere,
    't≈2 秒佔位就不見了 ⇒ 監看器的述詞本來就不成立，這一條測到的不是拆發條').toBe(true);
  expect(early.meta, '導頁那句話一開始就該在').toContain('正在前往 LINE 登入');

  await page.waitForTimeout(GUARD_MS + 4000);
  await expectOutlivedGuard(page, '零點⑤·現行碼');
  const r = await regions(page);
  console.log('【零點⑤·現行碼】區塊：', JSON.stringify(r));
  expect(r.meta,
    '導頁那句更具體的話被蓋掉了：拆發條沒有把唯一那顆計時器收掉').toContain('正在前往 LINE 登入');
  expect(r.content,
    '監看器在「正要離開這一頁」時開口＝誤傷').not.toContain('資料一直沒有回來');
  expect(r.placeholderStillThere,
    '佔位被換掉了＝有人在這一頁畫過東西，而這條路上不該有任何人動它').toBe(true);
  expect(sent.length, '導頁中不該送出任何請求').toBe(0);
});

test('⬛ 對照組（零點⑤）：在 t≈2 秒就量完收工 ⇒ 突變前後一模一樣——#119 的成因本身', async ({ browser }) => {
  const shots = {};
  for (const [tag, mutate] of [['現行碼', null], ['突變（刪拆發條）', killDisarmInStartAuth]]) {
    const ctx = await browser.newContext({ baseURL: test.info().project.use.baseURL });
    const p = await ctx.newPage();
    await open(p, { reply: batchThen(() => STATS), mutate, liff: liffNotLoggedIn(), waitMs: 2000 });
    const elapsed = await p.evaluate(() => performance.now());
    expect(elapsed, '這一格刻意要在發條時限之前收工，等太久就不是在示範早收工了')
      .toBeLessThan(GUARD_MS);
    const r = await regions(p);
    shots[tag] = JSON.stringify(r);
    console.log('【⬛對照組⑤ ' + tag + '】頁面時鐘 ' + Math.round(elapsed) + ' ms：', shots[tag]);
    expect(r.meta, tag + '：導頁那句話該在').toContain('正在前往 LINE 登入');
    await ctx.close();
  }
  expect(shots['突變（刪拆發條）'],
    '🔴 早收工的尺居然分得出突變前後 ⇒ #119 對「儀器提早關機」的診斷要重寫')
    .toBe(shots['現行碼']);
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
