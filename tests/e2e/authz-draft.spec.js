/**
 * `authz.html`：**真瀏覽器裡「送出去的那一份草稿」有沒有被動到**（gas `#133`，2026-09-17）。
 *
 * ══ 為什麼這一檔非得是 e2e 不可 ═══════════════════════════════════════════
 *
 * 這一頁是**授權名單維護**——寫進去的東西決定誰能開哪些頁。
 * 而要守的是**最安靜的那一種壞法**：畫面看起來正常、按鈕都在、
 * 面板停在綠色的「七道都過」，**送出去的草稿卻不對**。零錯誤訊息。
 *
 * 🔴 `#117` 已經抓到一顆同形狀的：舊版 `接上監聽` 用
 *      `var box = f.parentNode.parentNode;`
 *    取「這是第幾列」——把「欄位剛好在列的第二層」寫成了程式的前提。
 *    版面改成「摺起來那一行 ＋ 展開的細節」之後欄位變成第三層，那句取到 `.det`
 *    ⇒ `data-n` 是 null ⇒ **直接 return** ⇒ 草稿不更新、**而且也不變髒**。
 * 🔴 **而那顆本來測不出來**：`tests/authz-page-wiring.test.js` 的假欄位**只包兩層**、
 *    跟舊取法**剛好對上** ⇒ 壞掉的碼在那個替身下實測 **23/23 全綠**。
 *    ⇒ 本檔跑的是**真的那一頁**，巢狀深度不是我寫的，是 `render()` 畫出來的。
 *
 * 🔴 `#117` 那 36（後來 41）條真瀏覽器量測跑的是**用完即丟的工具、不在 repo**，
 *    施工軌自己照實標明了。本檔就是把那把尺搬進 repo 變成常駐的。
 *
 * ══ 這一檔在守什麼（判準照 `#117` 那一組）═══════════════════════════════
 *
 *   ① 全部展開 ＋ 全部打開日期面板 ⇒ 草稿**逐字不變**；再全部收起來仍然不變
 *   ② 真的挑一個日期 ⇒ 全表**恰好 1 格**變動，就是那一列的停用日
 *   ③ **狀態欄一格都沒動**
 *   ④ 按「清除」⇒ 整份草稿**逐字回到原樣**
 *   ⑤ 🔴 **非 ISO 的停用日逐字保留**（真表裡有 `2026/03/15`、`未定` 這種）
 *   ⑥ 🔴 而且它們在**畫面上**還顯示得出來——`#117` 收尾那句
 *      「**『存進去的值沒變』不等於『畫面沒說假話』**」就是講這一格
 *
 * ══ ⚠️ 夾具的鑑別力：先辦這一件，再談上面六條 ═══════════════════════════
 *
 * 🔴 `#117` 施工軌第一版的非 ISO 突變**紅 0 條**——夾具裡全是 ISO 日期，
 *    那把尺**什麼都沒測到**，而它跑起來跟成功一模一樣。
 * 🔴 同一輪還抓到夾具對「分組」**零鑑別力**：第二個角色那幾列緊接在本人後面
 *    ⇒ 分組前後順序一樣 ⇒ 把 `排列()` 整支弄壞，跑起來**全綠**。
 *
 * ⇒ 所以本檔**第一組測試不是判準，是對夾具本身的鑑別力證明**，而且
 *   **⬛ 對照組是活的**：同一個量法在「全 ISO」與「第二角色相鄰」的變體夾具上
 *   跑一次，斷言它**回 0**。那兩條不是在測產品，是在釘住「這兩種夾具是瞎的」，
 *   免得日後有人為了乾淨把夾具改回去而沒有任何東西會紅。
 */
const { test, expect } = require('@playwright/test');

