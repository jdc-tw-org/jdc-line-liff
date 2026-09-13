/**
 * board.html 的 E1a 三種失敗畫面（2026-09-12）。
 *
 * 🔴 **為何非在真瀏覽器看不可**：單元測試釘住的是「後端回了三種不同的 reason」。
 *    它證明不了**使用者看到三句不同的話**——中間隔著整條畫面路徑，而那一段
 *    CSS×JS 交界的 bug 靜態檢查抓不到（2026-07-27 attend.html 的下拉永遠不隱藏，
 *    三輪審查＋四項靜態確認全沒抓到，使用者開一次就看到）。
 *
 * 🔴 **這一檔的重點是失敗畫面，不是成功畫面。** 成功那條已經有測試釘住；
 *    會咬人的是「三句話在畫面上長得一樣」——那等於這一格的工作白做。
 *
 * ⚠️ 儀器早於事件：`page.route()` 與 `addInitScript()` 一律在 `goto()` 之前。
 */
const { test, expect } = require('@playwright/test');

/**
 * 🔴 **真的 LIFF SDK 必須擋掉，否則替身會被它覆蓋。**
 *    第一次跑就踩到：`addInitScript` 的替身有裝上去，但 `<script src=…sdk.js>`
 *    隨後載入並**覆寫 `window.liff`** ⇒ 頁面拿真的 SDK 去打 LINE ⇒ 瀏覽器被導去
 *    LINE 的錯誤頁，六條全紅、畫面內容是 `400 Bad Request`。
 *    ⚠️ 那個失敗長得像「我的頁面壞了」，其實是**替身缺席**——量具的問題不是受測物的問題。
 */
async function blockLiffCdn(page) {
  await page.route(/static\.line-scdn\.net/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
}

/** LIFF SDK 走 CDN；在頁面 script 跑之前先放一個替身，否則 startAuth 會走「元件沒載入」。 */
function liffStub({ loggedIn = true, idToken = 'IDTOK', sub = 'U_sub_1' } = {}) {
  return `window.liff = {
    init: function(){ return Promise.resolve(); },
    isLoggedIn: function(){ return ${loggedIn}; },
    getIDToken: function(){ return ${JSON.stringify(idToken)}; },
    getDecodedIDToken: function(){ return { sub: ${JSON.stringify(sub)} }; },
    login: function(o){ window.__liffLoginCalled = (o && o.redirectUri) || 1;
                        window.__liffCalls = (window.__liffCalls || []).concat('login'); },
    // 🔴 logout 不是補齊而已，它是一條真的路。2026-09-13 之前這個替身沒有它，
    //    於是 assets/liff-relogin.js 的能力檢查判定「SDK 不支援」而走了退路
    //    ⇒ 06／07 兩條測試綠得毫無意義：量到的是替身缺席，不是頁面行為。
    //    （真的 SDK 一定有 logout；替身缺一格＝受測物被換成另一個東西。）
    logout: function(){ window.__liffLogoutCalled = (window.__liffLogoutCalled || 0) + 1;
                        window.__liffCalls = (window.__liffCalls || []).concat('logout'); },
    closeWindow: function(){}, openWindow: function(){},
    getOS: function(){ return 'ios'; }, isInClient: function(){ return true; },
    getVersion: function(){ return '2.0.0'; }
  };`;
}

/**
 * @param {object} envelope 後端對 `batch` 回的外層信封（LINE 那條路是外層就被擋）
 */
async function open(page, { envelope, liff = {}, search = '', reloginTried = false } = {}) {
  const logs = [];
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  await blockLiffCdn(page);
  await page.addInitScript(liffStub(liff));
  // 「這次造訪已經自動重新登入過一次」＝ assets/liff-relogin.js 的防迴圈旗標。
  if (reloginTried) {
    await page.addInitScript(`try{sessionStorage.setItem('JDC_RELOGIN_TRIED','1');}catch(e){}`);
  }
  await page.route(/script\.google\.com/, async (route) => {
    const body = 'cb(' + JSON.stringify(envelope) + ')';
    await route.fulfill({ status: 200, contentType: 'application/javascript', body });
  });
  await page.goto('/board.html' + search);
  await page.waitForTimeout(1200);
  return logs;
}

/** 畫面上「使用者真的看得到」的文字。 */
async function visibleText(page) {
  return (await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('body *').forEach((el) => {
      if (el.children.length) return;                  // 只取葉節點，避免整頁重複
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return;
      const t = (el.textContent || '').trim();
      if (t) out.push(t);
    });
    return out;
  })).join(' ⏎ ');
}

