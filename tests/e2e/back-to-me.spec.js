/**
 * 返回入口（`assets/back-to-me.js`）——**真瀏覽器量出來的那兩格**（票 #118）。
 *
 * ══ 為何非要這一支不可 ═══════════════════════════════════════════════════
 *
 * `tests/back-to-me.test.js` 的檔頭自己講得很清楚、而且講得對：
 * 「DOM 是假的、**沒有版面**……不是『看不看得到、有沒有被別的東西蓋住』——
 *   那兩格只有真瀏覽器量得出來（`elementFromPoint`），**本檔一個字都不宣稱**」。
 *
 * 🔴 問題從來不在那支單元測試超賣自己，在於**它宣告不管的那兩格沒有第二支尺接手**。
 *    `#104` 的驗證軌自己設計 17 顆突變，**2 顆在全套測試下存活，而且都真的把畫面弄壞**：
 *
 *    | 突變 | 全套單元測試 | 真瀏覽器後果 |
 *    |---|---|---|
 *    | `MOUNT_IN` 的內容欄選擇器改成 `.shell .wrap` | 🟢 1198 pass / 0 fail | `line-messages.html` **9/9 → 0/9**，被 `DIV.stickytop` 整個蓋住 |
 *    | 字色 fallback 改成 `#ffffff` | 🟢 1198 pass / 0 fail | `board.html` **白字白底，畫面上消失** |
 *
 *    第一顆**正是 `#104` 施工軌自己踩過、還寫進留言的那顆 bug**。它當時被抓到了，
 *    但抓到它的尺沒有留下來 ⇒ 這一支就是把那把尺變成常駐的。
 *
 * ══ 這支檔的三條紀律 ═════════════════════════════════════════════════════
 *
 * ① 🔴 **一格九點，不是只探中心。** 只探中心點的尺對「部分遮蔽」是隱形的
 *    ——`#104` 實測過：固定橫條蓋住上半，只探中心仍然判「沒被蓋住」。
 *    ⇒ 四角＋四邊中點＋中心，九點全部要命中這個連結本身。
 *
 * ② 🔴 **對比要算「它真正疊在上面的底色」**，不是 `body` 的宣告值。
 *    連結自己背景透明、它的容器也透明 ⇒ 真正被畫出來的底色要從
 *    `elementsFromPoint` 的疊層一層一層合成上來。**九個點各算一次、取最差的那個**。
 *    ⚠️ 這個模型只合成 `background-color`。疊層裡只要有人帶 `background-image`，
 *       模型就不成立 ⇒ 那一格**直接紅**（附訊息說要先改尺），不要靜靜量出一個錯的數字。
 *
 * ③ 🔴 **受測頁面的清單讀後端產出的分流表，不手寫。**
 *    `#104` 第一輪就是手寫成六頁、漏掉第七頁 `authz.html`，而全套測試全綠。
 *    權威來源＝`tests/fixtures/action-roles.json` 的 `dispatchPages`
 *    （後端 `ci/roles-matrix/export-json.js` 產、gas 側逐字釘住），
 *    與 `tests/back-to-me.test.js` **同一份副本、同一條契約**。
 *    分流表新增一頁時這一檔會跟著測那一頁——那正是要的。
 *
 * ══ 🔴 最低對比為什麼是 2.0——這個數字的出處 ═══════════════════════════
 *
 * **2.0 是選出來的，不是算出來的。** 選它的依據寫在這裡，不要只留一個裸數字：
 * 下一個人看到 `2.0` 會看到一個沒有來歷的門檻，於是要嘛不敢動、要嘛「好心」調高。
 *
 * ── 出處①：七頁當下實際量到的值（2026-09-17、1280 寬、字色七頁皆 `rgb(154,154,150)`）
 *
 *   | 頁 | 它真正疊在上面的底色 | 對比 |
 *   |---|---|---|
 *   | `board.html`         | `rgb(247,247,247)` | **2.64** ← 🔴 七頁裡的**設計下限** |
 *   | `stats.html`         | `rgb(251,251,250)` | 2.73 |
 *   | `hr-stats.html`      | `rgb(251,251,250)` | 2.73 |
 *   | `attend.html`        | `rgb(251,251,250)` | 2.73 |
 *   | `line-messages.html` | `rgb(251,251,250)` | 2.73 |
 *   | `line.html`          | `rgb(251,251,250)` | 2.73 |
 *   | `authz.html`         | `rgb(251,251,250)` | 2.73 |
 *
 *   （`board.html` 低那一階，是因為只有它的底色是 `rgb(247,247,247)`；
 *     其餘六頁都是 `rgb(251,251,250)`。每一頁九個取樣點的值都相同。）
 *
 *   ⚠️ **上面這七個值刻意沒有被寫成斷言。** 寫成斷言就變成一張期望值表，
 *      配色微調一次就整批紅成噪音，而噪音會讓人學會無視這一格。
 *      **它們是出處，不是判準**；判準永遠只有下面那一個常數。
 *
 * ── 出處②：壞掉的時候是多少
 *
 *   字色 fallback 改成 `#ffffff`（`#118` 那顆存活突變）在 `board.html` 上
 *   ⇒ `rgb(255,255,255)` 疊在 `rgb(247,247,247)` 上 ⇒ **1.07**。
 *
 * ── 🔴 為什麼刻意不用 WCAG AA 的 4.5
 *
 *   **因為這排字本來就不打算滿足無障礙對比標準。** 擁有者原話是
 *   「那顆鈕放左上角，**淡淡的一排字**就好」，色票用的是最弱的一階 `--ink3 #9a9a96`。
 *   門檻設 4.5 的話，**七頁會全部紅**——而那不是抓到 bug，是把擁有者拍板的設計判成失敗。
 *   ⇒ 這個門檻問的是「**還看得見嗎**」，不是「合不合規」。
 *   ⚠️ **下一個人如果想把它調高：先回頭讀這一段，再去問擁有者要不要改設計。**
 *      調高門檻不會讓那排字變清楚，只會讓這一檔開始說謊。
 *
 * ── ⚠️ 餘裕只剩 0.64，而且是單向的
 *
 *   2.64（設計下限）− 2.0（門檻）＝ **0.64**；另一邊 2.0 − 1.07（壞掉）＝ 0.93。
 *   🔴 **配色再淡一點就會撞到門檻。** 撞到的時候：
 *      **那是回來重新決定「還看得見嗎」的訊號，不是把這個常數調低去湊過。**
 *      調低它＝把「看不見」重新定義成「看得見」，而畫面不會因此變好。
 *      真的要更淡，就得連「這排字還算不算看得見」一起重新拍板。
 *
 * ⚠️ **2.0 是施工軌挑的、擁有者事後採用的**（票上只寫「對比足以看見／白字白底必須紅」）。
 *
 * ══ 🔴 這支看得到哪幾格、看不到哪幾格 ═══════════════════════════════════
 *
 * **這一段是刻意留白的清單，不是謙虛。** 沒有它，下一個人看到 e2e 與單元都綠，
 * 會以為每一格都有兩層保險——而實際上有一格拿掉單元那道，**什麼都不會紅**。
 *
 * 看得到（本檔在守）：
 *   · 分流表上那幾頁，返回入口**實際可見**（節點在、寬高非 0、沒被 CSS 藏起來）
 *   · 它**沒有被別的元素蓋住**（一格九點）
 *   · 它的**字色與真正疊在上面的底色**對比到看得見
 *   · 載入行**被繞過**（刪掉／註解／未閉合 `<!--`／`<template>`／不可執行的 type／
 *     只剩字串字面量）⇒ 節點不存在，上面第一格就會紅
 *   · 分流表本身讀不到或變短（零點那條）
 *
 * 🔴 **看不到（本檔一個字都不宣稱）**：
 *   · **「掛到不該掛的頁」**。本檔的迴圈只走 `dispatchPages` 上那幾頁，
 *     所以 `me.html` 或任何不在分流表上的頁多掛了一份，**本檔不會紅**。
 *     ⚠️ 實測過：那顆突變（在 `me.html` 也掛一份）**單元紅、本檔綠**。
 *     ⇒ **那一格目前只有 `tests/back-to-me.test.js` 在守，這裡是一道、不是兩道。**
 *     🔴 **要動單元測試那一格的人請知道：沒有第二道接著。**
 *   · 版面在**其他視窗寬度**下的樣子（本檔固定 1280×900 量一次）
 *   · 真的 LINE 登入流程（SDK 是替身，見下面「量具」）
 *
 * ══ ⚠️ 給任何要數「跑了幾顆突變」的人 ═════════════════════════════════
 *
 * **「六顆」這種數字要點名是哪六顆。**
 * 2026-09-17 本檔的施工軌報過一次「既有六顆重跑 ⇒ 6/6 全紅」，實際上跑的是
 * 五顆既有的**＋對照組**，而真正的第六顆（把分流表整段拿掉）從頭到尾沒跑過。
 * **數目對、母體錯，而且錯的方向剛好讓它看起來是完整的。**
 * ⇒ 報數字的時候連名字一起報；只有數目的「N/N 全紅」證明不了母體是哪 N 個。
 *
 * ══ 量具 ═════════════════════════════════════════════════════════════════
 *
 * ⚠️ **LIFF SDK 一律擋掉換替身。** 在 `localhost` 上真 SDK 的 `liff.init` 一定失敗
 *    （endpoint 註冊的是正式網域），失敗時整頁會被導去 LINE 的錯誤頁
 *    ——`#104` 的驗證軌為此發過一次假警報：量到「連節點都沒有」，其實是**量到了另一份文件**。
 * ⚠️ `line.html` 頂上蓋著一整片 fail-closed 的身分閘。替身讓 `startLiff()` 走到
 *    `liffOpen()`（它在任何後端呼叫**之前**），閘自然讓開——這不是繞過那道閘，
 *    是把它送進「身分確認完」那個狀態，也就是使用者真的在用這一頁的狀態。
 *    閘還蓋著的那個狀態另有一條測試在下面釘著。
 * ⚠️ 網址刻意帶 `?t=`（正式連結都長這樣），順便讓「相對連結會把查詢字串丟掉」在真瀏覽器裡成立。
 */