/* ══════════════════════════════════════════════════════════════════════
 * 夾具
 *
 * 🔴 **全部是假的。`jdc-line-liff` 是 PUBLIC repo** ——內部碼是拿字母表造的假碼、
 *    姓名是「測試甲／乙／丙…」、角色看得到的頁名也是假的。
 *    一格真實資料、一個真實姓名、一個真的內部識別碼都沒有。
 *
 * 夾具刻意做三件事，每一件都是為了讓某一把尺量得到東西：
 *
 *   ⒜ **停用日混入非 ISO 的值**（`2026/03/15`、`未定`）以及 ISO 形狀但**無效**的
 *      `2026-13-99`。`<input type="date">` 三種都吃不下 ⇒ 那一格的 `value` 是空字串
 *      ⇒ **草稿值 ≠ 欄位值** ⇒ 任何一條「把欄位值寫回草稿」的路徑，
 *      在這份夾具上一定會被抓到。全 ISO 的夾具則完全抓不到（見第一組測試）。
 *   ⒝ **第二個角色那幾列擺在名單最後面**，不是緊接在本人後面
 *      （真實的表就長這樣：幾個月後追加一列）⇒ `排列()` 真的得搬動節點。
 *   ⒞ **內部碼的字典序與列序相反** ⇒ 分組後的畫面順序與草稿順序**整個顛倒**，
 *      「畫面上的第 N 列」與「草稿裡的第 N 列」永遠不是同一列。
 * ══════════════════════════════════════════════════════════════════════ */

const HDR = ['內部碼', '角色', '狀態', '授予日', '停用日', '備註', '姓名'];
const 內 = 0, 角 = 1, 狀 = 2, 授 = 3, 停 = 4, 備 = 5, 姓 = 6;

/** ⒞ 字母表造的假碼，**故意由大到小排**（畫面分組後會整個倒過來）。 */
const 碼 = {
  甲: 'JDC-HHHHHH', 乙: 'JDC-GGGGGG', 丙: 'JDC-FFFFFF', 丁: 'JDC-EEEEEE',
  戊: 'JDC-DDDDDD', 己: 'JDC-CCCCCC', 庚: 'JDC-BBBBBB', 辛: 'JDC-AAAAAA',
};
/** 🔴 只可能因為「他按了加進草稿」才會出現在草稿裡的那一個。 */
const 標記碼 = 'JDC-ZZZZZZ';

/**
 * @param {object} [o]
 * @param {boolean} [o.全ISO]  ⬛ 對照組：把所有非 ISO 的停用日換成合法 ISO
 *        ——用來證明「那份夾具什麼都測不到」。
 * @param {boolean} [o.相鄰]   ⬛ 對照組：**重現 `#117` 那份瞎掉的夾具**
 *        ——第二個角色那幾列緊接在本人後面，**而且內部碼本來就已經遞增**。
 *
 * 🔴 **兩件缺一不可，這是實測出來的**：第一版的對照組只做了「相鄰」，
 *    結果它**照樣被重排**（`11,9,10,8,7,5,6,4,2,3,0,1`）——因為我的假碼是
 *    由大到小的，光是「相鄰」擋不住排序。⇒ 一個只做一半的對照組會謊報
 *    「這把尺有鑑別力」。要讓 `排列()` 真的變成 no-op，**順序本來就得是分組後的樣子**。
 */