/**
 * 後端 `GATE_MSG_LINE` 的文案副本。
 *
 * ⚠️ **這是一份跨 repo 的抄本，抄本一產生就開始腐爛。** 下面每一條測試餵進去的
 *    envelope 與斷言的期望值**是同一個變數** ⇒ 這些測試量的是「畫面有沒有把後端
 *    那句話畫出來」，**量不到「這句話跟後端現在說的一樣」**。後者沒有任何機械保護。
 *    （同 assets/deny-no-role.js 檔頭那段跨 repo 對齊的處境。）
 *
 * 重算來源（jdc-line-gas，2026-09-12 於 `1c18363`＝線上 build `g1c18363`）：
 *   awk '/^var GATE_MSG_LINE = \{/,/^\};/' line-platform/roles.js | grep -c '^  line_'
 *   → 6
 *   ⬛ 對照組（缺一不可，否則那個 6 可能是「awk 把整檔吐出來」）：
 *      同一條 awk 抓到 11 行、全檔 911 行（相同就代表區間沒生效）；
 *      把起點字樣換成不存在的 `GATE_MSG_NOSUCHTHING` → 0 行。
 *   ⚠️ 原本只比「區間內的 line_ 筆數」與「全檔的 line_ 筆數」，兩個都是 6
 *      ⇒ **那個對照組零鑑別力**，它同時相容於「區間對」與「區間等於全檔」。
 *
 * 🔴 6 種裡本檔原本只畫過 2 種（unbound／upstream）。其餘 4 種**從來沒有在瀏覽器裡
 *    出現過一次**，其中 `needs_sheet` 是整條 E1a 的退路開關（後端 `ROLE_SOURCE`
 *    切回 `token` 時就送這一句）——**退路的畫面沒人看過，等於退路沒驗過**。
 */
const MSG = {
  unbound: '您的 LINE 帳號還沒有完成員工身分綁定，所以系統認不出您是誰。請先回 LINE 完成綁定，再開啟這一頁。',
  upstream: '系統目前無法確認您的身分（不是您的問題）。請稍後再試一次；若一直這樣，請聯絡系統維護者。',
  unresolved: '系統目前讀不到您的權限設定。換一條連結不會有幫助，請聯絡系統維護者。',
  // 🔴 2026-09-13 更新：後端把這兩句改掉了（原本叫人「關掉這一頁重新開啟」，
  //    而那實測是 no-op ⇒ 照做會無限迴圈）。見 jdc-line-gas roles.js GATE_MSG_LINE。
  noToken: '沒有把您的 LINE 登入資訊送上來，所以系統認不出您是誰。'
    + '關掉這一頁重新開啟不會解決（LINE 不會因此重新登入一次），請聯絡資訊人員。',
  badToken: '您的 LINE 登入憑證已經過期，系統沒辦法確認您的身分。'
    + '重新整理或關掉這一頁重新開啟都不會解決（LINE 不會因此換一組新的憑證），'
    + '請聯絡資訊人員。',
  ambiguous: '您的綁定資料有重複的紀錄，系統無法判斷是哪一位。重新登入不會有幫助，請聯絡系統維護者。',
  needsSheet: '這一頁的 LINE 登入目前暫停使用，請改用原本的連結。',
};

/* ══ 狀態①：還沒登入 ═══════════════════════════════════════════════ */

test('①還沒登入 → 去 LINE 登入，畫面說明中，且一個請求都沒送出', async ({ page }) => {
  let sent = 0;
  await blockLiffCdn(page);
  await page.route(/script\.google\.com/, async (route) => {
    sent++; await route.fulfill({ status: 200, body: 'cb({"ok":true})' });
  });
  await page.addInitScript(liffStub({ loggedIn: false }));
  const logs = [];
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  await page.goto('/board.html');
  await page.waitForTimeout(1000);
  expect(await page.evaluate(() => window.__liffLoginCalled)).toBeTruthy();
  expect(sent, '導頁中還送出了請求').toBe(0);
  const txt = await visibleText(page);
  expect(txt).toContain('正在前往 LINE 登入');
  await page.screenshot({ path: 'test-results/e1a-01-登入中.png', fullPage: true });
  console.log('【①未登入】畫面：', txt.slice(0, 200));
  console.log('【①未登入】console：', JSON.stringify(logs));
});

