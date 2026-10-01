/**
 * #129（jdc-tw-migration）：資深夥伴範本寫入回應附清單 ⇒ 寫入後不再打 getSeniorNotice。真 Chrome。
 *
 * 來源：驗證軌 2026-10-01 的自寫 e2e（issuecomment-5926451719，V1–V4），由施工軌收進 repo，並補：
 *   V4 等待期間鎖仍鎖著、最後的訊息欄；⬛ 突變「snApplyList 不排隊」⇒ V4 紅（頁面原始碼在記憶體裡改，經 route 送出）。
 *
 * 🔴 V4 為何存在：改版初版的 snApplyList 不排隊、直接畫；比寫入**早發出**的讀取（發送後的 snLoad）
 *    晚回來時，用寫入前的清單把剛畫好的寫入後清單蓋掉——已刪的那則又出現、「已刪除。」被清掉。
 *    main 的 snReload 走 queueRead，天生排在後面，所以 main 不會。
 *
 * ⚠️ 手法照 `stats-e1b.spec.js`：擋掉真的 LIFF SDK、所有 `/exec` 本機假回應、非本機請求一律攔下。
 *    發送（sendSeniorNotice）只有假回應，不會讓任何人的手機響。
 */
const { test, expect } = require('@playwright/test');

const LIFF_STUB = `window.liff = {
  init: function(){ return Promise.resolve(); }, isLoggedIn: function(){ return true; },
  getIDToken: function(){ return 'IDTOK'; }, getDecodedIDToken: function(){ return { sub: 'U_sub_1' }; },
  login: function(){}, logout: function(){}, closeWindow: function(){}, openWindow: function(){},
  getOS: function(){ return 'ios'; }, isInClient: function(){ return true; }, getVersion: function(){ return '2.0.0'; }
};`;
const ROWS = [{ id: 'A1', name: '中秋餐會', status: '開放', open: true, replies: 7, deadline: '2026/09/15', eventDate: '2026/09/20' }];
const STATS = { ok: true, who: '佳岑', activity: { id: 'A1', name: '中秋餐會', status: '開放', eventDate: '2026/09/20', deadlineText: '2026/09/15' },
  counts: { attend: 1, absent: 0, boundNoReply: 0, notBound: 0, total: 1, replied: 1, meat: 1, veg: 0 }, opinions: [], absentList: [], boundNoReply: [], notBound: [] };
const AUD = [{ status: 'ok', userId: 'U1', name: '己', unit: '工務', years: 10, date: '' },
  { status: 'ok', userId: 'U2', name: '庚', unit: '總務', years: 10, date: '' }];
const DIS0 = [{ id: 'uuid-d', title: '開頁前停用', disabledAt: '2026-09-01T00:00:00.000Z' }];
const SENIOR = { ok: true, year: 2026, years: [2027, 2026, 2025, 2024], ids: ['uuid-a', 'uuid-b'], titles: ['十年', '二十年'],
  templates: ['恭喜甲', '恭喜乙'], status: ['unsent', 'sent'], audience: AUD, disabled: DIS0 };
const listOf = (s) => ({ ids: s.ids, titles: s.titles, templates: s.templates, disabled: s.disabled });