function 名單(o) {
  o = o || {};
  const d = (v, iso) => (o.全ISO ? iso : v);
  // 本人那一批（一人一列），內部碼由大到小
  const 主 = [
    [碼.甲, 'admin',     '有效', '2026-09-01', '',                        '',              '測試甲'],
    [碼.乙, 'hr',        '有效', '2026-09-01', d('2026/03/15', '2026-03-15'), '非 ISO 的停用日', '測試乙'],
    [碼.丙, 'activity',  '有效', '2026-09-01', d('未定', '2026-05-20'),   '非 ISO 的停用日', '測試丙'],
    [碼.丁, 'hrstats',   '有效', '2026-09-01', '2026-12-31',              '合法 ISO',       '測試丁'],
    [碼.戊, 'messaging', '停用', '2026-09-01', d('2026/04/01', '2026-04-01'), '非 ISO 的停用日', '測試戊'],
    [碼.己, 'hr',        '有效', '2026-09-01', '',                        '',              '測試己'],
    [碼.庚, 'activity',  '有效', '2026-09-01', d('2026-13-99', '2026-11-09'), 'ISO 形狀但無效', '測試庚'],
    [碼.辛, 'hrstats',   '有效', '2026-09-01', '',                        '',              '測試辛'],
  ];
  // ⒝ 第二個角色：**追加在名單最後面**（⬛ 對照組 `相鄰` 則插在本人後面）
  const 追 = [
    [碼.乙, 'activity',  '有效', '2026-09-05', d('未定', '2026-06-06'),   '第二個角色',     '測試乙'],
    [碼.丁, 'hr',        '有效', '2026-09-05', '',                        '第二個角色',     '測試丁'],
    [碼.庚, 'messaging', '停用', '2026-09-05', d('2026/07/07', '2026-07-07'), '第二個角色',  '測試庚'],
    [碼.甲, 'activity',  '有效', '2026-09-05', '',                        '第二個角色',     '測試甲'],
  ];
  let rows;
  if (o.相鄰) {
    // ⬛ 對照組：內部碼**遞增**（＝已經是分組後的樣子）＋ 第二個角色緊接在本人後面。
    //    這兩件一起做，`排列()` 才會是 no-op；只做其中一件擋不住排序（見上面那段）。
    rows = [];
    主.slice().sort((a, b) => (a[內] < b[內] ? -1 : 1)).forEach((r) => {
      rows.push(r.slice());
      追.forEach((x) => { if (x[內] === r[內]) rows.push(x.slice()); });
    });
  } else {
    rows = 主.concat(追).map((r) => r.slice());
  }
  return {
    ok: true, who: '測試甲', header: HDR.slice(), rows,
    roster: Object.keys(碼).map((k) => ({ code: 碼[k], name: '測試' + k }))
      .concat([{ code: 標記碼, name: '測試壬' }]),
    rosterCollisions: [],
    assignableRoles: ['admin', 'hr', 'activity', 'hrstats', 'messaging'],
    statusValues: ['有效', '停用'],
    // Ｂ：角色 ↔ 頁面。**真頁面是由後端算的**，這裡只是一份形狀正確的假資料
    //    （頁名也是假的——本 repo 是公開的）。
    rolePages: [
      { role: 'admin', label: '系統管理', pages: [{ page: 'p1', title: '測試頁一' }, { page: 'p2', title: '測試頁二' }, { page: 'p3', title: '測試頁三' }] },
      { role: 'hr', label: '人事異動', pages: [{ page: 'p1', title: '測試頁一' }] },
      { role: 'activity', label: '活動管理', pages: [{ page: 'p2', title: '測試頁二' }] },
      { role: 'hrstats', label: '人事資訊', pages: [{ page: 'p3', title: '測試頁三' }] },
      { role: 'messaging', label: '對公司發訊', pages: [{ page: 'p4', title: '測試頁四' }] },
    ],
    current: { pass: true, rowCount: rows.length, adminCount: 1 },
  };
}

/** 全套 12 列（主 8 ＋ 追 4）——⬛ 零點會斷言這個數字，改夾具而忘了改它就會紅。 */
const 列數 = 12;

/* ══════════════════════════════════════════════════════════════════════
 * 開頁面。**儀器一律早於被測事件**：route 與 initScript 都在 goto 之前。
 * ══════════════════════════════════════════════════════════════════════ */

async function open(page, o) {
  o = o || {};
  // 🔴 真 SDK 一律擋掉：e2e 不可以真的去打 LINE，而且它在 127.0.0.1 上 `init()`
  //    一定失敗 ⇒ 會拿到一個跟受測物無關的失敗。
  //    ⚠️ 用 RegExp 不用 glob（`**static.line-scdn.net/**` 對不上，而對不上的後果
  //       是**真的 SDK 被載進來**、把整頁換掉——看起來像產品壞了）。
  await page.route(/static\.line-scdn\.net/, (r) => r.abort('failed'));
  await page.route(/script\.google\.com/, (r) => {
    const body = String(r.request().postData() || '');
    const act = (body.match(/(?:^|&)action=([^&]*)/) || [])[1] || '';
    let v = (o.回應 || {})[act];
    if (v === undefined) v = act === 'getAuthzList' ? 名單(o.夾具) : { ok: true };
    r.fulfill({
      status: 200, contentType: 'text/javascript; charset=utf-8',
      body: 'cb(' + JSON.stringify(v) + ')',
    });
  });
  await page.addInitScript(() => {
    window.liff = {
      init: () => Promise.resolve({}),
      isLoggedIn: () => true,
      getIDToken: () => ('eyJhbGciOiJIUzI1NiJ9.' + 'A'.repeat(900) + '.c2lnbmF0dXJl'),
      logout: () => {}, login: () => {},
      isInClient: () => false, closeWindow: () => {}, openWindow: () => {},
    };
  });
  await page.goto('/authz.html');
  await expect(page.locator('#list .row').first()).toBeVisible();
}

