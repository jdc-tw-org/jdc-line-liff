/**
 * **分流頁 `me.html`：按 `group` 分組、加小標**（`#61`）。
 *
 * ══ 為何需要一支真瀏覽器的 spec ═══════════════════════════════════════
 *
 * `tests/me-dispatch-wiring.test.js` 把 script 丟進 vm 跑，量的是**產生出來的字串**。
 * 它對 CSS 完全瞎：小標的字級／顏色／留白、`.grp:first-child` 那條規則有沒有生效、
 * 小標會不會因為某條選擇器而根本看不見——那一整層是 CSS×JS 的交界，
 * 靜態審查與單元測試都抓不到（`feedback_ui_change_needs_real_page`）。
 *
 * ⇒ 這一支在真的 Chrome 裡量**算好之後的樣式值**（`getComputedStyle`）與
 *   **看得到的頁數**，並把 console 的紅字當成受測項之一。
 *
 * ══ ⚠️ 跨工作樹撞 port ════════════════════════════════════════════════
 *
 * 4173 是這個 repo 各工作樹共用的預設號碼，同一時間常有好幾棵樹在跑。
 * 自己這一棵要跑之前先挑一個沒人用的：`E2E_PORT=4295 npx playwright test tests/e2e/me-group.spec.js`。
 * 第一條測試用 md5 證明**伺服器送出來的 `me.html` 就是這個工作樹磁碟上這一份**。
 *
 * ⚠️ 截圖存到 `SHOT_DIR`（沒設就落在 `test-results/`，那個目錄已在 .gitignore）。
 *    擁有者要看的那一張是用 `SHOT_DIR=~/Desktop` 跑出來的。
 */
const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..', '..');
const SHOT_DIR = process.env.SHOT_DIR || path.join(ROOT, 'test-results');

/** 後端產的那一份副本（`tests/fixtures/action-roles.json`）——與線上那張表逐字相同，
 *  由 `jdc-line-gas` 的 `roles-matrix-guard` 釘住。**順序照收，不在這裡重排。** */
const 矩陣 = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'action-roles.json'), 'utf8'));

/** 刻意捏的示例列（同單元測試那一份）：**不是任何真頁**，而且**沒有 `group`**
 *  ——它同時測到「不可點的卡片」與「後端漏標時落到哪裡」。 */
const 示例列 = {
  page: '__未遷移示例__.html', title: '示例：尚未遷移的頁',
  gateAction: 'zzExample', lineReady: false, note: '示例註記',
};
const 清單 = { ok: true, who: '丁小恆', pages: (矩陣.dispatchPages || []).concat([示例列]) };

function b64u(s) {
  return Buffer.from(s, 'utf8').toString('base64')
    .replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}
/** JWT 形狀的 ID token：payload 是真的、簽章是假的（前端只讀 payload，不驗簽）。 */
const 還很新 = () => b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' })) + '.'
  + b64u(JSON.stringify({ sub: 'Uzzz_test_only', exp: Math.floor(Date.now() / 1000) + 3600 }))
  + '.sig_not_real';

/** LIFF SDK 的替身。`login()` 只記錄、不導頁（真的 SDK 會整頁導去 access.line.me）。 */
const SDK替身 = `
(function () {
  var cfg = window.__LIFF_STUB || {};
  window.__liffCalls = { init: 0, logout: 0, login: 0 };
  function decode(t) {
    try {
      var p = String(t).split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(decodeURIComponent(escape(atob(p))));
    } catch (e) { return null; }
  }
  window.liff = {
    init: function () { window.__liffCalls.init++; return Promise.resolve({}); },
    isLoggedIn: function () { return true; },
    getIDToken: function () { return cfg.idToken || null; },
    getDecodedIDToken: function () { return cfg.idToken ? decode(cfg.idToken) : null; },
    logout: function () { window.__liffCalls.logout++; },
    login: function (a) { window.__liffCalls.login++; window.__liffLoginArgs = a; },
    isInClient: function () { return false; },
    getProfile: function () { return new Promise(function () {}); },
  };
})();
`;