const { test, expect } = require('@playwright/test');

/** 🔴 清單讀權威來源，不手寫（見檔頭③）。 */
const 矩陣 = require('../fixtures/action-roles.json');

/**
 * ⚠️ **刻意不讓它在載入時炸掉。**
 * `dispatchPages` 整段消失時，頂層直接 `.map()` 會讓 Playwright 連一條測試都收不到
 * ——2026-09-17 實測那一顆突變（M4）：`TypeError … reading 'map'` ＋ `No tests found`，
 * **exit=1、卻一條測試都沒跑**。那個紅是「這個檔載不起來」，不是「有斷言抓到了」，
 * 而兩者在退出碼上長得一模一樣 ⇒ 看的人會把「沒執行」讀成「擋住了」。
 * ⇒ 讀不到就退成空陣列，讓底下那條零點測試**具名地**紅。
 */
const 分流頁 = Array.isArray(矩陣.dispatchPages)
  ? 矩陣.dispatchPages.map((r) => r && r.page)
  : [];

/**
 * 🔴 **改這個數字之前，先讀檔頭「最低對比為什麼是 2.0——這個數字的出處」那一節。**
 * 摘要：七頁實際值 2.64（board，最低）／其餘六頁 2.73；壞掉那顆 1.07；
 * 刻意不用 WCAG 的 4.5（會把擁有者要的「淡淡一排字」整批判成失敗）；
 * ⚠️ 對設計下限的餘裕只有 **0.64**——配色再淡就會撞到，屆時要回來重新決定，
 *    **不是把這個常數調低**。
 */