/* ══════════════════════════════════════════════════════════════════════
 * 量法
 *
 * 🔴 判準是 `JSON.stringify(草稿)` ——**那正是存檔真的會送出去的東西**
 *    （`存檔()` 送的是 `驗過的`，而它是 `檢查()` 當下的 `JSON.stringify(草稿)`）。
 * ══════════════════════════════════════════════════════════════════════ */

/** 草稿的字面。⚠️ 逐字比對用它，不要用「看起來一樣」。 */
const 草稿字面 = (page) => page.evaluate(() => JSON.stringify(window['草稿']));
const 草稿 = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window['草稿'])));

/** 兩份草稿的差集，逐格列出。**回空陣列＝逐字不變。** */
function 逐格差(前, 後) {
  const out = [];
  const n = Math.max(前.length, 後.length);
  for (let i = 0; i < n; i++) {
    const a = 前[i] || [], b = 後[i] || [];
    const m = Math.max(a.length, b.length);
    for (let c = 0; c < m; c++) {
      if (a[c] !== b[c]) out.push({ 列: i, 欄: c, 欄名: HDR[c], 前: a[c], 後: b[c] });
    }
  }
  return out;
}

/**
 * 🔴 **這把尺的鑑別力來源**：每一列的「草稿裡的停用日」與
 *    「`<input type="date">` 實際吃進去的值」比一次，回不相等的那幾列。
 *
 * ⚠️ 這個數字是 0 的話，**下面所有「草稿沒被動到」的斷言都可能是恆真的**
 *    ——一條把欄位值寫回草稿的路徑，在那種夾具上不會造成任何差異。
 *    這正是 `#117` 第一版突變紅 0 條的成因。
 */
async function 值與欄位不符的列(page) {
  return page.evaluate((停欄) => {
    const out = [];
    document.querySelectorAll('#list .row').forEach((row) => {
      const n = Number(row.getAttribute('data-n'));
      const f = row.querySelector('.dpop input[data-c="' + 停欄 + '"]');
      if (!f) return;
      const 草 = String((window['草稿'][n] || [])[停欄]);
      if (草 !== String(f.value)) out.push({ 列: n, 草稿值: 草, 欄位值: String(f.value) });
    });
    return out;
  }, 停);
}

/** 畫面上的列順序（讀 `data-n`）。⚠️ 它與草稿的順序**刻意**不同。 */
const 畫面順序 = (page) => page.evaluate(
  () => Array.from(document.querySelectorAll('#list .row')).map((r) => Number(r.getAttribute('data-n'))));

/** 某個順序裡，同一個內部碼是不是被別人拆開了。回被拆開的人數。 */
function 被拆開的人數(順序, rows) {
  const 見過 = {}, 壞 = {};
  let 前 = null;
  順序.forEach((n) => {
    const c = rows[n][內];
    if (c !== 前 && 見過[c]) 壞[c] = 1;      // 之前出現過、中間被別人隔開
    見過[c] = 1; 前 = c;
  });
  return Object.keys(壞).length;
}

/** 展開全部的列（走真的點擊，不是改 class）。 */
async function 全部展開(page) {
  const n = await page.locator('#list .row').count();
  for (let i = 0; i < n; i++) await page.locator('#list .row .sum').nth(i).click();
  await expect(page.locator('#list .row.open')).toHaveCount(n);
}

/** 打開全部的停用日面板（走真的點擊）。⚠️ 要先展開，否則鈕是看不見的。 */
async function 全開日期面板(page) {
  const n = await page.locator('#list .row [data-act="date"]').count();
  for (let i = 0; i < n; i++) await page.locator('#list .row [data-act="date"]').nth(i).click();
  await expect(page.locator('#list .dpop:not([hidden])')).toHaveCount(n);
}

/** 面板現在是不是「髒」的（＝檢查結果作廢、存檔鈕關著）。 */
const 髒了嗎 = (page) => page.evaluate(() => ({
  存檔鈕關著: !!document.getElementById('save').disabled,
  面板: (document.getElementById('panel') || {}).textContent || '',
}));

/* ══════════════════════════════════════════════════════════════════════
 * ⬛ 第一組：**夾具的鑑別力**——先證明這把尺量得到東西，再談判準
 * ══════════════════════════════════════════════════════════════════════ */

