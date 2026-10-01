/**
 * K4（jdc-tw-migration#128）：資深夥伴範本「處理中」時，鎖住的按鈕與下拉**看得出灰掉**。
 *
 * 🔴 為何（10-01 H1，YU 實機）：K1 只量 `disabled` 屬性，驗證軌的真 Chrome 量的也是屬性
 *    ——兩邊都綠，而畫面上按鈕與下拉一點都沒變。原因是 `.btn`／`.btn-sm`／select 都自訂了底色，
 *    瀏覽器預設的灰化被蓋掉。屬性對、外觀錯，只有量 **computed style** 才分得出來。
 *    ⇒ 本檔在真瀏覽器裡量 `getComputedStyle(el).opacity`，不量屬性。
 *
 * ⬛ 零點：同一顆按鈕在「沒有處理中」時量到的是 1——否則「< 1」可能是別的樣式造成的恆真。
 * ⬛ 對照組（施工時跑過）：拿掉 stats.html 的 `.btn:disabled, select:disabled` 那條 ⇒ 本檔紅（按鈕量到 1）；
 *    只拿掉 `select:disabled` ⇒ 也紅（下拉量到 Chrome 預設的 0.7，被「= 0.45」那句抓到）。
 *
 * ⚠️ 手法照 `stats-e1b.spec.js`：擋掉真的 LIFF SDK、所有 `/exec` 本機回應、非本機請求一律攔下並斷言為空、
 *    發送類 action 計數為 0。這裡按的是「儲存」（saveSeniorTemplate），不會讓任何人的手機響。
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

const LIFF_STUB = `window.liff = {
  init: function(){ return Promise.resolve(); },
  isLoggedIn: function(){ return true; },
  getIDToken: function(){ return 'IDTOK'; },
  getDecodedIDToken: function(){ return { sub: 'U_sub_1' }; },
  login: function(){}, logout: function(){}, closeWindow: function(){}, openWindow: function(){},
  getOS: function(){ return 'ios'; }, isInClient: function(){ return true; }, getVersion: function(){ return '2.0.0'; }
};`;

const ROWS = [{ id: 'A1', name: '中秋餐會', status: '開放', open: true, replies: 7, deadline: '2026/09/15', eventDate: '2026/09/20' }];
const STATS = {
  ok: true, who: '佳岑',
  activity: { id: 'A1', name: '中秋餐會', status: '開放', eventDate: '2026/09/20', deadlineText: '2026/09/15' },
  counts: { attend: 1, absent: 0, boundNoReply: 0, notBound: 0, total: 1, replied: 1, meat: 1, veg: 0 },
  opinions: [], absentList: [], boundNoReply: [], notBound: [],
};
// 帶一則已停用的 ⇒ 「恢復」鈕畫得出來，一起量（它也是鎖的一部分）
const SENIOR = {
  ok: true, year: '2026', years: ['2026'], titles: ['十年'], ids: ['uuid-a'], templates: ['恭喜'], status: ['none'], audience: [],
  disabled: [{ id: 'uuid-d', title: '舊的', disabledAt: '2026-10-01T04:38:18.000Z' }],
};

function one(name) {
  return {
    listActivities: { ok: true, rows: ROWS }, getActivityStats: STATS, getSeniorNotice: SENIOR,
    saveSeniorTemplate: { ok: true },
  }[name] || { ok: true, rows: [] };
}

/** 年資區塊被鎖的控制項（= stats.html 的 SN_LOCK_IDS）＋恢復鈕。 */
async function opacities(page) {
  return page.evaluate(() => {
    const out = {};
    ['sn-add', 'sn-del', 'sn-save', 'sn-send', 'sn-idx', 'sn-year'].forEach((id) => {
      const el = document.getElementById(id);
      out[id] = { disabled: el.disabled, opacity: getComputedStyle(el).opacity };
    });
    document.querySelectorAll('#sn-dis-list button').forEach((b, i) => {
      out['restore' + i] = { disabled: b.disabled, opacity: getComputedStyle(b).opacity };
    });
    return out;
  });
}