const 最低對比 = 2.0;

const 連結 = '#backtome a';

/** 真 SDK 在 localhost 上必失敗並導走整頁；替身要早於頁面 script。 */
function liff替身() {
  window.liff = {
    init: () => Promise.resolve(),
    isLoggedIn: () => true,
    // 長度像真的（真 ID token 是 ~1KB 的 JWT）——短字串會讓「網址長度」那類量測失去意義。
    getIDToken: () => 'eyJhbGciOiJIUzI1NiJ9.' + 'A'.repeat(900) + '.c2lnbmF0dXJl',
    getDecodedIDToken: () => ({ sub: 'U_e2e_118' }),
    login: () => {}, logout: () => {}, closeWindow: () => {}, openWindow: () => {},
    getOS: () => 'ios', isInClient: () => true, getVersion: () => '2.0.0',
  };
}

/**
 * 掛好儀器再開頁面。**`route` 與 `addInitScript` 一律早於 `goto`**。
 * @param {object} [opt.noLiff] 不裝替身（＝身分閘會一直蓋著）
 */
async function 開頁(page, 檔名, opt) {
  opt = opt || {};
  await page.setViewportSize({ width: 1280, height: 900 });
  // 兩條 route 的比對範圍不重疊，所以沒有「後註冊先比對」的問題。
  await page.route(/static\.line-scdn\.net/, (r) => r.abort('failed'));
  await page.route(/script\.google\.com/, (r) => r.fulfill({
    status: 200,
    contentType: 'text/javascript; charset=utf-8',
    body: 'cb(' + JSON.stringify({ ok: true, items: [], rows: [], list: [] }) + ')',
  }));
  if (!opt.noLiff) await page.addInitScript(liff替身);
  await page.goto('/' + 檔名 + '?t=E2E_FAKE_TOKEN', { waitUntil: 'domcontentloaded' });
  // 🔴 取樣時機：`defer` 的 script 掛完節點之後、字體量完之後。
  //    字體沒量完就取 rect，九個點會落在錯的地方（而且不會報錯）。
  //
  // ⚠️ **等不到的時候，不要讓 `TimeoutError` 當結論。**
  //    「等 10 秒沒等到」這句話**同時相容於兩件完全不同的事**：
  //      ① 那排字真的不見了（載入行被繞過 ⇒ 本 spec 要抓的東西）
  //      ② 整頁根本沒載起來（量具壞了 ⇒ 這一輪什麼都沒測到）
  //    而這兩者要分開看——這一輪剛好親自證明過為什麼：`dispatchPages` 那顆突變
  //    也是 `exit=1`，**卻一條測試都沒執行**。「載不進來」與「斷言抓到了」
  //    在退出碼上一模一樣。⇒ 等不到就當場取現場，把話講到能指認是哪一種。
  //
  // ⚠️ 逾時仍然留 10 秒：**這段等待只有在失敗時才真的耗掉 10 秒**，
  //    正常跑（節點約 130ms 內就掛上）一秒都不會多花 ⇒ 沒有縮短它的理由，
  //    而縮短反而會在機器忙碌時把「量具還沒好」誤判成「那排字不見了」。
  const 掛上了 = await page.waitForSelector(連結, { state: 'attached', timeout: 10000 })
    .then(() => true, () => false);
  if (!掛上了) {
    // 現場自己也可能取不到（頁面被導走／關掉）——那本身就是「②」的證據，
    // 所以包起來，不要讓它蓋掉底下那句具名的話。
    let 現場;
    try {
      現場 = await page.evaluate(() => ({
        網址: location.pathname + location.search,
        文件標題: document.title,
        body第一個子元素: document.body && document.body.firstElementChild
          ? document.body.firstElementChild.tagName : null,
        原始碼裡有載入標籤: !!document.querySelector('script[src*="back-to-me"]'),
        那支有跑起來嗎: !!document.getElementById('backtome-css'),
        容器在不在: !!document.getElementById('backtome'),
      }));
    } catch (e) { 現場 = { 取不到現場: String(e && e.message).slice(0, 80) }; }
    expect(掛上了,
      '等不到返回入口的節點（' + 連結 + '）。現場：' + JSON.stringify(現場)
      + ' ⇒ 判讀：**文件標題／網址對得上，就代表頁面有載起來**，'
      + '那麼節點不存在＝那排字真的不見了（載入行被繞過：整行被刪、被註解、'
      + '被未閉合的 `<!--` 吃掉、被 `<template>` 包住、改成不可執行的 type、'
      + '或只剩一個字串字面量——這幾種在原始碼字串比對下全都看不出來）。'
      + '⚠️ 反過來，文件標題是空的／網址被導走，那是**量具的問題**，'
      + '這一輪什麼都沒測到，先修儀器再談結論。').toBe(true);
  }
  await page.evaluate(() => document.fonts.ready);
  // 導走的話量到的會是另一份文件——那正是 #104 那次假警報的成因。
  expect(page.url(), '頁面被導走了 ⇒ 底下量到的是另一份文件，不是受測頁')
    .toContain('/' + 檔名);
}

