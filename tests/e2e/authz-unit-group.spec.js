/**
 * `authz.html`：**「新增一列」的人員下拉按單位分組**（gas `#184` ／ liff `#60`，2026-09-18）。
 *
 * ══ 這一檔守什麼 ═══════════════════════════════════════════════════════
 *
 * 分組是**純呈現**。所以真正會害到人的不是「好不好看」，是兩件安靜的事：
 *
 *   🔴 ① **有人在下拉裡不見了。** 分組寫成「把有部門的挑出來畫」的話，部門欄空白的
 *        那幾位會靜靜消失——畫面上是一份看起來完全正常的清單，只是他要找的那個人
 *        選不到。**零錯誤訊息，人數也沒有任何地方寫出來。**
 *   🔴 ② **送出去的值變了。** `<option>` 的 `value` 仍然必須是內部碼。
 *        換成姓名或單位的話，加進草稿的那一列會帶著一個不存在的內部碼，
 *        而畫面上那一列**看起來完全正常**（姓名欄是對的）。
 *
 * ⇒ 判準因此是**人數守恆**與**加進草稿的那一格逐字是內部碼**，不是「有幾個 optgroup」。
 *
 * ══ ⚠️ 為什麼非得在真瀏覽器量不可 ═══════════════════════════════════════
 *
 * `tests/authz-page-wiring.test.js` 那個假 DOM 只看得到 `innerHTML` **字串**。
 * 「字串裡有 `<optgroup>`」與「瀏覽器真的把它剖析成一個分組、而且底下那幾顆
 * `<option>` 仍然選得到」是兩件事——`<optgroup>` 的巢狀寫錯（例如沒關閉）時，
 * 字串長得完全正確，而瀏覽器剖析出來的 `select.options` 會少人。
 * ⬛ 本檔量的是 `select.options`（瀏覽器剖析後的結果）與 `selectOption()`（真的去選），
 *   不是我丟進去的那串字。
 *
 * ══ ⚠️ 夾具的鑑別力：先辦這一件 ═══════════════════════════════════════
 *
 * 🔴 「全部同一個單位」或「同單位的人本來就相鄰」的夾具，**分不分組畫出來一模一樣**
 *    ⇒ 把分組整支弄壞，這一檔會全綠。（`#117` 與 `#133` 都各被這種夾具騙過一次。）
 * ⇒ 所以夾具刻意做三件事，**第一組測試不是判準、是對夾具本身的鑑別力證明**：
 *     ⒜ 兩個具名單位，而且同單位的人在名冊裡**不相鄰** ⇒ 分組真的得搬動人
 *     ⒝ 一個人的部門**空白** ⇒ 「沒有單位的人不准消失」量得到
 *     ⒞ 一個人的部門是**全空白字元** ⇒ 「不可以長出一個名字是空白的組」量得到
 *
 * ⚠️ **夾具全部是假的。`jdc-line-liff` 是 PUBLIC repo** ——內部碼是拿字母表造的假碼、
 *    姓名是「測試甲／乙／丙…」、單位是「測試單位甲／乙」。
 *    一格真實資料、一個真實姓名、一個真的內部識別碼、一個真的單位名都沒有。
 */
const { test, expect } = require('@playwright/test');

const HDR = ['內部碼', '角色', '狀態', '授予日', '停用日', '備註', '姓名'];
const 內 = 0;

const 碼 = {
  甲: 'JDC-AAAAAA', 乙: 'JDC-BBBBBB', 丙: 'JDC-CCCCCC',
  丁: 'JDC-DDDDDD', 戊: 'JDC-EEEEEE', 己: 'JDC-FFFFFF',
};
const 單位甲 = '測試單位甲', 單位乙 = '測試單位乙';

/**
 * ⒜ 名冊順序照後端（按內部碼遞增）；⒜ 同單位的人**故意交錯**：
 *    甲(甲單位) 乙(乙單位) 丙(甲單位) 丁(乙單位) 戊(空) 己(全空白)
 * ⇒ 分組後的順序是 甲丙 ／ 乙丁 ／ 戊己，**與名冊順序不同** ⇒ 排序真的發生了。
 */
const 名冊 = [
  { code: 碼.甲, name: '測試甲', unit: 單位甲 },
  { code: 碼.乙, name: '測試乙', unit: 單位乙 },
  { code: 碼.丙, name: '測試丙', unit: 單位甲 },
  { code: 碼.丁, name: '測試丁', unit: 單位乙 },
  { code: 碼.戊, name: '測試戊', unit: '' },
  { code: 碼.己, name: '測試己', unit: '   ' },
];

