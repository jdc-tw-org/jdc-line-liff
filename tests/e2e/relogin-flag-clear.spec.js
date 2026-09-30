/**
 * 防迴圈旗標「重登之後第一次成功就清」——在整天開著的現場頁上量（jdc-tw-migration#115）。
 *
 * 為何選 wall.html：改前它自己的檔頭就寫著「同一個分頁第二次過期時蓋上『請聯絡資訊人員』、
 * 牆停住」——每 15 秒輪詢、投在大螢幕上整天開著，是最容易撞到第二次過期的那一頁。
 * （checkin 同型；判斷本體在共用的 `assets/liff-relogin.js`，單元測試在 `tests/liff-relogin.test.js`。）
 *
 * 手法：`liff.login` 替身做**真的整頁導向**（`location.assign`），計數器住 sessionStorage
 * 以活過導向（同 `line-relogin.spec.js`）；後端依「第幾發」回應，**不預先種旗標**——
 * 旗標要由頁面自己在第一次過期時寫下，這樣量到的才是真實順序。
 * 輪詢用 `page.clock` 快轉。所有 `/exec` 都在本機攔下，請求出不了這台機器；本頁沒有發送類 action。
 */
const { test, expect } = require('@playwright/test');

const WALL = {
  ok: true, actName: '中秋餐會', eventDate: '2026/09/20', at: '18:30',
  total: 3, arrived: 1, notArrived: 2, reveal: true,
  units: [{ name: '工務', total: 3, arrived: 1, notArrived: 2, cells: [{ a: true }, { a: false, n: '甲' }, { a: false, n: '乙' }] }],
};
const 死憑證 = { ok: false, msg: '登入憑證失效', reason: 'line_bad_token' };

const LIFF_STUB = `window.liff = {
  init: function(){ return Promise.resolve(); },
  isLoggedIn: function(){ return true; },
  getIDToken: function(){ return 'IDTOK'; },
  getDecodedIDToken: function(){ return { sub: 'U_sub_1' }; },
  logout: function(){ try { sessionStorage.setItem('T115_logout', String(Number(sessionStorage.getItem('T115_logout') || 0) + 1)); } catch (e) {} },
  login: function(o){
    try { sessionStorage.setItem('T115_login', String(Number(sessionStorage.getItem('T115_login') || 0) + 1)); } catch (e) {}
    location.assign((o && o.redirectUri) || location.href);
  },
  closeWindow: function(){}, openWindow: function(){},
  getOS: function(){ return 'ios'; }, isInClient: function(){ return true; },
  getVersion: function(){ return '2.0.0'; }
};`;

/** @param {(k:number)=>object} reply 第 k 發（從 1 起算）回什麼 */
async function open(page, reply) {
  const sent = [], external = [], errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.clock.install();
  await page.route((url) => url.hostname !== '127.0.0.1', async (route) => {
    external.push(route.request().url());
    await route.abort();
  });
  await page.route(/static\.line-scdn\.net/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  await page.addInitScript(LIFF_STUB);
  await page.route(/script\.google\.com/, async (route) => {
    const u = new URL(route.request().url());
    sent.push(u.search);
    await route.fulfill({ status: 200, contentType: 'application/javascript',
      body: 'cb(' + JSON.stringify(reply(sent.length)) + ')' });
  });
  await page.goto('/wall.html?act=A1');
  return { sent, external, errors };
}

/** 讀計數器；撞上整頁導向時 evaluate 會拋 ⇒ 回一組不會等於任何期望值的值，讓 poll 再讀。 */
async function 副作用(page) {
  try {
    return await page.evaluate(() => ({
      logout: Number(sessionStorage.getItem('T115_logout') || 0),
      login: Number(sessionStorage.getItem('T115_login') || 0),
      旗標: sessionStorage.getItem('JDC_RELOGIN_TRIED'),
      覆蓋層: (document.getElementById('relogin-overlay') || {}).textContent || '',
    }));
  } catch (e) {
    return { logout: -1, login: -1, 旗標: 'NAV', 覆蓋層: '（導向中）' };
  }
}

async function 快轉一次輪詢(page) {
  await page.clock.runFor(16000);
  await page.waitForTimeout(600);
}

function 沒外洩(r) {
  expect(r.external.filter((u) => !/static\.line-scdn\.net|script\.google\.com/.test(u)),
    '有請求打到本機以外').toEqual([]);
  expect(r.sent.every((s) => /action=getArrivalWall/.test(s)), '送出了 getArrivalWall 以外的 action：' + r.sent.join(' | ')).toBe(true);
}

test('K1 🔴 同一個分頁：過期 → 重登 → 成功 → 輪詢又過期 ⇒ 第二次仍自動重登，不是死路（改前：覆蓋層）', async ({ page }) => {
  // 第 1 發死（開頁）→ 導走 → 第 2 發 ok（回來）→ 第 3 發死（一小時後的輪詢）→ 導走 → 第 4 發起 ok
  const r = await open(page, (k) => (k === 1 || k === 3 ? 死憑證 : WALL));
  await expect.poll(async () => (await 副作用(page)).login, '⬛ 零點：第一次過期真的導走').toBe(1);
  await expect(page.locator('body')).toContainText('中秋餐會');
  await expect.poll(async () => (await 副作用(page)).旗標, '回來第一發成功，旗標應該清掉').toBe(null);
  await 快轉一次輪詢(page);
  await expect.poll(async () => (await 副作用(page)).login, '🔴 第二次過期沒有自動重登 ⇒ 牆停在死路').toBe(2);
  await expect(page.locator('body')).toContainText('中秋餐會');
  const s = await 副作用(page);
  expect(s.logout).toBe(2);
  expect(s.覆蓋層, '第二次過期蓋上了死路覆蓋層').toBe('');
  expect(r.sent.length).toBeGreaterThanOrEqual(4);
  expect(r.errors).toEqual([]);
  沒外洩(r);
});

test('K2 🔴 重登回來第一發就又被拒 ⇒ 停在「請聯絡資訊人員」，不迴圈（login 恰好 1，輪詢再走也不增加）', async ({ page }) => {
  const r = await open(page, () => 死憑證);
  await expect.poll(async () => (await 副作用(page)).覆蓋層).toContain('請聯絡資訊人員');
  await 快轉一次輪詢(page);
  await 快轉一次輪詢(page);
  const s = await 副作用(page);
  expect(s.logout, '🔴 重登沒用還再導 ⇒ 迴圈').toBe(1);
  expect(s.login).toBe(1);
  expect(s.旗標).toBe('1');
  expect(r.errors).toEqual([]);
  沒外洩(r);
});