test('⬛ 零點：夾具真的畫得出來（畫不出來的話下面每一條都是在驗沒發生的事）', async ({ page }) => {
  await open(page, {});
  await expect(page.locator('#list .row')).toHaveCount(列數);
  const d = await 草稿(page);
  expect(d.length, '⬛ 草稿列數與畫面列數不一致 ⇒ 這一輪量的不是同一個東西').toBe(列數);
  expect(d[0].length, '⬛ 每一列要有完整的 7 格').toBe(HDR.length);
});

test('🔴 ⬛ 鑑別力①：草稿值與 <input type=date> 吃進去的值**不相等**的列 ≥ 6', async ({ page }) => {
  await open(page, {});
  await 全部展開(page);
  const 不符 = await 值與欄位不符的列(page);
  // 🔴 這個數字就是「任何一條把欄位值寫回草稿的路徑，會不會被抓到」。
  //    它是 0 的話，本檔所有「草稿逐字不變」的斷言都可能是恆真的。
  expect(不符.length,
    '🔴 夾具裡沒有任何一列的草稿值與欄位值不同 ⇒ 這把尺什麼都測不到（`#117` 第一版就死在這裡）\n'
    + JSON.stringify(不符)).toBeGreaterThanOrEqual(6);
  // 實際吃不下的那幾種都要在：兩種非 ISO ＋ 一個 ISO 形狀但無效的
  const 草稿值 = 不符.map((x) => x.草稿值);
  expect(草稿值).toContain('2026/03/15');
  expect(草稿值).toContain('未定');
  expect(草稿值, 'ISO 形狀但無效的值也吃不下——它跟非 ISO 是同一類').toContain('2026-13-99');
  // ⬛ 欄位那一側一律是空字串（證明「吃不下」是真的，不是我假設的）
  不符.forEach((x) => expect(x.欄位值).toBe(''));
});

test('⬛ 對照組①：同一個量法跑「全 ISO」的夾具 ⇒ **回 0** ——那種夾具是瞎的', async ({ page }) => {
  await open(page, { 夾具: { 全ISO: true } });
  await 全部展開(page);
  const 不符 = await 值與欄位不符的列(page);
  // 🔴 這一條不是在測產品，是在釘住「夾具改成全 ISO 就再也測不到東西」。
  //    日後有人為了乾淨把非 ISO 拿掉時，上面那條會紅、而這一條會說出為什麼。
  expect(不符.length,
    '⬛ 全 ISO 的夾具竟然也量得出差異 ⇒ 這個對照組壞了，上面那條鑑別力的結論不算數\n'
    + JSON.stringify(不符)).toBe(0);
});

test('🔴 ⬛ 鑑別力②：分組真的搬動了節點（原始列序裡有 4 個人被拆開）', async ({ page }) => {
  await open(page, {});
  const rows = await 草稿(page);
  const 草稿順序 = rows.map((_, i) => i);
  const 畫面 = await 畫面順序(page);

  expect(被拆開的人數(草稿順序, rows),
    '⬛ 零點：夾具的原始列序裡沒有人被拆開 ⇒ 分不分組都一樣，`排列()` 弄壞了也不會紅').toBe(4);
  expect(被拆開的人數(畫面, rows),
    '🔴 分組之後同一個人的幾列竟然還是被拆開的 ⇒ `排列()` 沒有做到它宣稱的事').toBe(0);
  expect(畫面.join(','),
    '🔴 畫面順序與草稿順序相同 ⇒ 這份夾具對分組零鑑別力（`#117` 踩過的那一格）')
    .not.toBe(草稿順序.join(','));
});

test('⬛ 對照組②：第二個角色**緊接在本人後面**的夾具 ⇒ 分組前後順序一樣（零鑑別力）', async ({ page }) => {
  await open(page, { 夾具: { 相鄰: true } });
  const rows = await 草稿(page);
  const 草稿順序 = rows.map((_, i) => i);
  const 畫面 = await 畫面順序(page);
  expect(被拆開的人數(草稿順序, rows), '⬛ 這個對照組的前提是「本來就沒人被拆開」').toBe(0);
  // 🔴 這就是 `#117` 那份瞎掉的夾具：把 `排列()` 整支弄壞，它跑起來也全綠。
  expect(畫面.join(','),
    '⬛ 相鄰的夾具竟然被重排了 ⇒ 這個對照組壞了，上面那條「有鑑別力」的結論不算數')
    .toBe(草稿順序.join(','));
});

/* ══════════════════════════════════════════════════════════════════════
 * ① 全展開 ＋ 全開日期面板 ⇒ 草稿**逐字不變**
 * ══════════════════════════════════════════════════════════════════════ */