/* ══ 狀態②：成功 ═════════════════════════════════════════════════ */

test('②登入成功、身分解出來 → 看板正常畫出來', async ({ page }) => {
  // ⚠️ `who` 一定要給——它是後端從守門交下來的身分取的「核准人」。
  //    第一次跑漏了它，畫面顯示「核准人：undefined」⇒ 那是**我的 mock 缺欄位**，
  //    不是頁面的 bug（`renderLoad` 讀的是 `getCheckinPending` 的 `r.who`）。
  //    補上之後這條斷言才有意義：它證明**身分真的走到畫面上**。
  const logs = await open(page, { envelope: { ok: true, results: {
    getCheckinOptions: { ok: true, units: [], titles: [] },
    getCheckinPending: { ok: true, rows: [], who: '甲', admin: false },
    getHrPending: { ok: true, rows: [] },
    getAnniversaries: { ok: true, items: [] },
  } } });
  const txt = await visibleText(page);
  expect(txt, '身分沒有走到畫面上').toContain('核准人：甲');
  expect(txt, '成功時不該出現任何一句失敗文案').not.toContain('請聯絡系統維護者');
  expect(logs.filter((l) => l.startsWith('[pageerror]')), 'console 有未捕捉的錯誤').toEqual([]);
  await page.screenshot({ path: 'test-results/e1a-02-成功.png', fullPage: true });
  console.log('【②成功】畫面：', txt.slice(0, 200));
  console.log('【②成功】console：', JSON.stringify(logs));
});

/* ══ 狀態③④⑤：三種失敗 ═══════════════════════════════════════════ */

for (const [key, reason, msg] of [
  ['03-沒綁定', 'line_unbound', MSG.unbound],
  ['04-系統壞了', 'line_upstream', MSG.upstream],
  ['05-名冊沒有生效的列', 'role_unresolved', MSG.unresolved],
]) {
  test(`失敗畫面 ${key}：後端的那一句要真的出現在畫面上`, async ({ page }) => {
    const logs = await open(page, { envelope: { ok: false, msg, reason } });
    const txt = await visibleText(page);
    await page.screenshot({ path: `test-results/e1a-${key}.png`, fullPage: true });
    console.log(`【${key}】reason=${reason}`);
    console.log(`【${key}】畫面：`, txt.slice(0, 400));
    console.log(`【${key}】console：`, JSON.stringify(logs));
    expect(logs.filter((l) => l.startsWith('[pageerror]')), 'console 有未捕捉的錯誤').toEqual([]);
    // 🔴 這一行就是這一檔存在的理由：後端講的那句話，使用者要看得到。
    expect(txt, `${reason} 的訊息沒有出現在畫面上 ⇒ 三種失敗對使用者是同一句`).toContain(msg.slice(0, 12));
  });
}

/* ══ 狀態⑥⑦⑧⑨：後端送得出來、而畫面從沒畫過的另外四種 ═══════════════════
 *
 * 為何補（2026-09-12，線 A）：`grep -rn 'line_no_token\|line_bad_token' tests/ assets/`
 * 在整個 liff repo **零命中**。
 *   ⬛ 對照組：同一條 grep 對 `line_unbound`／`line_upstream`／`role_unresolved`
 *      回 8 列 ⇒ 它會命中，「零」不是量法壞掉。
 *
 * 🔴 其中 `line_needs_sheet` 特別要緊：那是後端把 `ROLE_SOURCE` 切回 `token`
 *    （＝關掉整條 LINE 登入）時送的那一句。**退路是出事時才按的，按下去才第一次
 *    看到畫面長什麼樣＝最貴的時機。**
 *
 * ⚠️ 這幾條**證明不了後端真的會送這些字**（期望值與輸入同源，見 MSG 檔頭）。
 *    它們證明的是：這四種 reason 走到 `failBox` 那條路、訊息真的畫在畫面上、
 *    而且不是靜默空白，console 也乾淨。
 */
