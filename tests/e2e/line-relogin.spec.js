/**
 * `line.html` 登入過期時的三種時機（jdc-tw-migration#114）——e2e。
 *
 * ══ 為什麼非得是 e2e ═══════════════════════════════════════════════════
 *
 * 自動重登＝`liff.login()`＝**整頁導走**。勾選與編到一半的文字是記憶體裡的東西，
 * 導走就沒了，**而且畫面上一句錯誤訊息都沒有**。vm 那一層的 `liff.login` 不導頁，
 * 「勾選還在」在那裡恆真。所以這裡的 `liff.login` 替身做**真的整頁導向**
 * （`location.assign`），計數器住 `sessionStorage` 以便活過那一次導向
 * （做法同 `authz-relogin.spec.js`）。
 *
 * ⚠️ 本檔驗不到「LINE 真的收下轉址並發了新憑證」（K5，要真人在正式網域做）。
 *
 * ══ 守什麼 ═══════════════════════════════════════════════════════════════
 *   K1 (a) 開頁就過期 ⇒ 自動重登一次、回來名單載得出
 *   K2 (b) 勾了 N 人＋換範本＋改文字 ⇒ 自動重登 ⇒ 回來 N 人與文字**逐一相同**
 *   K3 (c) 輸碼／送出中 ⇒ **不自動導走**；按鈕重登 ⇒ 回來勾選與內容還在
 * ⬛ 每一條「還在」都配一條「整頁導走時真的不見了」的對照，證明量得到「不見」。
 *
 * 夾具**全部是假的**（本 repo 公開）。
 */
const { test, expect } = require('@playwright/test');

const ROWS = [
  { empNo: 'A001', name: '測試甲', unit: '工務部', status: 'ok' },
  { empNo: 'A002', name: '測試乙', unit: '工務部', status: 'ok' },
  { empNo: 'A003', name: '測試丙', unit: '工務部', status: 'no_email' },
  { empNo: 'B001', name: '測試丁', unit: '管理部', status: 'ok' },
  { empNo: 'B002', name: '測試戊', unit: '管理部', status: 'unbound' },
  { empNo: 'C001', name: '測試己', unit: '企劃部', status: 'ok' },
];
const 名單 = (rows) => ({ ok: true, rows: rows || ROWS, audienceRev: 'REV1',
  counts: { ok: 4, unbound: 1, no_email: 1, ambiguous: 0 } });
const 範本 = { ok: true, items: [
  { templateId: 't1', title: '端午節禮金發放', text: '{姓名}端午快樂' },
  { templateId: 't2', title: '中秋節祝福', text: '{姓名}中秋快樂' }] };

const DEFAULTS = {
  getWelfareAudience: 名單(),
  getWelfareTemplates: 範本,
  getWelfareStatus: { ok: true, state: 'unsent', lastSentAt: '', sentCount: 0, failedCount: 0 },
  requestWelfareOtp: { ok: true, count: 3, sentTo: 'te***@example.tw', resent: true },
  saveWelfareTemplate: { ok: true },
  sendWelfareBroadcast: { ok: true, state: 'sent', sentCount: 3, failedCount: 0,
    recordingFailed: false, msg: '已送出 3 則。' },
};
/** 後端 `GATE_REJECT` 裡「重新登入會有用」的那一類（原文照後端的語氣：叫她找資訊人員）。 */
const 死憑證 = { ok: false, reason: 'line_bad_token',
  msg: '您的 LINE 登入憑證已經過期。重新整理或關掉這一頁重新開啟都不會解決，請聯絡資訊人員。' };
const 重登沒用的 = { ok: false, reason: 'role_mismatch', msg: '您沒有這個功能的權限。' };

/**
 * 掛好攔截再開頁。**儀器一律早於被測事件**。
 * @param {object} [o.回應] action → 物件｜函式(params, 第幾次)。`{__delayMs, body}` 延遲。
 * @param {boolean} [o.試過了] 先種好防迴圈旗標
 */