test('🔴 ① 全部展開 ＋ 全部打開日期面板 ⇒ 草稿逐字不變；再全部收起來仍然不變', async ({ page }) => {
  await open(page, {});
  const 原 = await 草稿字面(page);

  await 全部展開(page);
  expect(await 草稿字面(page),
    '🔴 光是展開就動到了草稿 ⇒ 他什麼都還沒改，送出去的東西已經不是原本那一份').toBe(原);

  await 全開日期面板(page);
  expect(await 草稿字面(page),
    '🔴 打開日期面板就動到了草稿——而 `<input type=date>` 吃不下非 ISO 的值，'
    + '把欄位值寫回去等於**把那幾天靜靜抹掉**').toBe(原);

  // 再全部收起來
  const n = await page.locator('#list .row').count();
  for (let i = 0; i < n; i++) await page.locator('#list .row .sum').nth(i).click();
  await expect(page.locator('#list .row.open')).toHaveCount(0);
  expect(await 草稿字面(page), '🔴 收起來也算一次改動 ⇒ 展開再收合就換掉了他要存的東西').toBe(原);

  // 一格都沒動 ⇒ 存檔鈕本來就關著（載入時就是關的），面板也不該說「改過了」
  const s = await 髒了嗎(page);
  expect(s.面板).not.toContain('這份草稿改過了');
});

test('🔴 ⑤ 非 ISO 的停用日，全程逐字保留在草稿裡', async ({ page }) => {
  await open(page, {});
  await 全部展開(page);
  await 全開日期面板(page);
  const d = await 草稿(page);
  const 停用日 = d.map((r) => r[停]);
  expect(停用日, '🔴 `2026/03/15` 不見了 ⇒ 真表裡那一天被靜靜抹掉').toContain('2026/03/15');
  expect(停用日, '🔴 `未定` 不見了').toContain('未定');
  expect(停用日, '🔴 `2026-13-99` 不見了').toContain('2026-13-99');
  expect(停用日.filter((v) => v === '未定').length, '⬛ 兩列都是 `未定`，一列都不能少').toBe(2);
});

/* ══════════════════════════════════════════════════════════════════════
 * ② 挑一個日期 ⇒ **恰好 1 格**變動　③ 狀態欄一格沒動
 *
 * ⚠️ 挑的是**草稿第 1 列**（`data-n="1"`），它原本的停用日是非 ISO 的
 *    `2026/03/15` ——最harsh 的那一格。
 * 🔴 用 `[data-n]` 定位，**不用畫面上的第幾列**：分組之後兩者永遠不是同一列
 *    （`feedback_position_is_not_identity`）。
 * ══════════════════════════════════════════════════════════════════════ */

test('🔴 ②③ 真的挑一個日期 ⇒ 全表恰好 1 格變動、就是那一列的停用日，狀態欄一格沒動', async ({ page }) => {
  await open(page, {});
  const 前 = await 草稿(page);

  await page.locator('[data-n="1"] .sum').click();
  await page.locator('[data-n="1"] [data-act="date"]').click();
  await page.locator('[data-n="1"] .dpop input[type="date"]').fill('2027-06-30');

  const 後 = await 草稿(page);
  const 差 = 逐格差(前, 後);

  // 🔴 **先斷言「有變」**：一格都沒變的話，下面「恰好 1 格」也會成立，
  //    而那正是「往上兩層取列號」那顆 bug 的長相——改了一格卻什麼都沒發生。
  expect(差.length,
    '🔴 挑了日期而草稿一格都沒變 ⇒ 他改的東西沒有進到要送出去的那一份，'
    + '而畫面不會報錯（`#117` 抓到的那顆：`parentNode.parentNode` 取不到 `data-n` 就 return）')
    .toBeGreaterThan(0);
  expect(差.length, '🔴 挑一個日期卻動到不只一格：\n' + JSON.stringify(差, null, 1)).toBe(1);
  expect(差[0].列).toBe(1);
  expect(差[0].欄名, '🔴 動到的不是停用日那一欄').toBe('停用日');
  expect(差[0].前).toBe('2026/03/15');
  expect(差[0].後).toBe('2027-06-30');

  // ③ 狀態欄**整欄逐格比對**——這顆鈕不碰狀態（「填一個停用日」與「把人停掉」是兩件事）
  expect(後.map((r) => r[狀]).join('|'),
    '🔴 狀態欄被動到了 ⇒ 挑一個日期把人停掉／啟用了，而畫面上沒有任何提示')
    .toBe(前.map((r) => r[狀]).join('|'));

  // 改了就要變髒——否則畫面會停在綠色的「七道都過」而他改的那一格從沒被驗過
  const s = await 髒了嗎(page);
  expect(s.存檔鈕關著, '🔴 改了一格而存檔鈕還開著 ⇒ 他會送出一份沒被檢查過的草稿').toBe(true);
  expect(s.面板, '🔴 改了一格而面板沒說「改過了」').toContain('這份草稿改過了');
});