async function setup(page, handler, html) {
  if (html) await page.route(/\/stats\.html/, (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }));
  const calls = [], external = [], errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.type() === 'prompt' ? d.accept('新的一則') : d.accept());
  await page.route((url) => url.hostname !== '127.0.0.1', async (route) => { external.push(route.request().url()); await route.abort(); });
  await page.route(/static\.line-scdn\.net/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  await page.addInitScript(LIFF_STUB);
  await page.route(/script\.google\.com/, async (route) => {
    const u = new URL(route.request().url());
    const a = u.searchParams.get('action');
    let body;
    if (a === 'batch') {
      const results = {};
      JSON.parse(u.searchParams.get('list') || '[]').forEach((it) => {
        calls.push(it.a);
        results[it.a] = it.a === 'listActivities' ? { ok: true, rows: ROWS } : it.a === 'getActivityStats' ? STATS
          : it.a === 'getSeniorNotice' ? SENIOR : { ok: true, rows: [] };
      });
      body = { ok: true, results };
    } else { calls.push(a); body = await handler(a, u, calls); }
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: 'cb(' + JSON.stringify(body) + ')' });
  });
  await page.goto('/stats.html?act=A1');
  await page.locator('#tabbtn-staff').click();
  await expect(page.locator('#sn-idx option')).toHaveCount(2, { timeout: 8000 });
  return { calls, external, errors };
}
const count = (calls, a) => calls.filter((x) => x === a).length;
const opts = (page) => page.$$eval('#sn-idx option', (os) => os.map((o) => o.value));
const disIds = (page) => page.evaluate(() => (window.SN && SN.disabled || []).map((d) => d.id));
async function opac(page) {
  return page.evaluate(() => ['sn-add', 'sn-del', 'sn-save', 'sn-send', 'sn-idx', 'sn-year'].map((id) => getComputedStyle(document.getElementById(id)).opacity)
    .concat([].slice.call(document.querySelectorAll('#sn-dis-list button')).map((b) => getComputedStyle(b).opacity)));
}

test('V1 刪除→恢復（H1 情境）：各 1 發、getSeniorNotice 0 發、處理中與變淡照舊、勾選保留、狀態沿用', async ({ page }) => {
  let release; let held = new Promise((r) => { release = r; });
  let cur = JSON.parse(JSON.stringify(SENIOR));
  const env = await setup(page, async (a) => {
    if (a === 'getSeniorNotice') return SENIOR;
    if (a === 'removeSeniorTemplate') { await held; cur = { ...cur, ids: ['uuid-a'], titles: ['十年'], templates: ['恭喜甲'], disabled: DIS0.concat([{ id: 'uuid-b', title: '二十年', disabledAt: 'x' }]) }; return { ok: true, list: listOf(cur) }; }
    if (a === 'restoreSeniorTemplate') { await held; cur = { ...cur, ids: ['uuid-a', 'uuid-b'], titles: ['十年', '二十年'], templates: ['恭喜甲', '恭喜乙'], disabled: DIS0 }; return { ok: true, id: 'uuid-b', idx: 1, list: listOf(cur) }; }
    return { ok: true, rows: [] };
  });
  const gsn0 = count(env.calls, 'getSeniorNotice');
  await page.evaluate(() => { document.querySelector('.sn-ck[data-uid="U1"]').checked = true; });
  await page.selectOption('#sn-idx', 'uuid-b');
  await page.locator('#sn-del').click();
  await expect(page.locator('#sn-msg')).toHaveText('處理中…');
  const busy = await opac(page);
  expect(busy.every((o) => o === '0.45'), 'busy opacity ' + busy).toBe(true);
  release();
  await expect(page.locator('#sn-msg')).toHaveText('已刪除。', { timeout: 8000 });
  expect(await opts(page)).toEqual(['uuid-a']);
  expect(await disIds(page)).toEqual(['uuid-d', 'uuid-b']);
  expect((await opac(page)).every((o) => o === '1')).toBe(true);
  // 恢復 uuid-b（刪除前讀過它的狀態 sent）
  held = new Promise((r) => { release = r; });
  await page.locator('#sn-dis-list button').nth(1).click();
  await expect(page.locator('#sn-msg')).toHaveText('處理中…');
  expect((await opac(page)).every((o) => o === '0.45')).toBe(true);
  release();
  await expect(page.locator('#sn-msg')).toHaveText('已恢復。', { timeout: 8000 });
  expect(await opts(page)).toEqual(['uuid-a', 'uuid-b']);
  expect(await page.locator('#sn-idx').inputValue()).toBe('uuid-b');
  await expect(page.locator('#sn-sent')).toHaveText(/已經發送過/);
  expect(await page.evaluate(() => document.querySelector('.sn-ck[data-uid="U1"]').checked), '勾選被清掉').toBe(true);
  expect(count(env.calls, 'removeSeniorTemplate')).toBe(1);
  expect(count(env.calls, 'restoreSeniorTemplate')).toBe(1);
  expect(count(env.calls, 'getSeniorNotice') - gsn0, 'K1：寫入後又打了 getSeniorNotice').toBe(0);
  expect(env.errors).toEqual([]);
  expect(env.external.filter((u) => !/static\.line-scdn\.net|script\.google\.com/.test(u))).toEqual([]);
});

