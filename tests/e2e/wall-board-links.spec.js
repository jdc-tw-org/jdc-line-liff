/**
 * E1b 最後兩格跨頁連結（2026-09-13，線 WL）：stats／wall 都能走 LINE 登入之後，
 * 原本在②刻意擋掉的兩個入口要打開。
 *
 *   · board.html 管理者的「⇄ 活動紀錄看板」→ ②連 `stats.html`（E1a 時②整個不顯示）
 *   · stats.html 桌次分頁的「進場人數」     → ②開 `wall.html?act=`（S2 時②只講說明、不開）
 *
 * 🪦 **2026-09-18 起 `board.html` 只剩②一條路**（`jdc-tw/jdc-line-gas#99`）：
 *    它鑄造的連結**兩種入場方式都是不帶 token 的那一條**。下面那一組的第二列
 *    因此改了期望值（改寫不刪，理由寫在那一組上面）。
 *    ⚠️ `stats.html` 不在那一顆的範圍裡，它的 `?t=` 仍然活著、仍然鑄造帶 token 的網址。
 *
 * 🔴 **為何非在真瀏覽器看不可**：單元測試是在假 DOM 上直接叫 `showAdminSwitch(true)`／
 *    `openArrival()`。它證明不了**真的後端回應走到那一格時連結真的出現**、
 *    **真的按鈕按下去真的開了那個網址**（`#ti-act` 要先被活動清單填好才有值）。
 *
 * 🔴 每一條都：攔下所有 `/exec`（本機回應）、攔下所有非本機請求並斷言為空、
 *    發送類 action 計數 0。`window.open` 換成記錄器——**不真的開新視窗**。
 */
const { test, expect } = require('@playwright/test');

const SEND_ACTIONS = ['sendPassBroadcast', 'sendSeniorNotice', 'grantRefill', 'schedulePassBroadcast'];
function sendCount(searches) {
  let n = 0;
  searches.forEach((s) => {
    const sp = new URLSearchParams(s);
    if (SEND_ACTIONS.indexOf(sp.get('action')) >= 0) n++;
    let list = [];
    try { list = JSON.parse(sp.get('list') || '[]'); } catch (e) { list = []; }
    list.forEach((it) => { if (it && SEND_ACTIONS.indexOf(it.a) >= 0) n++; });
  });
  return n;
}

function liffStub() {
  return `window.liff = {
    init: function(){ return Promise.resolve(); },
    isLoggedIn: function(){ return true; },
    getIDToken: function(){ return 'IDTOK'; },
    getDecodedIDToken: function(){ return { sub: 'U_sub_1' }; },
    login: function(o){ window.__liffLoginCalled = (o && o.redirectUri) || 1; },
    logout: function(){ window.__liffLogoutCalled = (window.__liffLogoutCalled || 0) + 1; },
    closeWindow: function(){}, openWindow: function(){},
    getOS: function(){ return 'ios'; }, isInClient: function(){ return true; },
    getVersion: function(){ return '2.0.0'; }
  };
  window.open = function(u){ window.__opened = (window.__opened || []).concat([String(u)]); return null; };`;
}

/** 依 action／batch 子項回一包「一切正常、而且是管理者」的資料。 */
function reply(u) {
  const one = (name) => ({
    getCheckinOptions: { ok: true, units: [], titles: [] },
    getCheckinPending: { ok: true, who: '管理者', admin: true, rows: [], empNoConflicts: {} },
    getHrPending: { ok: true, rows: [] },
    getAnniversaries: { ok: true, rows: [] },
    listActivities: { ok: true, rows: [{ id: 'A1', name: '中秋餐會', status: '開放', open: true, replies: 7 }] },
    getActivityStats: { ok: true, who: '管理者', admin: true,
      activity: { id: 'A1', name: '中秋餐會', status: '開放', eventDate: '2026/09/20', deadlineText: '2026/09/15' },
      counts: { attend: 1, absent: 0, boundNoReply: 0, notBound: 0, total: 1, replied: 1, meat: 1, veg: 0 },
      opinions: [], absentList: [], boundNoReply: [], notBound: [] },
    getSeatingBoard: { ok: true, seats: [], guestVendors: 0, guestSeats: 0, pubState: 'none', ranks: {}, actName: '中秋餐會' },
  }[name] || { ok: true, rows: [] });
  const a = u.searchParams.get('action');
  if (a === 'batch') {
    const results = {};
    JSON.parse(u.searchParams.get('list') || '[]').forEach((it) => { results[it.a] = one(it.a); });
    return { ok: true, results };
  }
  return one(a);
}