for (const [key, reason, msg] of [
  ['08-綁定資料重複', 'line_ambiguous', MSG.ambiguous],
  ['09-退路已啟動', 'line_needs_sheet', MSG.needsSheet],
]) {
  test(`失敗畫面 ${key}：後端的那一句要真的出現在畫面上（${reason}）`, async ({ page }) => {
    const logs = await open(page, { envelope: { ok: false, msg, reason } });
    const txt = await visibleText(page);
    await page.screenshot({ path: `test-results/e1a-${key}.png`, fullPage: true });
    console.log(`【${key}】reason=${reason}`);
    console.log(`【${key}】畫面：`, txt.slice(0, 400));
    console.log(`【${key}】console：`, JSON.stringify(logs));
    expect(logs.filter((l) => l.startsWith('[pageerror]')), 'console 有未捕捉的錯誤').toEqual([]);
    expect(txt, `${reason} 的訊息沒有畫出來 ⇒ 他只看到一個空畫面`).toContain(msg.slice(0, 12));
    // ⬛ 不只要「有字」，還要「不是空狀態的樣子」——否則被擋住與沒資料分不開。
    const look = await boxLook(page);
    expect(look, `${reason} 連訊息框都沒畫出來`).not.toBeNull();
    expect(look.cls, `${reason} 走的是 .empty（＝看起來像「這裡沒有資料」）`).toContain('msg-err');
  });
}

/**
 * 🔴 六種 reason 在畫面上必須是六句不同的話。
 *
 * 上面那條既有的「三種失敗必須是三句不同的話」量的是 3；這一條把後端送得出來的
 * 六種一次擺在一起比。**擴定義域時，對照的那一側也要跟著擴**——只補畫面、不擴
 * 「彼此必須不同」這條，就會出現「新加的四種其實都印同一句」而測試全綠。
 */
test('🔴 後端送得出來的六種 LINE 路失敗，畫面上必須是六句不同的話', async ({ browser }) => {
  const seen = {};
  for (const [reason, msg] of [
    ['line_unbound', MSG.unbound], ['line_upstream', MSG.upstream],
    ['line_no_token', MSG.noToken], ['line_bad_token', MSG.badToken],
    ['line_ambiguous', MSG.ambiguous], ['line_needs_sheet', MSG.needsSheet],
  ]) {
    const p = await (await browser.newContext()).newPage();
    await open(p, { envelope: { ok: false, msg, reason } });
    seen[reason] = await visibleText(p);
    await p.close();
  }
  const vals = Object.values(seen);
  // ⬛ 對照組：先確認每一種都真的畫出了東西（否則下面在比六個相同的空字串，
  //    而 Set 大小會是 1、紅得像「壓成一句」，真因卻是「六種都沒畫」）。
  Object.entries(seen).forEach(([k, v]) => {
    if (!v || !v.trim()) throw new Error(k + ' 畫面整片空白 ⇒ 這條測試什麼都沒比到');
  });
  expect(new Set(vals).size, '有兩種以上失敗畫出同一個畫面 ⇒ 那幾種人被指錯路').toBe(6);
  console.log('【六種失敗各自的畫面】', JSON.stringify(seen, null, 1).slice(0, 2000));
});

/**
 * 🔴 **「被擋住」與「這裡沒有資料」必須在畫面上分得開。**
 *
 * 為何補這一條（2026-09-12）：下面那條「三句話必須不同」是**綠的**，而畫面仍然有缺口
 * ——三句話確實不同，但它比的是三種失敗**彼此**，從來沒跟「沒有資料」比過。
 * 實際截圖看到的是：被擋下的訊息走 `.empty`（這一頁用來說「這一區沒有資料」的樣式），
 * 於是進不去的人看到的畫面，跟「這裡本來就沒東西」一模一樣。
 *
 * ⚠️ **判準刻意是「兩者必須不同」，不是「顏色等於某個值」。**
 *    把顏色寫死在測試裡，等於把同一個值抄第二份——樣式改一次就要改兩個地方，
 *    而忘了改的那一次測試會紅得莫名其妙（或更糟：改了測試去遷就）。
 */
/** #pending 裡那一塊訊息的「長相簽名」。 */
async function boxLook(page) {
  return page.evaluate(() => {
    const el = document.querySelector('#pending > div');
    if (!el) return null;
    const cs = getComputedStyle(el);
    return { cls: el.className, color: cs.color, bg: cs.backgroundColor,
             align: cs.textAlign, text: (el.textContent || '').trim().slice(0, 20) };
  });
}