/**
 * 一格九點 ＋ 每一點各自合成一次底色。**整段在瀏覽器裡跑**，量的是它算出來的結果。
 * @returns {{找到:boolean,可見點:number,九點:object[],字色:string,最差對比:number,...}}
 */
const 量 = (sel) => {
  const el = document.querySelector(sel);
  if (!el) return { 找到: false };
  const 名 = (n) => {
    if (!n) return null;
    let s = n.tagName;
    if (n.id) s += '#' + n.id;
    if (n.className && typeof n.className === 'string' && n.className.trim()) {
      s += '.' + n.className.trim().split(/\s+/).join('.');
    }
    return s;
  };
  const 解析 = (c) => {
    const m = String(c).match(/rgba?\(([^)]+)\)/);
    if (!m) return [0, 0, 0, 0];
    const p = m[1].split(',').map((v) => parseFloat(v));
    return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
  };
  const 亮度 = (r, g, b) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };

  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  const 字 = 解析(cs.color);

  // 四角往內縮 1px，否則邊界點會落到外面去（而 elementFromPoint 不會為此報錯）。
  const xs = [r.left + 1, r.left + r.width / 2, r.right - 1];
  const ys = [r.top + 1, r.top + r.height / 2, r.bottom - 1];

  const 九點 = [];
  let 最差對比 = Infinity;
  let 有背景圖 = null;
  for (const y of ys) for (const x of xs) {
    const 在畫面內 = x >= 0 && y >= 0 && x < innerWidth && y < innerHeight;
    const top = document.elementFromPoint(x, y);
    const 命中 = !!(top && (top === el || el.contains(top)));

    // 這一點真正被畫出來的底色：從連結底下那一層開始，一層一層合成上來。
    const 疊層 = document.elementsFromPoint(x, y);
    const i = 疊層.indexOf(el);
    const 底下 = i >= 0 ? 疊層.slice(i + 1) : 疊層;
    let [R, G, B, A] = [0, 0, 0, 0];
    for (const n of 底下) {
      const s = getComputedStyle(n);
      if (s.backgroundImage && s.backgroundImage !== 'none' && 有背景圖 === null) {
        有背景圖 = 名(n) + ' → ' + s.backgroundImage.slice(0, 60);
      }
      const c = 解析(s.backgroundColor);
      if (!c[3]) continue;
      const na = A + c[3] * (1 - A);            // 把 c 放到目前累積值的「底下」
      if (!na) continue;
      R = (R * A + c[0] * c[3] * (1 - A)) / na;
      G = (G * A + c[1] * c[3] * (1 - A)) / na;
      B = (B * A + c[2] * c[3] * (1 - A)) / na;
      A = na;
      if (A >= 0.999) break;
    }
    // 疊層見底還沒不透明 ⇒ 底下是瀏覽器的畫布，預設白。
    if (A < 0.999) {
      const na = A + (1 - A);
      R = (R * A + 255 * (1 - A)) / na; G = (G * A + 255 * (1 - A)) / na;
      B = (B * A + 255 * (1 - A)) / na; A = 1;
    }
    const l1 = 亮度(字[0], 字[1], 字[2]);
    const l2 = 亮度(R, G, B);
    const 對比 = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    if (對比 < 最差對比) 最差對比 = 對比;
    九點.push({ x: Math.round(x), y: Math.round(y), 在畫面內, 命中, 擋住的: 命中 ? null : 名(top),
                底色: 'rgb(' + [R, G, B].map(Math.round).join(', ') + ')',
                對比: Math.round(對比 * 100) / 100 });
  }

  return {
    找到: true,
    矩形: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
    可見點: 九點.filter((p) => p.命中).length,
    九點,
    擋住的: [...new Set(九點.filter((p) => !p.命中).map((p) => p.擋住的))],
    字色: cs.color, 字級: cs.fontSize,
    display: cs.display, visibility: cs.visibility, opacity: cs.opacity,
    最差對比: Math.round(最差對比 * 100) / 100,
    有背景圖,
    文字: (el.textContent || '').trim(),
  };
};