/** @param {{欄位?:boolean|undefined}} [o] `欄位` 就是後端的 `rosterUnitColumn`；`undefined` ＝不送這一格 */
function 名單(o) {
  o = o || {};
  const r = {
    ok: true, who: '測試甲', header: HDR.slice(),
    rows: [
      [碼.甲, 'admin', '有效', '2026-09-01', '', '', '測試甲'],
      [碼.乙, 'hr', '有效', '2026-09-01', '', '', '測試乙'],
    ],
    roster: 名冊.map((p) => Object.assign({}, p)),
    rosterCollisions: [],
    assignableRoles: ['admin', 'hr'],
    statusValues: ['有效', '停用'],
    rolePages: [
      { role: 'admin', label: '系統管理', pages: [{ page: 'p1', title: '測試頁一' }] },
      { role: 'hr', label: '人事異動', pages: [{ page: 'p1', title: '測試頁一' }] },
    ],
    current: { pass: true, rowCount: 2, adminCount: 1 },
  };
  if (Object.prototype.hasOwnProperty.call(o, '欄位')) r.rosterUnitColumn = o.欄位;
  return r;
}

/* ══════════════════════════════════════════════════════════════════════
 * 開頁面。**儀器一律早於被測事件**：console 監聽、route、initScript 都在 goto 之前。
 * ══════════════════════════════════════════════════════════════════════ */

async function open(page, o) {
  o = o || {};
  const 主控台 = [];
  page.on('console', (m) => {
    if (m.type() !== 'error' && m.type() !== 'warning') return;
    主控台.push({ 類: m.type(), 文: m.text(), 來源: ((m.location() || {}).url) || '' });
  });
  page.on('pageerror', (e) => 主控台.push({ 類: 'pageerror', 文: String(e && e.message), 來源: '' }));
  // 真 SDK 一律擋掉（用 RegExp 不用 glob——對不上的後果是真的 SDK 被載進來）。
  await page.route(/static\.line-scdn\.net/, (r) => r.abort('failed'));
  await page.route(/script\.google\.com/, (r) => {
    const body = String(r.request().postData() || '');
    const act = (body.match(/(?:^|&)action=([^&]*)/) || [])[1] || '';
    const v = act === 'getAuthzList' ? 名單(o) : { ok: true };
    r.fulfill({
      status: 200, contentType: 'text/javascript; charset=utf-8',
      body: 'cb(' + JSON.stringify(v) + ')',
    });
  });
  await page.addInitScript(() => {
    window.liff = {
      init: () => Promise.resolve({}), isLoggedIn: () => true,
      getIDToken: () => ('eyJhbGciOiJIUzI1NiJ9.' + 'A'.repeat(900) + '.c2lnbmF0dXJl'),
      logout: () => {}, login: () => {},
      isInClient: () => false, closeWindow: () => {}, openWindow: () => {},
    };
  });
  await page.goto('/authz.html');
  await expect(page.locator('#list .row').first()).toBeVisible();
  return 主控台;
}

/* ══════════════════════════════════════════════════════════════════════
 * 量法——全部量**瀏覽器剖析後的 DOM**，不量我丟進去的那串字
 * ══════════════════════════════════════════════════════════════════════ */

/** 下拉裡「選得到的人」：`select.options` 去掉空值那一顆。回 `{值, 字, 組}`。 */
const 人們 = (page) => page.evaluate(() => Array.from(document.getElementById('newcode').options)
  .filter((o) => o.value !== '')
  .map((o) => ({
    值: o.value,
    字: o.textContent,
    // 🔴 `parentElement` 是瀏覽器剖析出來的結果——`<optgroup>` 寫壞時它會是 `select`。
    組: o.parentElement && o.parentElement.tagName === 'OPTGROUP' ? o.parentElement.label : null,
  })));

/** 分組的名字，照它們在 DOM 裡的順序。 */
const 組們 = (page) => page.evaluate(() => Array.from(
  document.querySelectorAll('#newcode optgroup')).map((g) => g.label));

/**
 * 🔴 **只濾一種已知雜訊：本檔自己 `abort` 掉的 LINE SDK。**
 *    那條 `page.route(/static\.line-scdn\.net/, r => r.abort('failed'))` 必然讓瀏覽器
 *    印一則 `Failed to load resource: net::ERR_FAILED` ——**是儀器自己造的，不是產品的**。
 * ⚠️ **判準綁在來源網址上，不是綁在 `ERR_FAILED` 那串字上**：後者會把「真的有一個
 *    資源載不到」一起吞掉，而那正是這一條要抓的東西。
 * ⬛ 濾網有沒有在做事，由 `濾掉幾則` 當場對照——回 0 就代表這個濾網已經沒有意義了
 *    （SDK 沒被擋，或它不再印那一則），那時上面那句「零錯誤」的結論也要重新看。
 */