test('🔴 被擋住的畫面，與「沒有資料」的畫面，必須分得開', async ({ browser }) => {
  const look = {};
  const cases = [
    ['沒有資料', { ok: true, results: {
      getCheckinOptions: { ok: true, units: [], titles: [] },
      getCheckinPending: { ok: true, rows: [], who: '甲', admin: false },
      getHrPending: { ok: true, rows: [] }, getAnniversaries: { ok: true, items: [] } } }],
    ['被擋住_沒綁定', { ok: false, msg: MSG.unbound, reason: 'line_unbound' }],
    ['被擋住_系統壞了', { ok: false, msg: MSG.upstream, reason: 'line_upstream' }],
  ];
  for (const [name, envelope] of cases) {
    const p = await (await browser.newContext()).newPage();
    await open(p, { envelope });
    look[name] = await boxLook(p);
    await p.close();
  }
  console.log('【長相簽名】', JSON.stringify(look, null, 1));

  // ⬛ 對照組：兩種狀態都真的畫出了東西（否則下面在比兩個 null）
  Object.entries(look).forEach(([k, v]) => {
    if (!v) throw new Error(k + ' 沒有畫出任何訊息 ⇒ 這條測試什麼都沒比到');
  });

  const sig = (v) => [v.color, v.bg, v.align].join('|');
  expect(sig(look['被擋住_沒綁定']), '被擋住與沒有資料長得一模一樣 ⇒ 他不知道自己被擋住了')
    .not.toBe(sig(look['沒有資料']));
  expect(sig(look['被擋住_系統壞了']), '同上，另一種失敗也要分得開')
    .not.toBe(sig(look['沒有資料']));
  // 兩種「被擋住」之間長相相同是對的——它們靠文字分辨，不靠顏色分辨。
  expect(sig(look['被擋住_沒綁定'])).toBe(sig(look['被擋住_系統壞了']));
});

test('🔴 三種失敗在畫面上必須是三句不同的話（壓成一句＝這一格白做）', async ({ page, browser }) => {
  const seen = {};
  for (const [reason, msg] of [
    ['line_unbound', MSG.unbound], ['line_upstream', MSG.upstream],
    ['role_unresolved', MSG.unresolved],
  ]) {
    const p = await (await browser.newContext()).newPage();
    await open(p, { envelope: { ok: false, msg, reason } });
    seen[reason] = await visibleText(p);
    await p.close();
  }
  const vals = Object.values(seen);
  expect(new Set(vals).size, '三種失敗畫出來是同一個畫面 ⇒ 使用者被指錯路').toBe(3);
  console.log('【三種失敗各自的畫面】', JSON.stringify(seen, null, 1).slice(0, 1500));
});

/* ══ 年資里程碑卡：三種狀態（2026-09-12）══════════════════════════════
 *
 * 🔴 這張卡原本的缺陷比 board.html 那四處更濃縮：「錯誤訊息」與「空狀態文字」
 *    擠在同一個運算式的兩側，而外層 class 寫死 `.empty`。
 * ⚠️ 而且它在 board.html 上**曾經是死路**——board 沒傳 opts ⇒ 失敗時整塊靜靜不顯示。
 *    同一次已把 failBox 傳進去，所以「被擋住」現在真的會現形。
 *    這幾條就是釘住「它現在是活的」。
 */
/** 開頁後切到員工名冊分頁（年資卡住在那裡），回 #anniv-box 的長相。 */
async function annivLook(page) {
  await page.click('#tabbtn-roster');
  await page.waitForTimeout(300);
  return page.evaluate(() => {
    const box = document.getElementById('anniv-box');
    if (!box) return null;
    const cs = getComputedStyle(box);
    const inner = box.firstElementChild;
    const ics = inner ? getComputedStyle(inner) : null;
    return {
      boxDisplay: cs.display,
      innerCls: inner ? inner.className : '(無內容)',
      color: ics ? ics.color : '', bg: ics ? ics.backgroundColor : '',
      text: (box.textContent || '').trim().slice(0, 40),
    };
  });
}

const ANNIV_ROWS = [{ name: '甲', unit: 'A部', years: 10, date: '2016-01-01', status: '在職' }];