async function open(page, o) {
  o = o || {};
  const n = {};
  await page.route(/static\.line-scdn\.net/, (r) => r.abort('failed'));
  await page.route(/script\.google\.com/, async (route) => {
    const params = {};
    new URLSearchParams(route.request().postData() || '').forEach((v, k) => { params[k] = v; });
    const a = params.action;
    n[a] = (n[a] || 0) + 1;
    let v = (o.回應 || {})[a];
    if (typeof v === 'function') v = v(params, n[a]);
    if (v === undefined) v = DEFAULTS[a] || { ok: true };
    if (v && v.__delayMs) { await new Promise((r) => setTimeout(r, v.__delayMs)); v = v.body; }
    await route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8',
      body: 'cb(' + JSON.stringify(v) + ')' });
  });
  await page.addInitScript((試過了) => {
    const bump = (k) => {
      try { sessionStorage.setItem(k, String(Number(sessionStorage.getItem(k) || 0) + 1)); } catch (e) {}
    };
    if (試過了) { try { sessionStorage.setItem('JDC_RELOGIN_TRIED', '1'); } catch (e) {} }
    window.liff = {
      init: () => Promise.resolve(),
      isLoggedIn: () => true,
      getIDToken: () => ('eyJhbGciOiJIUzI1NiJ9.' + 'A'.repeat(900) + '.c2lnbmF0dXJl'),
      logout: () => bump('T114_logout'),
      login: (a) => {
        bump('T114_login');
        const u = (a && a.redirectUri) || location.href;
        try { sessionStorage.setItem('T114_redirect', u); } catch (e) {}
        location.assign(u);                 // **真的**導走
      },
    };
  }, !!o.試過了);
  await page.goto(o.網址 || '/line.html');
  return { n };
}

async function 副作用(page) {
  return page.evaluate(() => ({
    logout: Number(sessionStorage.getItem('T114_logout') || 0),
    login: Number(sessionStorage.getItem('T114_login') || 0),
    redirect: sessionStorage.getItem('T114_redirect') || '',
    覆蓋層: (document.getElementById('relogin-overlay') || {}).textContent || '',
  }));
}

async function 等名單(page) {
  await page.waitForSelector('#unit-tiles .tile');
  await expect(page.locator('#wf-tpl-list option')).toHaveCount(2);
}

/** 勾第 i 個人：先點開他的單位（用 data-unit，不用位置推），再真的點。 */
async function pick(page, i) {
  const u = await page.evaluate((i) =>
    document.getElementById('cb-' + i).closest('details.grp').getAttribute('data-unit'), i);
  const tile = page.locator(`#unit-tiles .tile[data-unit="${u}"]`);
  if ((await tile.getAttribute('aria-pressed')) !== 'true') await tile.click();
  await page.locator('#cb-' + i).check();
}

/** 目前勾了誰（員編，排序過）。含藏起來的單位。 */
const 勾了誰 = (page) => page.evaluate(() => ROWS.filter((r, i) => {
  const cb = document.getElementById('cb-' + i); return cb && cb.checked;
}).map((r) => r.empNo).sort());

/** (b) 的起手：跨兩個單位勾三人、換到第二則範本、改文字。 */
async function 勾人換範本改文字(page) {
  await pick(page, 0); await pick(page, 1); await pick(page, 3);
  await page.selectOption('#wf-tpl-list', 't2');
  await page.locator('#wf-tpl').fill('{姓名}中秋編到一半');
  expect(await 勾了誰(page), '⬛ 零點：連勾都沒勾上 ⇒ 下面什麼都沒量到').toEqual(['A001', 'A002', 'B001']);
}

/* ══ ⬛ 對照：這把尺量得到「不見了」 ═══════════════════════════════════ */

test('⬛ 對照：沒有保存時整頁導走 ⇒ 勾選與文字真的不見（證明下面的「還在」不是恆真）', async ({ page }) => {
  await open(page);
  await 等名單(page);
  await 勾人換範本改文字(page);
  await page.evaluate(() => location.assign(location.href));
  await 等名單(page);
  expect(await 勾了誰(page)).toEqual([]);
  await expect(page.locator('#wf-tpl')).toHaveValue('{姓名}端午快樂');
});