/** 架好一頁：替身 SDK、假後端、零外部流量，並把 console 的紅字收起來。 */
async function 架好(page, reply) {
  const 紅字 = [];
  page.on('console', (m) => { if (m.type() === 'error') 紅字.push(m.text()); });
  page.on('pageerror', (e) => 紅字.push('pageerror: ' + e.message));
  await page.addInitScript(([t]) => { window.__LIFF_STUB = { idToken: t }; }, [還很新()]);
  await page.route('**://static.line-scdn.net/**', (r) =>
    r.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: SDK替身 }));
  await page.route('**://script.google.com/**', (r) => r.fulfill({
    status: 200, contentType: 'text/javascript; charset=utf-8',
    body: 'cb(' + JSON.stringify(reply) + ')',
  }));
  // ⬛ 第二道：真的導去 LINE 的話症狀是逾時，不是送出一次真的登入。
  await page.route('**://access.line.me/**', (r) => r.abort());
  return 紅字;
}

const 畫完 = (page) => page.waitForFunction(() => {
  const l = document.getElementById('list');
  return l && l.innerHTML.trim() !== '';
}, null, { timeout: 10000 });

/** 畫面上的視覺順序（小標與卡片依序攤成一列）。取的是**真的 DOM**，不是字串比對。 */
const 版面 = (page) => page.evaluate(() => Array.from(
  document.querySelectorAll('#list .grp, #list .card')).map((e) => (
    e.classList.contains('grp') ? '組:' + e.textContent
      : '頁:' + (e.querySelector('.name') || {}).textContent)));

/* ══ ⬛ 零點：伺服器服務的是**我這棵樹** ═══════════════════════════════ */

test('⬛ 伺服器送出來的 me.html＝這個工作樹磁碟上這一份（md5 相等）', async ({ request }) => {
  const 線上 = await (await request.get('/me.html')).text();
  const 磁碟 = fs.readFileSync(path.join(ROOT, 'me.html'), 'utf8');
  const md5 = (s) => crypto.createHash('md5').update(s, 'utf8').digest('hex');
  expect(md5(線上), '伺服器服務的不是這個工作樹 ⇒ 換一個 E2E_PORT 重跑').toBe(md5(磁碟));
});

/* ══ 🔴 受測：分組、頁數守恆、樣式、console ══════════════════════════════ */

test('🔴 #61 真瀏覽器：小標照送來的順序出現、頁數守恆、console 沒有紅字', async ({ page }) => {
  const 紅字 = await 架好(page, 清單);
  await page.setViewportSize({ width: 390, height: 844 });   // 手機（LIFF 的實際場合）
  await page.goto('/me.html');
  await 畫完(page);

  // 期望的視覺順序**由送進去的資料現算**，不手寫一份順序表（手寫＝後端順序的第二個副本）。
  const 期望 = [];
  let 上一組 = null;
  清單.pages.forEach((p) => {
    const g = String(p.group == null ? '' : p.group) || '其他';
    if (g !== 上一組) { 期望.push('組:' + g); 上一組 = g; }
    期望.push('頁:' + p.title);
  });
  expect(await 版面(page), '畫出來的順序與送進去的不一樣').toEqual(期望);

  // ⬛ 頁數守恆：**看得到的**卡片數（含不可點的灰卡）＝後端送來的列數。
  const 頁數 = await page.evaluate(() => document.querySelectorAll('#list .card').length);
  expect(頁數, '分組把頁吃掉了（那是使用者唯一的入口清單）').toBe(清單.pages.length);
  const 可見 = await page.evaluate(() => Array.from(document.querySelectorAll('#list .card'))
    .filter((e) => e.getBoundingClientRect().height > 0).length);
  expect(可見, '有卡片算在 DOM 裡卻量不到高度 ⇒ 畫面上看不到').toBe(清單.pages.length);

  // 🔴 不可點那條路沒被分組弄壞：灰卡不是 <a>，而且說得出為什麼。
  const 灰 = await page.evaluate(() => Array.from(document.querySelectorAll('#list .card.off'))
    .map((e) => ({ tag: e.tagName, 文: e.innerText })));
  expect(灰.length, '灰卡數與 lineReady===false 的列數不符').toBe(
    清單.pages.filter((p) => p.lineReady === false).length);
  灰.forEach((c) => {
    expect(c.tag, '不可點的卡做成了 <a> ⇒ 點下去必定被擋').not.toBe('A');
    expect(c.文).toContain('尚未支援 LINE 登入');
  });
  // 🔴 頁尾與卡片同一個述詞：分組不可以讓這兩處分道。
  expect(await page.evaluate(() => document.getElementById('foot').textContent))
    .toContain('其中 ' + 灰.length + ' 頁還沒改成');

  expect(紅字, 'console 有紅字 ⇒ 開了頁面不等於驗收，這正是要看的地方').toEqual([]);
});