test('🔴 年資卡：有資料／沒有資料／被擋住，三種狀態要分得開', async ({ browser }) => {
  const base = (anniv) => ({ ok: true, results: {
    getCheckinOptions: { ok: true, units: [], titles: [] },
    getCheckinPending: { ok: true, rows: [], who: '甲', admin: false },
    getHrPending: { ok: true, rows: [] },
    getRosterList: { ok: true, rows: [] },
    getAnniversaries: anniv } });
  const look = {};
  const cases = [
    ['有資料', base({ ok: true, year: 2026, rows: ANNIV_ROWS }), 'e1a-06-年資卡-有資料'],
    ['沒有資料', base({ ok: true, year: 2026, rows: [] }), 'e1a-07-年資卡-沒有資料'],
    ['被擋住', { ok: false, msg: MSG.unbound, reason: 'line_unbound' }, 'e1a-08-年資卡-被擋住'],
  ];
  for (const [name, envelope, shot] of cases) {
    const p = await (await browser.newContext()).newPage();
    const logs = await open(p, { envelope });
    look[name] = await annivLook(p);
    await p.screenshot({ path: `test-results/${shot}.png`, fullPage: true });
    console.log(`【年資卡/${name}】`, JSON.stringify(look[name]));
    console.log(`【年資卡/${name}】console：`, JSON.stringify(logs));
    await p.close();
  }

  // ⬛ 對照組：有資料那格必須真的畫出名字，否則下面在比三個空殼
  if (look['有資料'].text.indexOf('甲') < 0) {
    throw new Error('有資料時沒畫出名單 ⇒ 這條測試什麼都沒比到：' + JSON.stringify(look['有資料']));
  }
  const sig = (v) => [v.boxDisplay, v.innerCls, v.color, v.bg].join('|');
  expect(sig(look['被擋住']), '被擋住與沒有資料長得一模一樣 ⇒ 他不知道自己被擋住了')
    .not.toBe(sig(look['沒有資料']));
  expect(sig(look['被擋住']), '被擋住與有資料長得一模一樣').not.toBe(sig(look['有資料']));
  // 被擋住時後端那句話要真的看得到
  expect(look['被擋住'].text).toContain(MSG.unbound.slice(0, 10));
});

/* ══ 🔴 憑證死了：畫面不可以叫他做一件做不到的事，而是真的重新登入一次 ════════
 *
 * 為何在這裡而不是只有單元測試（2026-09-13）：
 * 這兩個代號原本走的是「把後端那句話畫在畫面上」，而後端那句話是
 * 「請關掉這一頁重新開啟以重新登入」——⬛ 實測那是 no-op（`liff.init()` 不會清、
 * `isLoggedIn()` 仍為 true ⇒ `liff.login()` 被跳過 ⇒ 同一顆過期 token 再送一次）。
 * 上面 06／07 兩條原本斷言「那句話要出現在畫面上」＝**在釘住一個死巷**，
 * 所以改寫成斷言「真的重新登入」。**改寫不刪**：刪掉就沒有東西釘住這兩個代號的行為。
 *
 * ⚠️ 這裡量的是**真的瀏覽器跑真的 board.html**，不是 vm 裡的替身：
 *    「判斷對了」與「判斷對了而且真的有人呼叫它」在單元測試裡分不開
 *    （assets 沒被 <script> 載到，單元測試照樣綠）。
 */
