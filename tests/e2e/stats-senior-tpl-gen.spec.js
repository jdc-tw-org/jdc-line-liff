/**
 * #129 第三輪（jdc-tw-migration）：範本世代號＋W5 年度鍵。真 Chrome、所有 /exec 本機假回應、非本機請求一律攔下。
 * 發送（sendSeniorNotice）只有本機假回應，不會讓任何人的手機響。
 *
 * 來源：驗證軌第二輪自寫 e2e W1–W6（issuecomment-5926967077），施工軌收進 repo，並補：
 *   W3 另量快取（預取批次會把寫入前的清單存進快取；排隊讓寫入後的清單最後存）、
 *   ⬛ 突變：「回來時不比世代」⇒ W3 紅；「不排隊」⇒ W3 快取那格紅；W5 改回第二輪的寫法 ⇒ W5 紅。
 * 頁面突變一律在記憶體裡改原始碼、經 route 送出，不碰真檔。
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
const AUD25 = [{ status: 'ok', userId: 'U9', name: '辛', unit: '企劃', years: 20, date: '' }];
const DIS0 = [{ id: 'uuid-d', title: '開頁前停用', disabledAt: '2026-09-01T00:00:00.000Z' }];
const SENIOR = { ok: true, year: 2026, years: [2027, 2026, 2025, 2024], ids: ['uuid-a', 'uuid-b'], titles: ['十年', '二十年'],
  templates: ['恭喜甲', '恭喜乙'], status: ['unsent', 'sent'], audience: AUD, disabled: DIS0 };
const S25 = { ...SENIOR, year: 2025, status: ['sent', 'unsent'], audience: AUD25 };   // 2025 年度：同一份範本、不同狀態與名冊
const DEL_B = { ids: ['uuid-a'], titles: ['十年'], templates: ['恭喜甲'], disabled: DIS0.concat([{ id: 'uuid-b', title: '二十年', disabledAt: 'x' }]) };

// opt.holdSecond(): 回傳 promise 則把「含 getSeniorNotice 的批次」（第二發預取）卡住
async function setup(page, handler, opt) {
  opt = opt || {};
  if (opt.html) await page.route(/\/stats\.html/, (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: opt.html }));
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
      const list = JSON.parse(u.searchParams.get('list') || '[]');
      const results = {};
      list.forEach((it) => {
        calls.push('batch:' + it.a);
        results[it.a] = it.a === 'listActivities' ? { ok: true, rows: ROWS } : it.a === 'getActivityStats' ? STATS
          : it.a === 'getSeniorNotice' ? (opt.secondSenior ? opt.secondSenior() : SENIOR) : { ok: true, rows: [] };
      });
      if (list.some((it) => it.a === 'getSeniorNotice') && opt.holdSecond) { const h = opt.holdSecond(); if (h) await h; }
      body = { ok: true, results };
    } else { calls.push(a); body = await handler(a, u, calls); }
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: 'cb(' + JSON.stringify(body) + ')' }).catch(() => {});
  });
  await page.goto('/stats.html?act=A1');
  await page.locator('#tabbtn-staff').click();
  await expect(page.locator('#sn-idx option')).toHaveCount(2, { timeout: 8000 });
  return { calls, external, errors };
}
const count = (calls, a) => calls.filter((x) => x === a).length;
const opts = (page) => page.$$eval('#sn-idx option', (os) => os.map((o) => o.value));
async function opac(page) {
  return page.evaluate(() => ['sn-add', 'sn-del', 'sn-save', 'sn-send', 'sn-idx', 'sn-year'].map((id) => getComputedStyle(document.getElementById(id)).opacity)
    .concat([].slice.call(document.querySelectorAll('#sn-dis-list button')).map((b) => getComputedStyle(b).opacity)));
}
const deferred = () => { let r; const p = new Promise((res) => { r = res; }); return { p, release: r }; };

// ── W1：排隊期間（寫入已回、較早的讀取還卡著）鎖、處理中、0.45 都不提早解；重按不送第二發；放行後才解
test('W1 發送後背景讀取晚回：排隊期間全鎖、重按不送、最後是刪除後清單', async ({ page }) => {
  const rd = deferred(); let n = 0;
  const env = await setup(page, async (a) => {
    if (a === 'sendSeniorNotice') return { ok: true, sent: 1, skipped: 0, failed: 0 };
    if (a === 'getSeniorNotice') { n++; if (n === 1) { await rd.p; return { ...SENIOR, status: ['sent', 'sent'] }; } return { ...SENIOR, ...DEL_B, status: ['sent'] }; }
    if (a === 'removeSeniorTemplate') return { ok: true, list: DEL_B };
    return { ok: true, rows: [] };
  });
  await page.evaluate(() => { document.querySelector('.sn-ck[data-uid="U1"]').checked = true; });
  await page.locator('#sn-send').click();
  await expect.poll(() => n).toBe(1);
  const closeBtn = page.locator('button', { hasText: /關閉|確定|知道了|OK/ }).last();
  if (await closeBtn.count()) await closeBtn.click().catch(() => {});
  await page.selectOption('#sn-idx', 'uuid-b');
  await page.locator('#sn-del').click();
  await expect.poll(() => count(env.calls, 'removeSeniorTemplate')).toBe(1);
  await page.waitForTimeout(700);   // 寫入已回，排在背景讀取後面
  const mid = await page.evaluate(() => ({ busy: SN_BUSY, msg: document.getElementById('sn-msg').textContent }));
  const midOp = await opac(page);
  // 重按：直接呼叫入口（按鈕 disabled 時 click 不會送）＝驗 SN_BUSY 這一層
  await page.evaluate(() => { snDelTpl(); });
  await page.waitForTimeout(200);
  rd.release();
  await expect(page.locator('#sn-msg')).toHaveText('已刪除。', { timeout: 8000 });
  const fin = await opts(page);
  const finOp = await opac(page);
  console.log('【W1】mid', JSON.stringify(mid), 'midOp', midOp.join(','), 'final', JSON.stringify(fin), 'finOp', finOp.join(','), 'calls', JSON.stringify(env.calls.filter((c) => !c.startsWith('batch:'))));
  expect(mid.busy, '排隊期間 SN_BUSY 提早解').toBe(true);
  expect(mid.msg).toBe('處理中…');
  expect(midOp.every((o) => o === '0.45'), '排隊期間變淡提早解 ' + midOp).toBe(true);
  expect(count(env.calls, 'removeSeniorTemplate'), '排隊期間重按送出了第二發').toBe(1);
  expect(fin).toEqual(['uuid-a']);
  expect(finOp.every((o) => o === '1')).toBe(true);
  expect(n, 'getSeniorNotice 應只有發送後那 1 發').toBe(1);
  expect(env.errors).toEqual([]);
});

// ── W2：切年度的背景讀取還在飛時刪除 ⇒ 最後是刪除後清單、年度與名冊是切過去的那年、狀態用那年的
test('W2 切年度背景讀取晚回：最後畫面＝刪除後清單＋2025 年度狀態，getSeniorNotice 只有切年度那 1 發', async ({ page }) => {
  const rd = deferred(); let yearReads = 0; const years = [];
  const env = await setup(page, async (a, u) => {
    if (a === 'getSeniorNotice') { yearReads++; years.push(u.searchParams.get('year')); if (yearReads === 1) { await rd.p; return S25; } return { ...S25, ...DEL_B, status: ['sent'] }; }   // 第 1 支＝切年度（寫入前發出、舊清單）；之後＝寫入後重讀
    if (a === 'removeSeniorTemplate') return { ok: true, list: DEL_B };
    return { ok: true, rows: [] };
  });
  await page.selectOption('#sn-year', '2025');
  await expect.poll(() => yearReads).toBe(1);
  await page.selectOption('#sn-idx', 'uuid-b');
  await page.locator('#sn-del').click();
  await expect.poll(() => count(env.calls, 'removeSeniorTemplate')).toBe(1);
  await page.waitForTimeout(700);
  const mid = await page.evaluate(() => ({ busy: SN_BUSY, msg: document.getElementById('sn-msg').textContent }));
  rd.release();
  await page.waitForTimeout(1500);
  const st = await page.evaluate(() => ({ year: SN && SN.year, ids: SN && SN.ids, status: SN && SN.status, msg: document.getElementById('sn-msg').textContent,
    ysel: document.getElementById('sn-year').value, people: [].slice.call(document.querySelectorAll('.sn-ck')).map((c) => c.dataset.uid), busy: SN_BUSY }));
  const fin = await opts(page);
  console.log('【W2】mid', JSON.stringify(mid), 'final', JSON.stringify(fin), JSON.stringify(st), 'years', years.join(','), 'gsn', yearReads);
  expect(mid.busy).toBe(true);
  expect(fin, '刪除後清單被切年度那支較早的讀取蓋回去').toEqual(['uuid-a']);
  expect(st.msg).toBe('已刪除。');
  expect(st.year).toBe(2025);
  expect(st.status, '狀態要是 2025 年度那支讀到的（uuid-a＝sent）').toEqual(['sent']);
  expect(st.people).toEqual(['U9']);
  expect(st.busy).toBe(false);
  expect(yearReads, '多打了 getSeniorNotice').toBe(1);
  expect(env.errors).toEqual([]);
});

// ── W3：開頁初載（第二發預取還在飛、畫面是快取）時刪除 ⇒ 預取晚回不可蓋掉刪除後清單
async function w3(page, html) {
  let hold = null;
  const env = await setup(page, async (a) => {
    if (a === 'getSeniorNotice') return { ...SENIOR, ...DEL_B, status: ['unsent'] };
    if (a === 'removeSeniorTemplate') return { ok: true, list: DEL_B };
    return { ok: true, rows: [] };
  }, { holdSecond: () => hold && hold.p, html });
  await page.waitForTimeout(500);   // 讓第一次的快取寫進去
  hold = deferred();
  await page.reload();
  await page.locator('#tabbtn-staff').click();
  await expect(page.locator('#sn-idx option')).toHaveCount(2, { timeout: 8000 });   // 快取秒顯
  const before = await page.evaluate(() => ({ second: typeof SECOND_DONE !== 'undefined' && SECOND_DONE, sn: !!SN }));
  await page.selectOption('#sn-idx', 'uuid-b');
  await page.locator('#sn-del').click();
  await expect.poll(() => count(env.calls, 'removeSeniorTemplate')).toBe(1);
  await page.waitForTimeout(700);
  const mid = await page.evaluate(() => ({ busy: SN_BUSY, msg: document.getElementById('sn-msg').textContent, opts: [].map.call(document.querySelectorAll('#sn-idx option'), (o) => o.value) }));
  hold.release();
  await page.waitForTimeout(1500);
  const fin = await opts(page);
  const st = await page.evaluate(() => ({ msg: document.getElementById('sn-msg').textContent, busy: SN_BUSY, snIds: SN && SN.ids }));
  console.log('【W3】before', JSON.stringify(before), 'mid', JSON.stringify(mid), 'final', JSON.stringify(fin), JSON.stringify(st), 'calls', JSON.stringify(env.calls));
  const cache = await page.evaluate(() => { const x = cacheGet(N.senior(String(currentTaipeiYear()))); return x && x.value.ids; });
  return { env, before, fin, st, cache };
}

test('W3 初載預取晚回（pick2 路徑）：快取秒顯時刪除，預取的舊清單不可蓋掉刪除後清單；快取也是刪除後的', async ({ page }) => {
  const { env, before, fin, st, cache } = await w3(page);
  expect(before.second, '前提：刪除時第二發預取還沒回').toBe(false);
  expect(fin, '刪除後清單被開頁時發出的預取（舊清單）蓋回去').toEqual(['uuid-a']);
  expect(st.snIds).toEqual(['uuid-a']);
  expect(st.msg).toBe('已刪除。');
  expect(cache, '下次開頁秒顯的快取是寫入前的清單（預取批次晚存、蓋掉寫入後的）').toEqual(['uuid-a']);
  expect(env.errors).toEqual([]);
});

// ── W4：保守退路在佇列裡（背景讀取卡著時恢復「開頁前就停用」那則）⇒ 不卡死、不重複送、getSeniorNotice 只多 1 發
test('W4 退路在佇列中：恢復開頁前停用那則＋背景讀取卡著 ⇒ 不卡死、restore 1 發、getSeniorNotice 共 2 發', async ({ page }) => {
  const rd = deferred(); let n = 0;
  const after = { ...SENIOR, ids: ['uuid-a', 'uuid-b', 'uuid-d'], titles: ['十年', '二十年', '開頁前停用'], templates: ['恭喜甲', '恭喜乙', '舊'], status: ['sent', 'sent', 'sent'], disabled: [] };
  const env = await setup(page, async (a) => {
    if (a === 'sendSeniorNotice') return { ok: true, sent: 1, skipped: 0, failed: 0 };
    if (a === 'getSeniorNotice') { n++; if (n === 1) { await rd.p; return { ...SENIOR, status: ['sent', 'sent'] }; } return after; }
    if (a === 'restoreSeniorTemplate') return { ok: true, id: 'uuid-d', idx: 2, list: { ids: after.ids, titles: after.titles, templates: after.templates, disabled: [] } };
    return { ok: true, rows: [] };
  });
  await page.evaluate(() => { document.querySelector('.sn-ck[data-uid="U1"]').checked = true; });
  await page.locator('#sn-send').click();
  await expect.poll(() => n).toBe(1);
  const closeBtn = page.locator('button', { hasText: /關閉|確定|知道了|OK/ }).last();
  if (await closeBtn.count()) await closeBtn.click().catch(() => {});
  await page.locator('#sn-dis-list button').first().click();
  await expect.poll(() => count(env.calls, 'restoreSeniorTemplate')).toBe(1);
  await page.waitForTimeout(500);
  const mid = await page.evaluate(() => ({ busy: SN_BUSY, msg: document.getElementById('sn-msg').textContent }));
  rd.release();
  await expect(page.locator('#sn-msg')).toHaveText('已恢復。', { timeout: 8000 });
  expect(await opts(page)).toEqual(['uuid-a', 'uuid-b', 'uuid-d']);
  expect(await page.locator('#sn-idx').inputValue()).toBe('uuid-d');
  await expect(page.locator('#sn-sent')).toHaveText(/已經發送過/);
  const busy = await page.evaluate(() => SN_BUSY);
  console.log('【W4】mid', JSON.stringify(mid), 'gsn', n, 'restore', count(env.calls, 'restoreSeniorTemplate'), 'busy', busy);
  expect(mid.busy).toBe(true);
  expect(busy).toBe(false);
  expect(n, 'getSeniorNotice＝發送後 1＋退路 1').toBe(2);
  expect(count(env.calls, 'restoreSeniorTemplate')).toBe(1);
  expect(env.errors).toEqual([]);
});

// ── W5：切年度讀取失敗後刪除 ⇒ 快取 getSeniorNotice:2025 不可存成 2026 年度的資料（觀察項）
async function w5(page, html) {
  let yr = 0;
  const env = await setup(page, async (a, u) => {
    if (a === 'getSeniorNotice') { yr++; if (u.searchParams.get('year') === '2025' && yr === 1) return { ok: false, msg: '訊息平台沒有回應' }; return { ...S25, ...DEL_B, status: ['sent'] }; }
    if (a === 'removeSeniorTemplate') return { ok: true, list: DEL_B };
    return { ok: true, rows: [] };
  }, { html });
  await page.selectOption('#sn-year', '2025');
  await expect.poll(() => yr).toBe(1);
  await page.waitForTimeout(500);
  await page.selectOption('#sn-idx', 'uuid-b');
  await page.locator('#sn-del').click();
  await expect(page.locator('#sn-msg')).toHaveText(/已刪除。|失敗/, { timeout: 8000 });
  await page.waitForTimeout(500);
  const c = await page.evaluate(() => { const x = cacheGet(N.senior('2025')); return x && { year: x.value.year, people: (x.value.audience || []).map((p) => p.userId), status: x.value.status }; });
  const sn = await page.evaluate(() => ({ year: SN && SN.year, ysel: document.getElementById('sn-year').value }));
  console.log('【W5】cache[2025]', JSON.stringify(c), 'SN', JSON.stringify(sn), 'gsn', yr);
  return { env, c, sn, yr };
}

test('W5 切年度讀取失敗後刪除：2025 的快取鍵存的是 2025 的資料（不是畫面上那份 2026）', async ({ page }) => {
  const { env, c } = await w5(page);
  expect(c && c.year, '快取鍵 2025 存成了別的年度').toBe(2025);
  expect(c.people).toEqual(['U9']);
  expect(env.errors).toEqual([]);
});

test('⬛ 突變：W5 改回第二輪寫法（不比年度、鍵取下拉的年度）⇒ W5 紅', async ({ page }) => {
  const html = mutated([
    ['    if(String(SN.year)!==String(y))return snReloadNow(y,selectKey,okMsg);\n', ''],
    ['    return cacheSave(FP,N.senior(String(SN.year)),SN);', '    return cacheSave(FP,N.senior(y),SN);'],
  ]);
  const { c } = await w5(page, html);
  console.log('【W5 突變】', JSON.stringify(c));
  expect(c && c.year, '改回去卻沒存錯年度 ⇒ W5 量不到').toBe(2026);
});

// ── W6（K3）：舊版後端回應沒有 list ⇒ 退回重讀整區（getSeniorNotice +1），畫的是重讀回來那份
test('W6 K3 舊版後端（無 list）：刪除後 getSeniorNotice +1、下拉＝重讀結果、訊息照舊', async ({ page }) => {
  let n = 0;
  const env = await setup(page, async (a) => {
    if (a === 'getSeniorNotice') { n++; return { ...SENIOR, ...DEL_B, status: ['unsent'] }; }
    if (a === 'removeSeniorTemplate') return { ok: true };
    return { ok: true, rows: [] };
  });
  await page.selectOption('#sn-idx', 'uuid-b');
  await page.locator('#sn-del').click();
  await expect(page.locator('#sn-msg')).toHaveText('已刪除。', { timeout: 8000 });
  console.log('【W6】gsn', n, 'opts', JSON.stringify(await opts(page)));
  expect(n, 'K3：沒有 list 時沒有退回重讀').toBe(1);
  expect(await opts(page)).toEqual(['uuid-a']);
  expect(env.errors).toEqual([]);
});

/* ── 突變對照（頁面原始碼在記憶體裡改，經 route 送出）───────────────────── */
const fs = require('node:fs');
const path = require('node:path');
const PAGE = fs.readFileSync(path.join(__dirname, '..', '..', 'stats.html'), 'utf8');
function mutated(pairs) {
  let s = PAGE;
  pairs.forEach(([from, to]) => {
    const n = s.split(from).length - 1;
    if (n !== 1) throw new Error('突變沒套上：原文出現 ' + n + ' 次：' + JSON.stringify(from));
    s = s.split(from).join(to);
  });
  return s;
}