test('V2 保守退回：恢復「開頁前就停用」的那則 ⇒ 重讀整區（getSeniorNotice +1），等待中不顯示成未發送', async ({ page }) => {
  let releaseRead; const readHeld = new Promise((r) => { releaseRead = r; });
  let n = 0;
  const after = { ...SENIOR, ids: ['uuid-a', 'uuid-b', 'uuid-d'], titles: ['十年', '二十年', '開頁前停用'], templates: ['恭喜甲', '恭喜乙', '舊'], status: ['unsent', 'sent', 'sent'], disabled: [] };
  const env = await setup(page, async (a) => {
    if (a === 'getSeniorNotice') { n++; await readHeld; return after; }
    if (a === 'restoreSeniorTemplate') return { ok: true, id: 'uuid-d', idx: 2, list: listOf(after) };
    return { ok: true, rows: [] };
  });
  const gsn0 = count(env.calls, 'getSeniorNotice');
  await page.locator('#sn-dis-list button').first().click();
  await expect.poll(() => n).toBe(1);
  // 重讀還沒回：畫面不可以已經出現 uuid-d（那表示用了猜的狀態）
  expect(await opts(page)).toEqual(['uuid-a', 'uuid-b']);
  await expect(page.locator('#sn-msg')).toHaveText('處理中…');
  releaseRead();
  await expect(page.locator('#sn-msg')).toHaveText('已恢復。', { timeout: 8000 });
  expect(await page.locator('#sn-idx').inputValue()).toBe('uuid-d');
  await expect(page.locator('#sn-sent')).toHaveText(/已經發送過/);
  expect(count(env.calls, 'getSeniorNotice') - gsn0).toBe(1);
  expect(env.errors).toEqual([]);
});

test('V3 新增：1 發、getSeniorNotice 0 發、選到新的一則、狀態未發送', async ({ page }) => {
  const env = await setup(page, async (a) => {
    if (a === 'getSeniorNotice') return SENIOR;
    if (a === 'addSeniorTemplate') return { ok: true, id: 'uuid-new', idx: 2, list: { ids: ['uuid-a', 'uuid-b', 'uuid-new'], titles: ['十年', '二十年', '新的一則'], templates: ['恭喜甲', '恭喜乙', ''], disabled: DIS0 } };
    return { ok: true, rows: [] };
  });
  const gsn0 = count(env.calls, 'getSeniorNotice');
  await page.locator('#sn-add').click();
  await expect(page.locator('#sn-msg')).toHaveText('已新增，內容還是空的。', { timeout: 8000 });
  expect(await page.locator('#sn-idx').inputValue()).toBe('uuid-new');
  await expect(page.locator('#sn-sent')).toHaveText('');
  expect(count(env.calls, 'addSeniorTemplate')).toBe(1);
  expect(count(env.calls, 'getSeniorNotice') - gsn0).toBe(0);
  expect(env.errors).toEqual([]);
});

/**
 * V4 情境：發送（假回應）→ 發送後的 snLoad 重讀被卡住 → 刪除 uuid-b（回應附刪除後清單）→ 等待期間量鎖 → 放行那支舊重讀。
 * 回最後的下拉、訊息欄、等待期間的量測。`html` 給了就用改過的頁面原始碼。
 */