for (const [key, reason] of [['06-憑證沒帶上來', 'line_no_token'],
  ['07-登入過期', 'line_bad_token']]) {
  test(`🔴 ${key}（${reason}）→ 真的 logout 再 login，不是叫他關掉重開`, async ({ page }) => {
    const logs = await open(page, { envelope: { ok: false, msg: MSG[reason === 'line_bad_token' ? 'badToken' : 'noToken'], reason } });
    const calls = await page.evaluate(() => window.__liffCalls || []);
    const txt = await visibleText(page);
    await page.screenshot({ path: `test-results/e1a-${key}.png`, fullPage: true });
    console.log(`【${key}】liff 呼叫序列：`, JSON.stringify(calls));
    console.log(`【${key}】畫面：`, txt.slice(0, 400));
    expect(logs.filter((l) => l.startsWith('[pageerror]')), 'console 有未捕捉的錯誤').toEqual([]);
    // 🔴 順序要緊：先 logout 才 login。反過來＝帶著同一顆死 token 去登入。
    expect(calls, 'logout／login 沒有被呼叫 ⇒ 他仍然卡在死巷裡').toEqual(['logout', 'login']);
    expect(await page.evaluate(() => window.__liffLoginCalled),
      'login 沒帶 redirectUri ⇒ 登入後回不到這一頁').toContain('/board.html');
    expect(txt, '沒有告訴他正在做什麼 ⇒ 他看著一個定住的畫面').toContain('正在自動重新登入');
    // ⬛ 對照組：旗標要真的被寫下去，否則下一輪又會自動登出一次（＝迴圈）
    expect(await page.evaluate(() => { try { return sessionStorage.getItem('JDC_RELOGIN_TRIED'); } catch (e) { return 'THREW'; } }),
      '防迴圈旗標沒寫進去').toBe('1');
  });

  test(`🔴 ${key}（${reason}）第二次進來 → **不再**自動登出，改說請聯絡資訊人員`, async ({ page }) => {
    const logs = await open(page, {
      envelope: { ok: false, msg: MSG[reason === 'line_bad_token' ? 'badToken' : 'noToken'], reason },
      reloginTried: true });
    const calls = await page.evaluate(() => window.__liffCalls || []);
    const txt = await visibleText(page);
    await page.screenshot({ path: `test-results/e1a-${key}-第二次.png`, fullPage: true });
    console.log(`【${key} 第二次】liff 呼叫序列：`, JSON.stringify(calls));
    console.log(`【${key} 第二次】畫面：`, txt.slice(0, 400));
    expect(logs.filter((l) => l.startsWith('[pageerror]')), 'console 有未捕捉的錯誤').toEqual([]);
    expect(calls, '第二次還自動登出 ⇒ 登入與登出會一直來回，這一支自己就是那個迴圈').toEqual([]);
    expect(txt, '沒有講出「再試也沒用」⇒ 他會一直重試').toContain('請聯絡資訊人員');
    // ⬛ 對照組（缺一不可）：上面那條「第一次會 logout」與這一條若回一樣的東西，
    //    就代表旗標根本沒被讀到，而兩條都會綠。
    expect(txt).not.toContain('正在自動重新登入');
  });
}

/* ══ 🔴 有快取＋刷新失敗：畫面停在快取時要說出來（2026-09-13）══════════════════
 *
 * 為何在真瀏覽器量：⑤ 上線後身分服務一壞，人事看板有七天內快取的人會看到**照常的**待核准清單，
 * 沒有任何錯誤或離線提示，按核准才第一次看到錯誤。單元測試證明得了「有呼叫」，
 * 證明不了「提示真的看得見、清單真的沒被重繪、她打的字真的還在」。
 *
 * 快取是真的：第一輪讓頁面自己用 LINE 的 sub 加密存進 localStorage，第二輪同一個 context 再開。
 */
const STALE_OK = {
  getCheckinOptions: { ok: true, units: ['A部'], titles: ['工程師'] },
  getCheckinPending: { ok: true, who: '甲', admin: false, done: [],
    rows: [{ _row: 2, 報到日期: '2026-09-01', 姓名: '丙新人', 單位: 'A部', 職稱: '工程師', 生日: '', 公司信箱: '', 員編: '' }] },
  getHrPending: { ok: true, units: ['A部'], namesByUnit: {}, titles: ['工程師'],
    rows: [{ _row: 5, 類別: '調動', 文號: 'D-1', 姓名: '乙同仁', 狀態: '待確認', 原部門單位: 'A部', 新部門單位: 'A部',
      effIso: '2026-10-01', effTag: '10/1 生效' }] },
  getAnniversaries: { ok: true, year: 2026, rows: [] },
  getRosterList: { ok: true, activeCount: 1, total: 1,
    rows: [{ name: '丁名冊', unit: 'A部', title: '工程師', empNo: '001', status: '在職' }] },
  listHrNotices: { ok: true, rows: [] },
  listOptions: { ok: true, rows: [] },
};
const okReply = (action, u) => {
  if (action !== 'batch') return STALE_OK[action] || { ok: true };
  const results = {};
  JSON.parse(u.searchParams.get('list')).forEach((it) => { results[it.a] = STALE_OK[it.a]; });
  return { ok: true, results };
};
const failReply = () => ({ ok: false, reason: 'line_upstream', msg: MSG.upstream });

/** 換掉 GAS 的回應。delayMs：故意晚回來，讓快取先畫、使用者先動手。 */
async function routeGas(page, reply, delayMs = 0) {
  await page.unroute(/script\.google\.com/);
  await page.route(/script\.google\.com/, async (route) => {
    const u = new URL(route.request().url());
    const body = reply(u.searchParams.get('action'), u);
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: 'cb(' + JSON.stringify(body) + ')' });
  });
}