/* ══ K1 (a) 開頁就過期 ══════════════════════════════════════════════ */

test('K1 🔴 開頁載名單就過期 ⇒ 自動重登一次（保 query），回來名單載得出', async ({ page }) => {
  await open(page, { 網址: '/line.html?probe=T114',
    回應: { getWelfareAudience: (p, k) => (k === 1 ? 死憑證 : 名單()) } });
  await 等名單(page);                              // 第二次載入（重登回來）才會畫得出來
  const s = await 副作用(page);
  expect(s.logout, '🔴 開頁過期卻沒有自動重登 ⇒ 又是那句死路紅字').toBe(1);
  expect(s.login).toBe(1);
  expect(s.redirect).toContain('probe=T114');
  await expect(page.locator('#audience-note')).toHaveText('');
});

test('K1 ⬛ 同一個分頁已經試過 ⇒ 不再自動導頁，改講實話（不是迴圈）', async ({ page }) => {
  await open(page, { 試過了: true, 回應: { getWelfareAudience: 死憑證 } });
  await page.waitForTimeout(1200);
  const s = await 副作用(page);
  expect(s.logout).toBe(0);
  expect(s.覆蓋層).toContain('已經自動幫您重新登入過一次');
});

test('K1 ⬛ 對照：重登沒用的代號 ⇒ 不重登', async ({ page }) => {
  await open(page, { 回應: { getWelfareAudience: 重登沒用的 } });
  await page.waitForTimeout(1200);
  const s = await 副作用(page);
  expect(s.logout).toBe(0);
  expect(s.login).toBe(0);
});

/* ══ K2 (b) 勾了人、還沒寄碼 ════════════════════════════════════════ */

/** 按「儲存範本」時過期（這一刻手上有勾選＋換過的範本＋未存文字）。 */
async function K2流程(page, 回來的名單, 延遲) {
  await open(page, { 回應: {
    saveWelfareTemplate: 死憑證,
    getWelfareAudience: (p, k) => {
      const body = k === 1 ? 名單() : 名單(回來的名單);
      return (k > 1 && 延遲 === '名單慢') ? { __delayMs: 800, body } : body;
    },
    getWelfareTemplates: (p, k) =>
      ((k > 1 && 延遲 === '範本慢') ? { __delayMs: 800, body: 範本 } : 範本),
  } });
  await 等名單(page);
  await 勾人換範本改文字(page);
  await page.locator('#btn-save').click();
  await expect.poll(async () => (await 副作用(page)).login).toBe(1);
  await 等名單(page);
  await expect(page.locator('#restore-note')).not.toHaveText('');
}

test('K2 🔴 勾 3 人＋換範本＋改文字 ⇒ 自動重登回來，3 人與文字逐一相同', async ({ page }) => {
  await K2流程(page);
  const s = await 副作用(page);
  expect(s.logout, '(b) 應該自動重登').toBe(1);
  expect(await 勾了誰(page), '🔴 重登回來勾選不一樣了').toEqual(['A001', 'A002', 'B001']);
  await expect(page.locator('#wf-tpl-list')).toHaveValue('t2');
  await expect(page.locator('#wf-tpl')).toHaveValue('{姓名}中秋編到一半');
  await expect(page.locator('#picked-n')).toHaveText('已選 3 人');
  await expect(page.locator('#restore-note')).toContainText('已還原重新登入前的勾選 3 人');
  await expect(page.locator('#btn-save'), '放回的文字沒被當成未存修改').toBeEnabled();
  await expect(page.locator('#btn-otp'), '未存修改卻可以寄碼').toBeDisabled();
});

for (const 延遲 of ['名單慢', '範本慢']) {
  test(`K2 🔴 重繪順序（${延遲}）：還原不可以被後到的名單／範本蓋掉`, async ({ page }) => {
    await K2流程(page, undefined, 延遲);
    await page.waitForTimeout(1000);                 // 等所有後到的回應都落地
    expect(await 勾了誰(page)).toEqual(['A001', 'A002', 'B001']);
    await expect(page.locator('#wf-tpl-list')).toHaveValue('t2');
    await expect(page.locator('#wf-tpl')).toHaveValue('{姓名}中秋編到一半');
  });
}