const 真錯誤 = (c) => c.filter((x) => !/line-scdn\.net/.test(x.來源));
const 濾掉幾則 = (c) => c.length - 真錯誤(c).length;

const 腳註 = (page) => page.evaluate(() => document.getElementById('foot').textContent);
const 草稿 = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window['草稿'])));

/* ══════════════════════════════════════════════════════════════════════
 * ⬛ 第一組：夾具與量法的鑑別力——先證明這把尺量得到東西
 * ══════════════════════════════════════════════════════════════════════ */

test('⬛ 零點：這把尺分得出「平的」與「分組的」（分不出來的話下面每一條都不算數）', async ({ page }) => {
  const 平 = await open(page, { 欄位: false });
  const a = await 人們(page);
  expect(await 組們(page), '⬛ 不分組的那一份竟然有 optgroup ⇒ 量法壞掉').toEqual([]);
  expect(a.every((o) => o.組 === null), '⬛ 不分組時 option 不該有 OPTGROUP 父節點').toBe(true);
  expect(真錯誤(平), '⬛ 零點那一輪 console 就有錯，下面量到的東西都不算數：\n'
    + JSON.stringify(平, null, 1)).toEqual([]);
  expect(濾掉幾則(平), '⬛ 對照：被濾掉的該**恰好**是那一則被擋掉的 LINE SDK。'
    + '回 0 ⇒ 這個濾網什麼都沒濾到，它的存在就不再是無害的了。實際收到：'
    + JSON.stringify(平)).toBe(1);
});

test('⬛ 鑑別力：分組真的搬動了人——名冊順序與下拉順序**不同**', async ({ page }) => {
  await open(page, { 欄位: true });
  const 序 = (await 人們(page)).map((o) => o.值);
  const 名冊序 = 名冊.map((p) => p.code);
  expect(名冊序.join(','),
    '⬛ 前置：夾具的名冊順序本來就得是交錯的，否則分不分組長得一樣')
    .toBe([碼.甲, 碼.乙, 碼.丙, 碼.丁, 碼.戊, 碼.己].join(','));
  expect(序.join(','),
    '🔴 分組後的順序與名冊順序相同 ⇒ 這份夾具對分組零鑑別力（`#117`／`#133` 都踩過）')
    .not.toBe(名冊序.join(','));
  expect(序.join(','), '🔴 分組後的順序不是「單位甲那兩個、單位乙那兩個、沒填的兩個」')
    .toBe([碼.甲, 碼.丙, 碼.乙, 碼.丁, 碼.戊, 碼.己].join(','));
});

/* ══════════════════════════════════════════════════════════════════════
 * 🔴 ① 人數守恆——分組前後選得到的人一模一樣
 * ══════════════════════════════════════════════════════════════════════ */

test('🔴 ① 人數守恆：分組前後，下拉裡選得到的人數與那一群人都一模一樣', async ({ page }) => {
  await open(page, { 欄位: false });
  const 平 = await 人們(page);
  await open(page, { 欄位: true });
  const 分 = await 人們(page);

  expect(平.length, '⬛ 前置：平的清單本來就該有 ' + 名冊.length + ' 個人').toBe(名冊.length);
  expect(分.length,
    '🔴 分組之後只剩 ' + 分.length + ' 個人（名冊 ' + 名冊.length + ' 個）⇒ 有人選不到了，'
    + '而畫面上看不出來。少的是：'
    + JSON.stringify(平.map((o) => o.值).filter((v) => !分.some((x) => x.值 === v))))
    .toBe(名冊.length);
  expect(分.map((o) => o.值).slice().sort(),
    '🔴 分組前後選得到的「那一群人」不是同一群').toEqual(平.map((o) => o.值).slice().sort());
});

test('🔴 ② 部門空白的人不准消失——他在「（未填部門）」那一組，而且那一組在最後', async ({ page }) => {
  await open(page, { 欄位: true });
  const g = await 組們(page);
  expect(g, '🔴 組序不是「單位照名冊出現順序、未填的墊底」').toEqual([單位甲, 單位乙, '（未填部門）']);
  const 人 = await 人們(page);
  const 戊 = 人.filter((o) => o.值 === 碼.戊)[0];
  expect(戊, '🔴 部門空白的那個人整個不見了').toBeTruthy();
  expect(戊.組, '🔴 部門空白的人跑到別組去了').toBe('（未填部門）');
  const 己 = 人.filter((o) => o.值 === 碼.己)[0];
  expect(己.組, '🔴 部門只有空白字元卻沒被當成沒填（會長出一個名字是空白的組）').toBe('（未填部門）');
  expect(g.filter((x) => x.replace(/\s/g, '') === ''), '🔴 長出了一個名字是空白的組').toEqual([]);
});

/* ══════════════════════════════════════════════════════════════════════
 * 🔴 ③ 送出去的值——分組是純呈現
 * ══════════════════════════════════════════════════════════════════════ */