test('🔴 有快取＋身分服務故障：清單照舊、上方掛提示（時間＋後端那句）、她打的字還在、不出第二個錯誤框；恢復後提示消失', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const logs = [];
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  await blockLiffCdn(page);
  await page.addInitScript(liffStub());

  // 第一輪：成功，頁面自己把快取存進去（首發 4 支＋第二發 3 支）
  await routeGas(page, okReply);
  await page.goto('/board.html');
  await page.waitForFunction(() => Object.keys(localStorage).filter((k) => k.indexOf('jdcBoard:') === 0).length >= 7,
    null, { timeout: 10000 });
  // ⬛ 對照組：成功那一輪沒有任何提示（否則下面「有提示」量不出差異）
  expect(await page.locator('[id$="-refail"]').count()).toBe(0);

  // 第二輪：身分服務故障，而且晚 2 秒回來
  await routeGas(page, failReply, 2000);
  await page.goto('/board.html');
  await expect(page.locator('#pending .card'), '快取沒有秒顯 ⇒ 這一輪量不到「停在快取」').toHaveCount(1, { timeout: 1500 });
  await page.fill('#pending .card [data-k="員編"]', 'SENTINEL-9137');
  await page.evaluate(() => { window.__card = document.querySelector('#pending .card'); });
  await expect(page.locator('#pending-refail')).toBeVisible({ timeout: 5000 });

  const tip = await page.locator('#pending-refail').textContent();
  expect(tip).toMatch(/^⚠️ 這裡顯示的是 \d+\/\d+ \d\d:\d\d 的資料，目前無法更新：/);
  expect(tip).toContain(MSG.upstream);
  expect(await page.evaluate(() => document.querySelector('#pending .card') === window.__card), '清單被重繪了').toBe(true);
  expect(await page.inputValue('#pending .card [data-k="員編"]'), '她打的字被吃掉了').toBe('SENTINEL-9137');
  expect(await page.locator('#pending > .msg-err').count(), '提示與錯誤框同時出現').toBe(0);
  expect(await visibleText(page), '失敗時說「伺服器上有較新的資料」是假話').not.toContain('伺服器上有較新的資料');

  await page.click('#tabbtn-hr');
  await expect(page.locator('#hr-pending-refail')).toBeVisible();
  expect(await page.locator('#hr-pending-refail').textContent()).toContain(MSG.upstream);
  expect(await page.locator('#hr-pending').textContent(), '人事異動的舊清單不見了').toContain('乙同仁');
  expect(await page.locator('#hr-pending > .msg-err').count()).toBe(0);

  await page.click('#tabbtn-roster');
  await expect(page.locator('#r-count-refail')).toBeVisible({ timeout: 5000 });
  expect(await page.locator('#r-list').textContent()).toContain('丁名冊');
  await page.screenshot({ path: 'test-results/stale-01-有快取刷新失敗-名冊.png', fullPage: true });
  await page.click('#tabbtn-hr');
  await page.screenshot({ path: 'test-results/stale-02-有快取刷新失敗-人事異動.png', fullPage: true });
  console.log('【停在快取】提示：', tip);

  // 第三輪：恢復 ⇒ 所有提示消失
  await routeGas(page, okReply);
  await page.goto('/board.html');
  await expect(page.locator('#hr-pending .card')).toHaveCount(1);
  await page.waitForTimeout(800);
  await page.click('#tabbtn-roster');
  await page.waitForTimeout(800);
  expect(await page.locator('[id$="-refail"]').count(), '恢復後提示還在 ⇒ 最新資料被標成舊的').toBe(0);
  expect(logs.filter((l) => l.startsWith('[pageerror]')), 'console 有未捕捉的錯誤').toEqual([]);
  await context.close();
});

test('⬛ 沒有快取＋身分服務故障：維持原本的錯誤框，沒有「停在快取」提示（不出兩個）', async ({ page }) => {
  const logs = await open(page, { envelope: failReply() });
  expect(await page.locator('#pending > .msg-err').count()).toBe(1);
  expect(await page.locator('#pending-refail').count()).toBe(0);
  await page.click('#tabbtn-hr');
  expect(await page.locator('#hr-pending > .msg-err').count()).toBe(1);
  expect(await page.locator('#hr-pending-refail').count()).toBe(0);
  expect(logs.filter((l) => l.startsWith('[pageerror]'))).toEqual([]);
});