test('K2 🔴 回來的名單換了順序 ⇒ 仍是同一批人（用員編認人，不用位置）', async ({ page }) => {
  await K2流程(page, ROWS.slice().reverse());
  expect(await 勾了誰(page)).toEqual(['A001', 'A002', 'B001']);
});

test('K2 🔴 回來的名單少了一個人 ⇒ 點名說沒還原誰，不可靜默少人', async ({ page }) => {
  await K2流程(page, ROWS.filter((r) => r.empNo !== 'B001'));
  expect(await 勾了誰(page)).toEqual(['A001', 'A002']);
  await expect(page.locator('#restore-note')).toContainText('勾了 3 人，只還原了 2 人');
  await expect(page.locator('#restore-note')).toContainText('測試丁（不在名單上）');
});

/* ══ K3 (c) 已取得驗證碼 ════════════════════════════════════════════ */

async function 取得驗證碼(page) {
  await pick(page, 0); await pick(page, 3);
  await page.locator('#btn-otp').click();
  await expect(page.locator('#otp-box')).toBeVisible();
  await page.locator('#otp-input').fill('123456');
  await expect(page.locator('#btn-send')).toBeEnabled();
}

test('K3 🔴 輸碼後送出時過期 ⇒ 不自動導走；按鈕重登 ⇒ 回來勾選還在、提醒重寄碼', async ({ page }) => {
  await open(page, { 回應: { sendWelfareBroadcast: 死憑證 } });
  await 等名單(page);
  await 取得驗證碼(page);
  page.once('dialog', (d) => d.accept());
  await page.locator('#btn-send').click();
  await expect(page.locator('#relogin-box')).toBeVisible();
  await page.waitForTimeout(1200);
  const s = await 副作用(page);
  // 🔴 先斷言勾選還在（目的），再斷言沒登出（成因）——同 authz-relogin 的理由
  expect(await 勾了誰(page), '🔴 輸碼中被整頁導走，勾選不見了').toEqual(['A001', 'B001']);
  expect(s.logout, '🔴 (c) 自動導走了').toBe(0);
  await expect(page.locator('#relogin-msg')).toContainText('已保存你的勾選（2 人）');
  await expect(page.locator('#relogin-msg')).toContainText('驗證碼回來之後不能再用');
  await expect(page.locator('#send-note')).not.toContainText('資訊人員');

  await page.locator('#btn-relogin').click();
  await expect.poll(async () => (await 副作用(page)).login).toBe(1);
  await 等名單(page);
  await expect(page.locator('#restore-note')).toContainText('已還原重新登入前的勾選 2 人');
  await expect(page.locator('#restore-note')).toContainText('驗證碼要重新寄一次');
  expect(await 勾了誰(page)).toEqual(['A001', 'B001']);
  expect((await 副作用(page)).logout).toBe(1);
  await expect(page.locator('#otp-box'), '驗證碼狀態被還原了（不該）').toBeHidden();
});

test('K3 🔴 反悔窗口內取消時過期 ⇒ 講「會照常送出」、送出回來前鈕不能按、不導走', async ({ page }) => {
  await open(page, { 回應: {
    sendWelfareBroadcast: (p) => (p.cancel ? 死憑證 : { __delayMs: 2500, body: DEFAULTS.sendWelfareBroadcast }),
  } });
  await 等名單(page);
  await 取得驗證碼(page);
  page.once('dialog', (d) => d.accept());
  await page.locator('#btn-send').click();
  await expect(page.locator('#cancel-box')).toBeVisible();
  await page.locator('#btn-cancel-send').click();
  await expect(page.locator('#send-note')).toContainText('照常送出');
  await expect(page.locator('#btn-relogin')).toBeDisabled();
  await expect(page.locator('#relogin-wait')).toContainText('不會取消');
  await expect(page.locator('#send-note')).toContainText('已送出 3 則', { timeout: 6000 });
  await expect(page.locator('#btn-relogin'), '送出回來了鈕還是不能按').toBeEnabled();
  expect((await 副作用(page)).logout).toBe(0);
});