/* ══════════════════════════════════════════════════════════════════════
 * ④ 清除 ⇒ 逐字回到原樣
 * ══════════════════════════════════════════════════════════════════════ */

test('🔴 ④ 挑一個日期之後按「清除」⇒ 那一格回空字串，其餘逐字回原樣', async ({ page }) => {
  await open(page, {});
  const 原字面 = await 草稿字面(page);
  const 原 = JSON.parse(原字面);

  await page.locator('[data-n="1"] .sum').click();
  await page.locator('[data-n="1"] [data-act="date"]').click();
  await page.locator('[data-n="1"] .dpop input[type="date"]').fill('2027-06-30');
  expect(await 草稿字面(page), '⬛ 零點：日期沒挑進去的話，下面「清除有效」是在驗沒發生的事')
    .not.toBe(原字面);

  await page.locator('[data-n="1"] [data-act="dclr"]').click();
  const 後 = await 草稿(page);
  const 差 = 逐格差(原, 後);
  // 清除＝變成空字串。⇒ 與「原樣」的差恰好是那一格（原值是 `2026/03/15`）。
  expect(差.length, '🔴 清除之後動到的不只那一格：\n' + JSON.stringify(差, null, 1)).toBe(1);
  expect(差[0]).toMatchObject({ 列: 1, 欄名: '停用日', 前: '2026/03/15', 後: '' });

  // 🔴 其餘每一格都**逐字**回到原樣（含另外那幾個非 ISO 的值）
  const 原去掉那格 = 原.map((r) => r.slice()); 原去掉那格[1][停] = '';
  expect(JSON.stringify(後),
    '🔴 清除順手動到了別的格 ⇒ 他按的是「清除這一天」，而送出去的是別的東西')
    .toBe(JSON.stringify(原去掉那格));

  const s = await 髒了嗎(page);
  expect(s.存檔鈕關著, '🔴 清除之後存檔鈕還開著 ⇒ 清掉的那一格從沒被檢查過').toBe(true);
});

test('⬛ 對照組：清除一列**本來就是空的**停用日 ⇒ 草稿逐字不變（尺不是一律回「變了」）', async ({ page }) => {
  await open(page, {});
  const 原字面 = await 草稿字面(page);
  // 草稿第 0 列的停用日本來就是空字串
  await page.locator('[data-n="0"] .sum').click();
  await page.locator('[data-n="0"] [data-act="date"]').click();
  await page.locator('[data-n="0"] [data-act="dclr"]').click();
  expect(await 草稿字面(page), '⬛ 清一個本來就空的格竟然改變了草稿').toBe(原字面);
});

/* ══════════════════════════════════════════════════════════════════════
 * ⑥ 🔴 「存進去的值沒變」**不等於**「畫面沒說假話」
 *
 * `#117` 驗證軌擋下的那一顆：`同步同欄()` 更新鈕面那段**沒問是哪一欄**，
 * 而 `接上監聽` 對**每一格**輸入都呼叫它 ⇒ 在備註打字會把停用日那顆鈕的字蓋掉。
 * 🔴 **而非 ISO 的值全頁只有鈕面看得到**（`<input type=date>` 顯示成空白）
 *    ⇒ 鈕面一被蓋掉，那一天在畫面上**再也顯示不出來**，而草稿裡還留著
 *    ⇒ 他看到「尚未設定停用日」，於是去設一個，把原值覆蓋掉。**零錯誤訊息。**
 * ⚠️ `#117` 那 41 條量測看不到它（判準是 `JSON.stringify(草稿)`，而草稿確實沒動）。
 *    ⇒ 本檔刻意多量一格「畫面說了什麼」。
 * ══════════════════════════════════════════════════════════════════════ */