/* ══ 零點：清單本身 ═══════════════════════════════════════════════════════
 *
 * 🔴 **這一條防的是「這個檔靜靜地什麼都沒測」**：`dispatchPages` 讀成空陣列的話，
 *    下面那個迴圈會產生零條測試，而整批照樣全綠——零錯誤訊息。
 */
test('零點：受測頁面清單讀得到分流表，而且不是空的', async () => {
  expect(分流頁.length, '分流表讀成空的／太短 ⇒ 底下的迴圈等於沒有在測任何一頁')
    .toBeGreaterThanOrEqual(7);
  expect(分流頁, '第七頁不在清單裡 ⇒ #104 第一輪那個「手寫清單漏一頁」的洞又開了')
    .toContain('authz.html');
});

/* ══ 七頁各一條：看得見、沒被蓋住、對比夠 ══════════════════════════════════ */

for (const 檔名 of 分流頁) {
  test('返回入口在 ' + 檔名 + '：九點全可見、沒被蓋住、字色與底色的對比看得見', async ({ page }) => {
    await 開頁(page, 檔名);
    const m = await page.evaluate(量, 連結);

    expect(m.找到, '真瀏覽器裡 ' + 連結 + ' 回 null ⇒ 那排字根本沒掛上').toBe(true);
    expect(m.矩形.w, '寬是 0 ⇒ 節點在、但畫面上沒有東西').toBeGreaterThan(0);
    expect(m.矩形.h, '高是 0 ⇒ 節點在、但畫面上沒有東西').toBeGreaterThan(0);
    expect(m.文字, '連結一個字都沒有').not.toBe('');
    expect(m.display + '/' + m.visibility + '/' + m.opacity, '被 CSS 藏起來了')
      .not.toMatch(/^none\/|\/hidden\/|\/0$/);

    // ① 一格九點（見檔頭①）
    expect(m.九點.every((p) => p.在畫面內), '取樣點落到視窗外 ⇒ elementFromPoint 會回 null，這一輪什麼都沒量到')
      .toBe(true);
    expect(m.可見點, '返回入口被蓋住了（擋住它的是 ' + JSON.stringify(m.擋住的) + '）'
      + '——只探中心的尺看不到這件事，這就是一格九點的理由。九點明細：'
      + JSON.stringify(m.九點)).toBe(9);

    // ② 對比（見檔頭②）
    expect(m.有背景圖, '疊層裡有 background-image ⇒ 只合成 background-color 的模型不成立，'
      + '要先改這把尺，不要拿一個錯的數字當結論').toBe(null);
    expect(m.最差對比, '字色 ' + m.字色 + ' 疊在它真正的底色上只有 ' + m.最差對比
      + ':1 ⇒ 這排字在畫面上看不見（白字白底就是這個數字）。九點明細：'
      + JSON.stringify(m.九點)).toBeGreaterThanOrEqual(最低對比);
  });
}