test('K4：處理中時 #sn-* 按鈕、下拉與恢復鈕的 computed opacity < 1；處理完回到 1', async ({ page }) => {
  const sent = [], external = [], errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route((url) => url.hostname !== '127.0.0.1', async (route) => { external.push(route.request().url()); await route.abort(); });
  await page.route(/static\.line-scdn\.net/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  await page.addInitScript(LIFF_STUB);
  let release;
  const held = new Promise((r) => { release = r; });
  await page.route(/script\.google\.com/, async (route) => {
    const u = new URL(route.request().url());
    sent.push(u.search);
    const a = u.searchParams.get('action');
    let body;
    if (a === 'batch') {
      const results = {};
      JSON.parse(u.searchParams.get('list') || '[]').forEach((it) => { results[it.a] = one(it.a); });
      body = { ok: true, results };
    } else body = one(a);
    if (a === 'saveSeniorTemplate') await held;   // 讓後端「慢」：處理中的畫面停住給我們量
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: 'cb(' + JSON.stringify(body) + ')' });
  });

  await page.goto('/stats.html?act=A1');
  await page.locator('#tabbtn-staff').click();
  await expect(page.locator('#sn-idx option'), '年資清單沒畫出來 ⇒ 下面量的不是真的狀態').toHaveCount(1, { timeout: 8000 });
  await expect(page.locator('#sn-dis-list button')).toHaveCount(1);

  // ⬛ 零點：沒在處理中 ⇒ 全部 enabled、opacity 1
  const before = await opacities(page);
  console.log('【K4 零點】', JSON.stringify(before));
  Object.entries(before).forEach(([id, v]) => {
    expect(v.disabled, id + ' 處理前就是 disabled').toBe(false);
    expect(v.opacity, id + ' 處理前就不是 1 ⇒ 「< 1」不能歸因到 :disabled').toBe('1');
  });

  await page.locator('#sn-save').click();
  await expect(page.locator('#sn-msg')).toHaveText('處理中…');
  const busy = await opacities(page);
  console.log('【K4 處理中】', JSON.stringify(busy));
  Object.entries(busy).forEach(([id, v]) => {
    expect(v.disabled, id + ' 處理中沒有 disabled（K1 的事，這裡只當前提）').toBe(true);
    expect(Number(v.opacity), id + ' 鎖住了卻沒有變淡（H1：看起來一樣）').toBeLessThan(1);
    // ⚠️ 只量「< 1」對下拉零鑑別力：Chrome 的預設樣式本來就把 disabled 的 select 設成 0.7
    //    （拿掉本頁那條 CSS 實測 sn-idx／sn-year 仍是 0.7、按鈕是 1）——而 YU 的 LINE（iOS WebKit）上下拉沒變淡。
    //    ⇒ 釘本頁自己那條的值，不靠瀏覽器預設。
    expect(v.opacity, id + ' 不是本頁 :disabled 規則的值（只靠瀏覽器預設，換一個瀏覽器就沒了）').toBe('0.45');
  });

  await page.screenshot({ path: 'test-results/k4-stats-處理中灰掉.png', fullPage: true });

  release();
  await expect(page.locator('#sn-msg')).toHaveText('已儲存。', { timeout: 8000 });
  const after = await opacities(page);
  Object.entries(after).forEach(([id, v]) => {
    expect(v.disabled, id).toBe(false);
    expect(v.opacity, id + ' 解鎖後仍是淡的').toBe('1');
  });

  expect(errors).toEqual([]);
  expect(external, '有請求打到本機以外').toEqual(external.filter((u) => /static\.line-scdn\.net|script\.google\.com/.test(u)));
  expect(sendCount(sent), '送出了發送類 action：' + sent.join(' | ')).toBe(0);
});