const 鈕面 = (page, n) => page.evaluate((i) => {
  const b = document.querySelector('[data-n="' + i + '"] [data-act="date"]');
  return { 字: b.textContent, has: b.classList.contains('has') };
}, n);

test('🔴 ⑥ 在「備註」打字／清空 ⇒ 停用日那顆鈕的字與 `has` 都不受影響', async ({ page }) => {
  await open(page, {});
  await page.locator('[data-n="1"] .sum').click();

  const 前 = await 鈕面(page, 1);
  // ⬛ 零點：那一列本來就看得出是哪一天，而且是實線框
  expect(前.字, '⬛ 零點：鈕面本來就沒顯示那個非 ISO 的值 ⇒ 下面那條等於沒測').toContain('2026/03/15');
  expect(前.has, '⬛ 零點：`has` 本來就不在 ⇒ 下面驗它還在是恆真').toBe(true);
  // ⬛ 零點：而 `<input type=date>` 真的吃不下它 ⇒ 鈕面是全頁唯一顯示得出它的地方
  await page.locator('[data-n="1"] [data-act="date"]').click();
  expect(await page.locator('[data-n="1"] .dpop input[type="date"]').inputValue(),
    '⬛ 零點：日期欄位竟然吃得下 `2026/03/15` ⇒ 「鈕面是唯一顯示處」這個前提不成立').toBe('');

  await page.locator('[data-n="1"] .det .fld input[data-c="' + 備 + '"]').fill('隨便打的備註');
  let 後 = await 鈕面(page, 1);
  expect(後.字,
    '🔴 在備註打字把停用日那顆鈕的字蓋掉了——鈕上那一行現在讀起來是'
    + '「這個人的停用日是『隨便打的備註』」，而那是全頁唯一顯示得出原值的地方').toBe(前.字);
  expect(後.has).toBe(true);

  await page.locator('[data-n="1"] .det .fld input[data-c="' + 備 + '"]').fill('');
  後 = await 鈕面(page, 1);
  expect(後.字, '🔴 清空備註把鈕面清成「尚未設定停用日」了').toBe(前.字);
  expect(後.has, '🔴 `has` 被拔掉 ⇒ 「已設 2026/03/15」與「沒設」在畫面上長得一模一樣').toBe(true);

  // ⬛ 對照組：改**停用日那一欄**時鈕面確實跟著變（證明這把尺不是恆過）
  await page.locator('[data-n="1"] .dpop input[type="date"]').fill('2027-06-30');
  expect((await 鈕面(page, 1)).字,
    '⬛ 對照組：改停用日那一欄鈕面竟然沒跟著變 ⇒ 上面那三條「沒變」不算數').toContain('2027-06-30');
});

/* ══════════════════════════════════════════════════════════════════════
 * ⬛ 尾巴：證明這把尺**回得出「草稿被動到了」**
 *
 * 上面大半條文都在斷言「沒變」。沒有這一條的話，一支根本沒接上輸入的頁面
 * 也會讓它們全部通過。
 * ══════════════════════════════════════════════════════════════════════ */

test('⬛ 對照：在備註打字 ⇒ 草稿**恰好那一格**變了（尺不是一律回「沒變」）', async ({ page }) => {
  await open(page, {});
  const 前 = await 草稿(page);
  await page.locator('[data-n="7"] .sum').click();
  await page.locator('[data-n="7"] .det .fld input[data-c="' + 備 + '"]').fill('T133');
  const 差 = 逐格差(前, await 草稿(page));
  expect(差.length, '⬛ 在備註打字而草稿一格都沒變 ⇒ 本檔所有「逐字不變」都是恆真的').toBe(1);
  expect(差[0]).toMatchObject({ 列: 7, 欄名: '備註', 後: 'T133' });
  expect((await 髒了嗎(page)).存檔鈕關著).toBe(true);
});

test('⬛ 對照：加一列進草稿 ⇒ 草稿真的長一列（`data-n` 與草稿索引是對上的）', async ({ page }) => {
  await open(page, {});
  await page.selectOption('#newcode', 標記碼);
  await page.locator('#add').click();
  const d = await 草稿(page);
  expect(d.length).toBe(列數 + 1);
  expect(d[列數][內]).toBe(標記碼);
  // 🔴 新那一列在畫面上的 `data-n` 必須是 `列數`，不是它排在第幾個
  await expect(page.locator('[data-n="' + 列數 + '"]')).toHaveCount(1);
});