/* ══ `line.html` 的身分閘：蓋著的時候，蓋住它的必須是那道閘本身 ══════════════
 *
 * 那排字在閘沒過的時候看不見，**這是刻意的**（閘是 fail-closed 的，
 * 要讓返回鍵浮在它上面就得把 z-index 抬過 9999 ＝ 從外面把那個設計拆掉）。
 * 🔴 但「被閘蓋住」與「被別的東西蓋住」是兩件完全不同的事，而畫面上長得一樣
 *    ⇒ 這一條把**遮蔽者的身分**釘住，不是把遮蔽本身放行。
 */
test('line.html 身分閘還蓋著時：擋住返回入口的必須是那道閘本身，不是別的東西', async ({ page }) => {
  await 開頁(page, 'line.html', { noLiff: true });
  const 閘 = await page.locator('#liff-gate').isVisible();
  expect(閘, '身分閘沒有蓋著 ⇒ 這一條測的前提不成立').toBe(true);

  const m = await page.evaluate(量, 連結);
  expect(m.找到, '節點沒掛上').toBe(true);
  expect(m.可見點, '閘蓋著卻還看得見返回入口 ⇒ 那道 fail-closed 的閘漏了').toBe(0);
  expect(m.擋住的, '擋住返回入口的不是身分閘，是 ' + JSON.stringify(m.擋住的)
    + ' ⇒ 這是版面壞掉，不是那道閘').toEqual(['DIV#liff-gate']);
});