async function open(page, file, search) {
  const logs = [], sent = [], external = [];
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  await page.route((url) => url.hostname !== '127.0.0.1', async (route) => {
    external.push(route.request().url());
    await route.abort();
  });
  await page.route(/static\.line-scdn\.net/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  await page.addInitScript(liffStub());
  await page.route(/script\.google\.com/, async (route) => {
    const u = new URL(route.request().url());
    sent.push(u.search);
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: 'cb(' + JSON.stringify(reply(u)) + ')' });
  });
  await page.goto('/' + file + search);
  await page.waitForTimeout(1500);
  return { logs, sent, external };
}

const pageErrors = (logs) => logs.filter((l) => l.startsWith('[pageerror]'));
function noLeak({ sent, external }) {
  expect(external, '有請求打到本機以外（應該全部被攔下）').toEqual(
    external.filter((u) => /static\.line-scdn\.net|script\.google\.com/.test(u)));
  expect(sendCount(sent), '測試裡送出了發送類 action：' + sent.join(' | ')).toBe(0);
}

/* 🪦 **下面這兩列 2026-09-18 之前是「兩種入場方式鑄造兩種網址」**，舊連結那一列
 *    期望的是 `stats.html?t=STUBTOKEN`。`board.html` 的 `?t=` 整條退場之後
 *    （`jdc-tw/jdc-line-gas#99`），本頁**不再持有 token，也不該再鑄造任何帶 token 的網址**
 *    ——鑄造一條出去等於把那條舊路又散播一次。
 * 🔴 **兩列刻意留著、只改期望值**（改寫不刪）：這一組的鑑別力就在
 *    「**帶 `?t=` 進來也一樣**」。刪掉舊連結那一列的話，哪天有人把
 *    `+(TOKEN?'?t='+…:'')` 接回去，不會有任何一條紅。
 * ⚠️ 下面 `stats` 那一組**不要跟著改**：`stats.html` 的 `?t=` 仍然活著，
 *    它吃的白名單也還沒有人決定要拆。 */
for (const [路, search, want] of [['②LINE 登入', '', 'stats.html'], ['🪦①舊連結（對照組）', '?t=STUBTOKEN', 'stats.html']]) {
  test(`board ${路}：管理者看得到「⇄ 活動紀錄看板」，連到 ${want}`, async ({ page }) => {
    const r = await open(page, 'board.html', search);
    const link = page.locator('#adm-switch');
    await expect(link, '連結沒出現').toBeVisible({ timeout: 5000 });
    expect(await link.getAttribute('href')).toBe(want);
    expect(r.sent.length).toBeGreaterThan(0);
    expect(pageErrors(r.logs)).toEqual([]);
    noLeak(r);
  });
}

for (const [路, search, want] of [['②LINE 登入', '?act=A1', 'wall.html?act=A1'], ['⬛①舊連結（對照組）', '?t=STUBTOKEN&act=A1', 'wall.html?t=STUBTOKEN&act=A1']]) {
  test(`stats ${路}：桌次分頁按「進場人數」開 ${want}，不掛錯誤訊息`, async ({ page }) => {
    const r = await open(page, 'stats.html', search);
    await page.locator('#tabbtn-tables').click();
    await expect.poll(() => page.locator('#ti-act').inputValue(), { timeout: 5000,
      message: '#ti-act 沒被活動清單填好 ⇒ 下面按的是「請先選擇活動」那一格（零鑑別力）' }).toBe('A1');
    await page.getByRole('button', { name: '進場人數' }).click();
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.__opened || [])).toEqual([want]);
    expect((await page.locator('#sm-msg').innerText()).trim()).toBe('');
    expect(pageErrors(r.logs)).toEqual([]);
    noLeak(r);
  });
}