test('⬛ 突變：回來時不比世代 ⇒ W3 紅（已刪的又回到下拉）', async ({ page }) => {
  const html = mutated([['  if(gen===SN_GEN||!r||!r.ok){renderSenior(r,selectKey);return;}', '  {renderSenior(r,selectKey);return;}']]);
  const r = await w3(page, html);
  console.log('【W3 突變：不比世代】', JSON.stringify({ fin: r.fin, msg: r.st.msg }));
  expect(r.before.second, '前提').toBe(false);
  expect(r.fin, '不比世代卻沒被蓋回去 ⇒ W3 量不到世代號').toEqual(['uuid-a', 'uuid-b']);
});

test('⬛ 突變：snApplyList 不排隊 ⇒ W3 的快取那格紅（畫面由世代號保住，快取順序只有排隊保得住）', async ({ page }) => {
  const html = mutated([['  return queueRead(function(){\n    if(!SN)return snReloadNow(y,selectKey,okMsg);',
    '  return Promise.resolve().then(function(){\n    if(!SN)return snReloadNow(y,selectKey,okMsg);']]);
  const r = await w3(page, html);
  console.log('【W3 突變：不排隊】', JSON.stringify({ fin: r.fin, cache: r.cache }));
  expect(r.before.second, '前提').toBe(false);
  expect(r.fin, '畫面仍由世代號保住').toEqual(['uuid-a']);
  expect(r.cache, '不排隊卻沒有讓快取存成寫入前的 ⇒ 快取那格量不到排隊').toEqual(['uuid-a', 'uuid-b']);
});

test('⬛ 突變：寫入成功不遞增世代 ⇒ W3 紅', async ({ page }) => {
  const html = mutated([['  SN_GEN++;   // 範本寫入成功', '  //SN_GEN++;   // 範本寫入成功']]);
  const r = await w3(page, html);
  console.log('【W3 突變：不遞增】', JSON.stringify({ fin: r.fin, msg: r.st.msg }));
  expect(r.before.second, '前提').toBe(false);
  expect(r.fin, '不遞增世代卻沒被蓋回去 ⇒ W3 量不到遞增').toEqual(['uuid-a', 'uuid-b']);
});

test('⬛ 突變：落後的讀取重畫名冊時清掉成功訊息 ⇒ W3 的訊息那格紅', async ({ page }) => {
  const html = mutated([['  renderSenior(m,undefined,true);', '  renderSenior(m,undefined,false);']]);
  const r = await w3(page, html);
  console.log('【W3 突變：清訊息】', JSON.stringify({ fin: r.fin, msg: r.st.msg }));
  expect(r.fin, '範本區仍由世代號保住').toEqual(['uuid-a']);
  expect(r.st.msg, '清了訊息卻沒被量到').not.toBe('已刪除。');
});