/* ══ 兩條對照組：證明上面那兩把尺會動 ═══════════════════════════════════════
 *
 * 🔴 **「九點全可見」與「對比 2.74」這兩個數字，只有在尺會動的前提下才有意義。**
 *    一把永遠回 9 的尺與一把真的在量的尺，輸出一模一樣。
 *    ⇒ 同一支腳本、同一條流程，合成一個**已知會命中**的檢體，尺必須報出來。
 */
test('⬛ 對照組：合成一個蓋住返回入口的橫條 ⇒ 九點的尺必須抓到', async ({ page }) => {
  await 開頁(page, 'board.html');
  const 之前 = await page.evaluate(量, 連結);
  expect(之前.可見點, '受測前就不是 9/9 ⇒ 這一條對照組證明不了東西').toBe(9);

  // 合成檢體：一條 position:fixed 的橫條，正好蓋在那排字上（＝壞掉那顆突變的真實後果）
  await page.evaluate(() => {
    const r = document.querySelector('#backtome a').getBoundingClientRect();
    const d = document.createElement('div');
    d.id = '__針__';
    d.style.cssText = 'position:fixed;z-index:9999;background:#fff;left:0;right:0;top:'
      + (r.top - 2) + 'px;height:' + (r.height + 4) + 'px';
    document.body.appendChild(d);
  });
  const 之後 = await page.evaluate(量, 連結);
  expect(之後.可見點, '蓋了一條橫條上去，九點的尺仍然回 9 ⇒ 這把尺什麼都沒在量').toBe(0);
  expect(之後.擋住的, '尺抓到被蓋住了，但指不出是誰蓋的').toEqual(['DIV#__針__']);
});

test('⬛ 對照組：把字色合成成與底色同色 ⇒ 對比的尺必須抓到', async ({ page }) => {
  await 開頁(page, 'board.html');
  const 之前 = await page.evaluate(量, 連結);
  expect(之前.最差對比, '受測前對比就不及格 ⇒ 這一條對照組證明不了東西')
    .toBeGreaterThanOrEqual(最低對比);

  // 合成檢體：字色改成白（＝壞掉那顆突變本人：`var(--ink3,#ffffff)` 在沒有 --ink3 的頁上的結果）
  await page.evaluate(() => {
    const st = document.createElement('style');
    st.textContent = '#backtome a{color:#ffffff !important}';
    document.head.appendChild(st);
  });
  const 之後 = await page.evaluate(量, 連結);
  expect(之後.字色, '字色沒有真的被改掉 ⇒ 這一條對照組什麼都沒證明').toBe('rgb(255, 255, 255)');
  expect(之後.最差對比, '白字疊在淺色底上，對比的尺仍然給過 ⇒ 這把尺擋不住「畫面上消失」')
    .toBeLessThan(最低對比);
});