test('🔴 ③ 每一顆 option 的 value 仍然是內部碼，顯示字仍然是姓名', async ({ page }) => {
  await open(page, { 欄位: true });
  const 人 = await 人們(page);
  名冊.forEach((p) => {
    const hit = 人.filter((o) => o.值 === p.code);
    expect(hit.length, '🔴 ' + p.code + ' 在下拉裡出現 ' + hit.length + ' 次（該是 1 次）').toBe(1);
    expect(hit[0].字, '🔴 ' + p.code + ' 的顯示字被換掉了').toBe(p.name);
  });
  人.forEach((o) => {
    expect(名冊.some((p) => p.code === o.值),
      '🔴 下拉裡多出一個不在名冊裡的 value：' + JSON.stringify(o.值)).toBe(true);
  });
});

test('🔴 ④ 真的去選一個「沒有部門」的人並按加進草稿 ⇒ 草稿那一格逐字是他的內部碼', async ({ page }) => {
  await open(page, { 欄位: true });
  const 之前 = (await 草稿(page)).length;
  // 🔴 走 `selectOption`（真的選）＋ 真的點「加進草稿」——不是去讀 innerHTML。
  await page.selectOption('#newcode', 碼.戊);
  await page.locator('#add').click();
  const d = await 草稿(page);
  expect(d.length, '🔴 選了一個沒有部門的人卻加不進草稿').toBe(之前 + 1);
  expect(d[之前][內],
    '🔴 加進草稿的內部碼不是他的——分組把送出去的值換掉了（這一列會給錯人權限）')
    .toBe(碼.戊);
  expect(d[之前][HDR.indexOf('姓名')], '🔴 姓名沒跟著帶進去').toBe('測試戊');
});

test('🔴 ⑤ 分組的那幾組裡的人也選得到（optgroup 巢狀寫壞時這一條會紅）', async ({ page }) => {
  await open(page, { 欄位: true });
  await page.selectOption('#newcode', 碼.丙);          // 單位甲，名冊裡排第 3 個
  await page.locator('#add').click();
  const d = await 草稿(page);
  expect(d[d.length - 1][內]).toBe(碼.丙);
});

/* ══════════════════════════════════════════════════════════════════════
 * 🔴 ⑥ 分組不成立的時候要講出來——不可以靜靜地變成一整串
 * ══════════════════════════════════════════════════════════════════════ */

test('🔴 ⑥ rosterUnitColumn:false ⇒ 退回平的清單，人不少，而且畫面上講得出原因', async ({ page }) => {
  await open(page, { 欄位: false });
  expect(await 組們(page), '名冊沒有部門欄卻還是分了組').toEqual([]);
  expect((await 人們(page)).length, '🔴 退回平的清單的時候人少了').toBe(名冊.length);
  expect(await 腳註(page),
    '🔴 名冊沒有部門欄 ⇒ 分組不會成立，而畫面上一個字都沒講').toContain('員工名冊沒有「部門」欄');
});

test('🔴 ⑦ 後端沒送 rosterUnitColumn（舊版）⇒ 也退回平的，但講的是另一句話', async ({ page }) => {
  await open(page, {});                                 // 刻意不帶 `欄位` ⇒ 回應裡沒有那一格
  expect(await 組們(page), '後端沒說有部門欄，這裡卻自己分了組').toEqual([]);
  const f = await 腳註(page);
  // ⚠️ 判準用兩句話**各自獨有**的片語，不是「有沒有部門兩個字」——後者兩句都含得到。
  expect(f, '🔴 「名冊沒有部門欄」與「後端還沒送這一格」處置不同（補欄 vs 部署）').toContain('可能還是舊版');
  expect(f, '🔴 後端沒回報，卻對他說「名冊沒有部門欄」——那是一句我們不知道的話')
    .not.toContain('員工名冊沒有「部門」欄');
});

/* ══════════════════════════════════════════════════════════════════════
 * 🔴 ⑧ console 零錯誤——「開了頁面」不等於驗收過
 * ══════════════════════════════════════════════════════════════════════ */

test('🔴 ⑧ 整趟（開頁 → 選人 → 加進草稿）console 一則錯誤都沒有', async ({ page }) => {
  const 主控台 = await open(page, { 欄位: true });
  await page.selectOption('#newcode', 碼.己);
  await page.locator('#add').click();
  await expect(page.locator('#list .row')).toHaveCount(3);
  expect(真錯誤(主控台), '🔴 console 有錯／警告：\n' + JSON.stringify(主控台, null, 1)).toEqual([]);
  expect(濾掉幾則(主控台), '⬛ 對照：濾網要恰好濾掉那一則被擋的 SDK').toBe(1);
});