async function v4(page, html) {
  let releaseRead; const readHeld = new Promise((r) => { releaseRead = r; });
  let n = 0;
  const post = { ...SENIOR, ids: ['uuid-a'], titles: ['十年'], templates: ['恭喜甲'], status: ['sent'], disabled: DIS0.concat([{ id: 'uuid-b', title: '二十年', disabledAt: 'x' }]) };
  const env = await setup(page, async (a) => {
    if (a === 'sendSeniorNotice') return { ok: true, sent: 1, skipped: 0, failed: 0 };
    if (a === 'getSeniorNotice') { n++; if (n === 1) { await readHeld; return { ...SENIOR, status: ['sent', 'sent'] }; } return post; }   // 第 1 發＝刪除前發出的重讀（舊清單）
    if (a === 'removeSeniorTemplate') return { ok: true, list: listOf(post) };
    return { ok: true, rows: [] };
  }, html);
  await page.evaluate(() => { document.querySelector('.sn-ck[data-uid="U1"]').checked = true; });
  await page.locator('#sn-send').click();             // confirm 自動按確定；送出是本機假回應
  await expect.poll(() => n).toBe(1);                 // 發送後的 snLoad 已發出、被卡住
  const closeBtn = page.locator('button', { hasText: /關閉|確定|知道了|OK/ }).last();
  if (await closeBtn.count()) await closeBtn.click();
  await page.selectOption('#sn-idx', 'uuid-b');
  await page.locator('#sn-del').click();
  await expect.poll(() => count(env.calls, 'removeSeniorTemplate')).toBe(1);
  await page.waitForTimeout(800);                     // 刪除的回應早已回來；舊重讀還卡著
  const waiting = { msg: await page.locator('#sn-msg').textContent(), opac: await opac(page),
    busy: await page.evaluate(() => SN_BUSY) };
  releaseRead();                                      // 舊清單最後才到
  await expect.poll(() => page.evaluate(() => SN_BUSY), { timeout: 8000 }).toBe(false);
  await page.waitForTimeout(500);
  return { env, n, waiting, final: await opts(page), msg: await page.locator('#sn-msg').textContent() };
}

test('V4 競態：背景重讀（發送後的 snLoad）還在飛時刪除 ⇒ 最後畫面是刪除後的清單、訊息是「已刪除。」；等待期間仍鎖著', async ({ page }) => {
  const r = await v4(page);
  console.log('【V4】', JSON.stringify({ final: r.final, msg: r.msg, n: r.n, waiting: r.waiting }));
  expect(count(r.env.calls, 'removeSeniorTemplate'), '刪除根本沒送出 ⇒ 本條沒測到競態').toBe(1);
  // 鎖：寫入早已回來，但排在舊重讀後面的重畫還沒畫 ⇒ 仍是處理中、全鎖（不可提早解鎖）
  expect(r.waiting.busy, '排隊等待期間提早解鎖了').toBe(true);
  expect(r.waiting.msg).toBe('處理中…');
  expect(r.waiting.opac.every((o) => o === '0.45'), '等待期間有控制項沒變淡：' + r.waiting.opac).toBe(true);
  expect(r.final, '刪除後的清單被較早發出的重讀蓋回去（已刪的那則又出現在下拉）').toEqual(['uuid-a']);
  expect(r.msg, '「已刪除。」被較早發出的重讀清掉').toBe('已刪除。');
  expect(r.n, '多打了 getSeniorNotice（排隊不可以多打一發）').toBe(1);
  expect(r.env.errors).toEqual([]);
  expect(r.env.external.filter((u) => !/static\.line-scdn\.net|script\.google\.com/.test(u))).toEqual([]);
});

test('⬛ 突變：snApplyList 不排隊（直接畫）⇒ V4 紅（已刪的又回到下拉）', async ({ page }) => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'stats.html'), 'utf8');
  const from = '  return queueRead(function(){\n    if(!SN)return snReloadNow(y,selectKey,okMsg);';
  expect(src.split(from).length - 1, '突變沒套上（原文不是恰好一處）').toBe(1);
  const html = src.split(from).join('  return Promise.resolve().then(function(){\n    if(!SN)return snReloadNow(y,selectKey,okMsg);');
  const r = await v4(page, html);
  console.log('【V4 突變】', JSON.stringify({ final: r.final, msg: r.msg }));
  expect(count(r.env.calls, 'removeSeniorTemplate'), '刪除沒送出 ⇒ 突變沒有被量到').toBe(1);
  expect(r.final, '不排隊卻沒被蓋回去 ⇒ V4 量不到它要量的東西').toEqual(['uuid-a', 'uuid-b']);
});