test('🔴 #61 真瀏覽器：小標「小小的、不明顯」——比卡片標題小、用次文字色、不粗體、無框無底', async ({ page }) => {
  await 架好(page, 清單);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/me.html');
  await 畫完(page);

  const 量 = await page.evaluate(() => {
    const g = document.querySelector('#list .grp');
    const n = document.querySelector('#list .card .name');
    const s = getComputedStyle(g), ns = getComputedStyle(n);
    const r = g.getBoundingClientRect();
    const 第一張 = g.nextElementSibling.getBoundingClientRect();
    return {
      字級: parseFloat(s.fontSize), 標題字級: parseFloat(ns.fontSize),
      粗細: parseInt(s.fontWeight, 10), 顏色: s.color,
      次文字色: getComputedStyle(document.documentElement).getPropertyValue('--ink2').trim(),
      主文字色: getComputedStyle(document.documentElement).getPropertyValue('--ink').trim(),
      框: s.borderStyle, 底: s.backgroundColor,
      第一個小標的上緣: r.top, 與下一張卡的距離: 第一張.top - r.bottom,
      第二組上方留白: (() => {
        const all = Array.from(document.querySelectorAll('#list .grp'));
        if (all.length < 2) return null;
        const 前一張 = all[1].previousElementSibling.getBoundingClientRect();
        return all[1].getBoundingClientRect().top - 前一張.bottom;
      })(),
    };
  });

  // 字級比卡片標題**小**（往下降一級）。
  expect(量.字級, '小標沒有比卡片標題小 ⇒ 它會跟標題搶視線').toBeLessThan(量.標題字級);
  // 不粗體。
  expect(量.粗細, '小標是粗體 ⇒ 擁有者要的是「不明顯」').toBeLessThanOrEqual(400);
  // 顏色＝那一頁既有的次文字色變數，不是主文字色、也不是寫死的別的色。
  const 轉rgb = (hex) => {
    const m = hex.replace('#', '');
    return 'rgb(' + [0, 2, 4].map((i) => parseInt(m.slice(i, i + 2), 16)).join(', ') + ')';
  };
  expect(量.顏色, '小標沒有用 --ink2（次文字色）').toBe(轉rgb(量.次文字色));
  expect(量.顏色, '小標用的是主文字色 ⇒ 那是「搶視線」的那一種').not.toBe(轉rgb(量.主文字色));
  // 不加框線、不加底色。
  expect(量.框).toBe('none');
  expect(['rgba(0, 0, 0, 0)', 'transparent']).toContain(量.底);
  // 上方留白把組隔開、下方緊貼該組第一張卡。
  expect(量.第二組上方留白, '組與組之間沒有拉開 ⇒ 掃過去分不出來').toBeGreaterThan(量.與下一張卡的距離);
  // 🔴 第一個小標不留上緣：留了的話整份清單會憑空往下掉一截。
  expect(量.與下一張卡的距離, '小標與該組第一張卡之間有一道縫').toBeLessThan(12);

  fs.mkdirSync(SHOT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(SHOT_DIR, 'me-group.png'), fullPage: true });
});

test('🔴 #61 真瀏覽器：後端漏標 group 的頁仍然看得見，而且不被併進上一組', async ({ page }) => {
  const 有組 = 矩陣.dispatchPages[0];
  const 缺鍵 = Object.assign({}, 矩陣.dispatchPages[1]); delete 缺鍵.group;
  const 紅字 = await 架好(page, { ok: true, who: '丁小恆', pages: [有組, 缺鍵] });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/me.html');
  await 畫完(page);

  expect(await 版面(page)).toEqual(
    ['組:' + 有組.group, '頁:' + 有組.title, '組:其他', '頁:' + 缺鍵.title]);
  expect(await page.evaluate(() => document.querySelectorAll('#list .card').length),
    '漏標的那一頁消失了 ⇒ 他有權限卻找不到入口').toBe(2);
  expect(紅字).toEqual([]);

  fs.mkdirSync(SHOT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(SHOT_DIR, 'me-group-漏標.png'), fullPage: true });
});
