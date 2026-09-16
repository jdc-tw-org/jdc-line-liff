const { test } = require('node:test'); const assert = require('node:assert');
const BC = require('../assets/board-cache.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ══ 🔴 守門拒絕的信封，**從後端讀，不手寫**（2026-09-17，gas #113 的 Ｄ）════
 *
 * 這一檔原本逐字寫死中文句子當標準答案：
 *     assert.equal(BC.cacheVerdict({ ok:false, msg:'無權限或連結已失效。' }), 'revoked');
 * ⬛ 實測：那幾條 fixture 是**自足的**——不讀後端任何東西 ⇒ **後端改文案永遠不會紅**，
 *    而「全綠」與「線上那道撤銷遮蔽已經對不上了」完全相容。
 *    2026-09-16 線上真的對不上了（LINE 登入那條路撤權之後快取不清），**而這一檔全綠**。
 *
 * ⇒ 改吃 `tests/fixtures/action-roles.json` 的 `gateContract`：那是 `jdc-line-gas`
 *   的 `ci/roles-matrix/gate-denials.js` **真的跑過兩支守門**之後吐出來的信封，
 *   由 `ci/roles-matrix/copy-guard.js` 逐字守著（後端改一個字，那道守門就紅）。
 *   本 repo 這一側另有 `tests/fixture-pin.test.js` 的 PIN 守著「副本沒被偷換」。
 *
 * ⚠️ **本 repo 刻意不抄一份代號表**。要清快取的代號寫在 `board-cache.js` 的
 *    `REVOKE_REASONS`（那是本 repo 的處置決定）；**哪個情境送哪個信封**是後端的事實，
 *    只有一份、在後端。兩邊各寫一份的話，分歧的症狀就是今天這個洞。
 */
const 契約 = require('./fixtures/action-roles.json').gateContract;
/** 拿後端某個情境**真的送出來的那個信封**。找不到就紅——不要靜靜回 undefined。 */
function 信封(key) {
  const r = (契約.denials || []).find((x) => x.key === key);
  if (!r) throw new Error('契約表裡沒有 `' + key + '` ⇒ 後端的案例表改過了，'
    + '在 jdc-line-gas 重產副本，或確認這個情境是不是已經不存在');
  return r.envelope;
}

test('cacheExpired：剛好 7 天不算過期，多一毫秒才算', () => {
  const t0 = 1000000;
  assert.equal(BC.cacheExpired(t0, t0 + BC.CACHE_TTL_MS), false);
  assert.equal(BC.cacheExpired(t0, t0 + BC.CACHE_TTL_MS + 1), true);
});

test('cacheExpired：savedAt 缺漏或不是數字 → 一律當過期', () => {
  assert.equal(BC.cacheExpired(undefined, Date.now()), true);
  assert.equal(BC.cacheExpired(null, Date.now()), true);
  assert.equal(BC.cacheExpired('1000', Date.now()), true);
  assert.equal(BC.cacheExpired(NaN, Date.now()), true);
});

// 全站四種實際字串，逐檔查證過（attend:82 / stats:602 / board:241,253 / hr-stats:73）
test('cacheVerdict：四種離線字串全部要判成 offline（禁用完全相等比對）', () => {
  [
    '連線逾時（伺服器喚醒中），請重新整理再試。',
    '連線逾時，請重新整理。',
    '連線失敗，請重新整理。',
    '連線失敗',
  ].forEach((msg) => {
    assert.equal(BC.cacheVerdict({ ok: false, msg: msg }), 'offline', msg);
  });
});

/* ══ 🔴 `cacheVerdict` 對後端每一個拒絕出口的處置 ═══════════════════════
 * 逐列吃後端產出的信封表。**這一節一個中文句子都不手寫。** */

test('⬛ 零點：契約表真的載進來了，而且是這個系統的量級', () => {
  // 沒有這一格，下面每一條都可能在空陣列上 forEach 零次 ⇒ 全綠而什麼都沒測到。
  assert.ok(契約 && Array.isArray(契約.denials),
    'action-roles.json 沒有 gateContract ⇒ 副本是舊版，在 jdc-line-gas 重產一次：\n'
    + '  node ci/roles-matrix/export-json.js --out <這裡>/tests/fixtures/action-roles.json');
  assert.ok(契約.denials.length >= 10,
    '契約只有 ' + 契約.denials.length + ' 列 ⇒ 產生器的案例表被砍過');
  // ⬛ 兩種期望值都要有。全是 revoked 或全是 ok 的話，下面那條逐列斷言是恆真的。
  const v = new Set(契約.denials.map((r) => r.verdict));
  assert.ok(v.has('revoked') && v.has('ok'),
    '契約表的 verdict 只有一種（' + [...v].join('、') + '）⇒ 逐列斷言沒有鑑別力');
});

test('🔴 逐列：後端每一個拒絕出口，處置都必須與契約相符', () => {
  契約.denials.forEach((r) => {
    assert.equal(BC.cacheVerdict(r.envelope), r.verdict,
      '\n  情境：' + r.key + '\n  ' + r.why
      + '\n  信封：' + JSON.stringify(r.envelope)
      + '\n  契約要求：' + r.verdict + '　實際：' + BC.cacheVerdict(r.envelope));
  });
});

test('🔴🔴 撤權：`?t=` 與 LINE 兩條路必須回同一個答案（今天這張票就是它們不相等）', () => {
  const 撤權 = 契約.denials.filter((r) => r.verdict === 'revoked');
  // ⬛ 先證明「撤權」這個集合不是空的——空集合上「全部相等」恆真。
  assert.ok(撤權.length >= 3,
    '契約裡只有 ' + 撤權.length + ' 條撤權路徑 ⇒ 兩條路那件事沒有被涵蓋');
  const 答案 = new Set(撤權.map((r) => BC.cacheVerdict(r.envelope)));
  assert.equal(答案.size, 1,
    '同一個「被撤權」事件在不同路徑上得到不同處置：\n'
    + 撤權.map((r) => '  ' + r.key + ' → ' + BC.cacheVerdict(r.envelope)).join('\n')
    + '\n  ⇒ 其中判成 ok 的那條，他手機上那份快取不會被清掉（TTL 7 天）。');
  assert.equal([...答案][0], 'revoked');

  // ⬛ 對照組：這把尺分得出「不是撤權」。沒有這一格，上面那句「全部相等」
  //    也可能是因為 `cacheVerdict` 恆回同一個值。
  const 非撤權 = 契約.denials.filter((r) => r.verdict === 'ok');
  assert.ok(非撤權.length > 0);
  非撤權.forEach((r) => {
    assert.notEqual(BC.cacheVerdict(r.envelope), 'revoked', r.key + '：' + r.why);
  });
});

test('🔴 代號打錯一個字母 → 不清快取（fail-safe），而且契約裡的代號都是認得的', () => {
  // `role_unresolvd` 在信封表裡長得跟正確的一模一樣 ⇒ 只靠肉眼看不出來。
  assert.equal(BC.cacheVerdict({ ok: false, msg: '無權限或連結已失效。', reason: 'role_unresolvd' }),
    'ok', '打錯字的代號竟然清了快取 ⇒ 它是靠 msg 過的，代號那條路沒在作用');
  // 反過來：本 repo 要清快取的每一個代號，後端的值域裡都要有。
  Object.keys(BC.REVOKE_REASONS).forEach((code) => {
    assert.ok(Object.values(契約.reject).indexOf(code) >= 0,
      'REVOKE_REASONS 裡的 `' + code + '` 不在後端的 GATE_REJECT 值域裡'
      + '（後端有：' + Object.values(契約.reject).join('、') + '）'
      + ' ⇒ 它永遠不會被送來，這一格是死的');
  });
});

test('⚠️ 沒有代號的生產者仍然靠那一句話認（Code.js handler 層 72 行、不認得的 action）', () => {
  // 退場條件寫在 board-cache.js 的 cacheVerdict 檔頭：那 72 行全部帶上 reason 之後刪掉這條。
  assert.equal(BC.cacheVerdict({ ok: false, msg: '無權限或連結已失效。' }), 'revoked');
  assert.equal(BC.cacheVerdict({ ok: false, msg: '找不到員工名冊' }), 'ok');
  assert.equal(BC.cacheVerdict({ ok: true }), 'ok');
});

test('cacheVerdict：外層 ok、results 內某支無權限 → 仍是 ok', () => {
  const env = { ok: true, results: { getRosterList: { ok: false, msg: '無權限或連結已失效。' } } };
  assert.equal(BC.cacheVerdict(env), 'ok');
});

test('nameOfSlice：無參數的 action 用自己的名字', () => {
  assert.equal(BC.nameOfSlice('getRosterList', { ok: true }, {}), 'getRosterList');
  assert.equal(BC.nameOfSlice('listHrNotices', { ok: true }, {}), 'listHrNotices');
  assert.equal(BC.nameOfSlice('listOptions', { ok: true }, {}), 'listOptions');
  assert.equal(BC.nameOfSlice('getHrStats', { ok: true }, {}), 'getHrStats');
});

test('nameOfSlice：帶著草稿的 previewPassBroadcast 不落地，其餘一律落地', () => {
  // 舊前提（設計 3.3.3「恆不落地」）已於 2026-08-23 被使用者推翻，理由見本檔下方那一組
  // 「報到碼通知落地快取」的測試。這裡改寫成新規則、不刪——刪掉會讓「帶草稿不存」
  // 這條唯一還成立的守則失去看守人。
  assert.equal(BC.nameOfSlice('previewPassBroadcast', { ok: true }, { actId: 'a', tpl: '草稿' }), null);
  // 對照：同一發 batch 裡的其他支都要落地，證明上面那個 null 不是「全部都 null」。
  // ⚠️ getAnniversaries 2026-08-20 一度改成不落地（沒人讀＝白存），
  // 後來拍板改成「補讀取端讓它也秒顯」，所以它必須留在落地清單裡。
  assert.equal(BC.nameOfSlice('getAnniversaries', { ok: true }, {}), 'getAnniversaries');
  assert.equal(BC.nameOfSlice('getHrPending', { ok: true }, {}), 'getHrPending');
  assert.equal(BC.nameOfSlice('getCheckinPending', { ok: true }, {}), 'getCheckinPending');
});

test('nameOfSlice：名稱一律由「送出的參數」算，不從回應反推', () => {
  const slice = { ok: true, activity: { id: 'WRONG' } };
  assert.equal(BC.nameOfSlice('getSeatingBoard', slice, { actId: 'midyear2026' }),
    'getSeatingBoard:midyear2026');
  assert.equal(BC.nameOfSlice('listStaffStations', slice, { actId: 'yearend2026' }),
    'listStaffStations:yearend2026');
  assert.equal(BC.nameOfSlice('getSeniorNotice', { ok: true, year: 2099 }, { year: 2026 }),
    'getSeniorNotice:2026');
});

test('nameOfSlice：getActivityStats 的 act 為空時，名稱結尾就是冒號', () => {
  assert.equal(BC.nameOfSlice('getActivityStats', { ok: true }, { act: '' }), 'getActivityStats:');
  assert.equal(BC.nameOfSlice('getActivityStats', { ok: true }, {}), 'getActivityStats:');
});

test('nameOfSlice：previewPassBroadcast 依 tpl 決定落不落地（2026-08-23 起）', () => {
  assert.equal(BC.nameOfSlice('previewPassBroadcast', { ok: true }, { actId: 'a', tpl: '' }),
    'previewPassBroadcast:a');
  assert.equal(BC.nameOfSlice('previewPassBroadcast', { ok: true }, { actId: 'a', tpl: '改過的範本' }), null);
});

test('nameOfSlice：不認得的 action 回 null（fail-safe，不存看不懂的東西）', () => {
  assert.equal(BC.nameOfSlice('somethingNew', { ok: true }, {}), null);
});

// 假的 localStorage：Node 沒有它，用最小實作換掉
function fakeStore() {
  const m = new Map();
  return {
    _m: m,
    get length() { return m.size; },
    key(i) { return Array.from(m.keys())[i]; },
    getItem(k) { return m.has(k) ? m.get(k) : null; },
    setItem(k, v) { m.set(k, String(v)); },
    removeItem(k) { m.delete(k); }
  };
}

test('cacheSave → cacheBootstrap：存得進去、讀得回來，且磁碟上是亂碼', async () => {
  const st = fakeStore(); BC.__setStoreForTest(st);
  await BC.cacheSave('tok-A', 'getRosterList', { ok: true, rows: ['王小明'] });

  const raw = st.getItem(st.key(0));
  assert.ok(raw.indexOf('王小明') === -1, '明文姓名不得出現在 localStorage');
  assert.ok(st.key(0).indexOf('jdcBoard:v1:') === 0, '鍵要帶版本');

  const map = await BC.cacheBootstrap('tok-A');
  assert.deepEqual(map.getRosterList.value.rows, ['王小明']);
  assert.equal(typeof map.getRosterList.savedAt, 'number');
  BC.__resetForTest();
});

test('cacheSave：ok!==true 不寫入，且不覆蓋既有的成功快取', async () => {
  const st = fakeStore(); BC.__setStoreForTest(st);
  await BC.cacheSave('tok-A', 'listOptions', { ok: true, v: 'good' });
  await BC.cacheSave('tok-A', 'listOptions', { ok: false, msg: '無權限或連結已失效。' });

  const map = await BC.cacheBootstrap('tok-A');
  assert.equal(map.listOptions.value.v, 'good', '成功那筆必須還在');
  BC.__resetForTest();
});

test('cacheSave 之後，同一個 session 內 cacheGet 就讀得到新值（不必重新 bootstrap）', async () => {
  const st = fakeStore(); BC.__setStoreForTest(st);
  await BC.cacheBootstrap('tok-A');                 // 先 bootstrap，此時是空的
  assert.equal(BC.cacheGet('listOptions'), null);
  await BC.cacheSave('tok-A', 'listOptions', { ok: true, v: 'fresh' });
  const got = BC.cacheGet('listOptions');
  assert.ok(got, 'save 之後應該立刻讀得到');
  assert.equal(got.value.v, 'fresh');
  assert.equal(typeof got.savedAt, 'number');
  BC.__resetForTest();
});

test('撤銷之後 cacheSave 不得把值塞進記憶體', async () => {
  const st = fakeStore(); BC.__setStoreForTest(st);
  await BC.cacheBootstrap('tok-A');
  BC.cacheRevoke();
  await BC.cacheSave('tok-A', 'listOptions', { ok: true, v: 'x' });
  assert.equal(BC.cacheGet('listOptions'), null);
  BC.__resetForTest();
});

test('不同 token 的快取互不干擾，cacheClear 只清當前指紋', async () => {
  const st = fakeStore(); BC.__setStoreForTest(st);
  await BC.cacheSave('tok-A', 'listOptions', { ok: true, v: 'A' });
  await BC.cacheSave('tok-B', 'listOptions', { ok: true, v: 'B' });
  await BC.cacheClear('tok-B');

  const a = await BC.cacheBootstrap('tok-A');
  const b = await BC.cacheBootstrap('tok-B');
  assert.equal(a.listOptions.value.v, 'A', 'A 的快取不該被 B 的撤銷清掉');
  assert.equal(b.listOptions, undefined);
  BC.__resetForTest();
});

test('bootstrap：過期的鍵會被讀掉並從磁碟刪除', async () => {
  const st = fakeStore(); BC.__setStoreForTest(st);
  await BC.cacheSave('tok-A', 'listOptions', { ok: true, v: 'old' });
  const before = st.length;
  assert.equal(before, 1);

  // 把時鐘往後推 8 天
  const map = await BC.cacheBootstrap('tok-A', Date.now() + 8 * 24 * 60 * 60 * 1000);
  assert.equal(map.listOptions, undefined);
  assert.equal(st.length, 0, '過期的鍵要順手刪掉，不留殘骸');
  BC.__resetForTest();
});

test('bootstrap：解不開／缺 savedAt 的鍵當成沒有，並刪除', async () => {
  const st = fakeStore(); BC.__setStoreForTest(st);
  await BC.cacheSave('tok-A', 'listOptions', { ok: true, v: 'x' });
  const k = st.key(0);
  st.setItem(k, 'this-is-not-valid-ciphertext');

  const map = await BC.cacheBootstrap('tok-A');
  assert.equal(map.listOptions, undefined);
  assert.equal(st.length, 0);
  BC.__resetForTest();
});

test('cacheRevoke 之後：cacheGet 恆回 null、cacheSave 變空操作', async () => {
  const st = fakeStore(); BC.__setStoreForTest(st);
  await BC.cacheSave('tok-A', 'listOptions', { ok: true, v: 'x' });
  await BC.cacheBootstrap('tok-A');
  assert.ok(BC.cacheGet('listOptions'), '撤銷前讀得到');

  BC.cacheRevoke();
  assert.equal(BC.cacheGet('listOptions'), null);
  await BC.cacheSave('tok-A', 'listHrNotices', { ok: true, v: 'y' });
  assert.equal(BC.cacheGet('listHrNotices'), null);
  BC.__resetForTest();
});

test('localStorage 滿額（setItem 拋錯）→ 靜默略過，不影響流程', async () => {
  const st = fakeStore();
  st.setItem = function () { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; };
  BC.__setStoreForTest(st);
  await BC.cacheSave('tok-A', 'listOptions', { ok: true, v: 'x' });   // 不得拋出
  BC.__resetForTest();
});

test('沒有 store（隱私模式）→ 整個模組退化成「永遠沒有快取」', async () => {
  BC.__setStoreForTest(null);
  await BC.cacheSave('tok-A', 'listOptions', { ok: true, v: 'x' });
  const map = await BC.cacheBootstrap('tok-A');
  assert.deepEqual(map, {});
  BC.__resetForTest();
});

test('沒有 WebCrypto（非 secure context）→ 整個模組退化成「永遠沒有快取」', async () => {
  const st = fakeStore(); BC.__setStoreForTest(st);
  BC.__setCryptoForTest(null);
  await BC.cacheSave('tok-A', 'listOptions', { ok: true, v: 'x' });
  assert.equal(st.length, 0, '沒有 subtle 就不該寫入任何東西');
  const map = await BC.cacheBootstrap('tok-A');
  assert.deepEqual(map, {}, 'bootstrap 要回空 map，不得拋錯');
  BC.__resetForTest();
});

test('WebCrypto 消失不得讓既有快取變成拋錯', async () => {
  const st = fakeStore(); BC.__setStoreForTest(st);
  await BC.cacheSave('tok-A', 'listOptions', { ok: true, v: 'x' });   // 先用真 crypto 寫一筆
  assert.equal(st.length, 1);
  BC.__setCryptoForTest(null);                                        // 再讓 crypto 消失
  const map = await BC.cacheBootstrap('tok-A');                       // 不得拋錯
  assert.deepEqual(map, {});
  assert.equal(st.length, 1, '解不開不代表要刪——沒有 subtle 時不該動磁碟');
  BC.__resetForTest();
});

test('persistBatchSlices：逐支存，失敗切片不存', async () => {
  const st = fakeStore(); BC.__setStoreForTest(st);
  const env = { ok: true, results: {
    getRosterList: { ok: true, rows: [1] },
    listOptions:   { ok: false, msg: '此連結非您的權限範圍。' }
  } };
  await BC.persistBatchSlices('tok-A', env, [{ a: 'getRosterList' }, { a: 'listOptions' }], BC.nameOfSlice);

  const map = await BC.cacheBootstrap('tok-A');
  assert.ok(map.getRosterList, '成功那支要存');
  assert.equal(map.listOptions, undefined, '失敗那支不得存');
  BC.__resetForTest();
});

test('persistBatchSlices：外層 ok:false 完全不寫，且不覆蓋既有成功快取', async () => {
  const st = fakeStore(); BC.__setStoreForTest(st);
  await BC.cacheSave('tok-A', 'getRosterList', { ok: true, rows: ['old'] });
  await BC.persistBatchSlices('tok-A',
    { ok: false, msg: '連線失敗' },
    [{ a: 'getRosterList' }], BC.nameOfSlice);

  const map = await BC.cacheBootstrap('tok-A');
  assert.deepEqual(map.getRosterList.value.rows, ['old']);
  BC.__resetForTest();
});

test('persistBatchSlices：params 取自 requestItems，不是回應', async () => {
  const st = fakeStore(); BC.__setStoreForTest(st);
  const seen = [];
  const spy = function (a, slice, params) { seen.push([a, params]); return BC.nameOfSlice(a, slice, params); };
  const env = { ok: true, results: {
    getSeatingBoard: { ok: true, actId: 'FROM-RESPONSE' },
    previewPassBroadcast: { ok: true }
  } };
  await BC.persistBatchSlices('tok-A', env, [
    { a: 'getSeatingBoard', p: { actId: 'midyear2026' } },
    { a: 'previewPassBroadcast', p: { actId: 'midyear2026', tpl: '' } }
  ], spy);

  assert.deepEqual(seen.find((x) => x[0] === 'getSeatingBoard')[1], { actId: 'midyear2026' });
  const map = await BC.cacheBootstrap('tok-A');
  assert.ok(map['getSeatingBoard:midyear2026'], '名稱要用請求的 actId');
  assert.equal(map['getSeatingBoard:FROM-RESPONSE'], undefined);
  // preview 自 2026-08-23 起也落地（tpl 為空的那一份），名稱同樣得取自請求的 actId。
  // 本測試的主題是「params 從哪裡來」，不是 preview 存不存——所以斷言跟著改，題目不變。
  assert.ok(map['previewPassBroadcast:midyear2026'], 'preview 的名稱也要用請求的 actId');
  assert.equal(Object.keys(map).length, 2);
  BC.__resetForTest();
});

test('persistBatchSlices：requestItems 缺該支 → 傳 {} 不拋錯', async () => {
  const st = fakeStore(); BC.__setStoreForTest(st);
  await BC.persistBatchSlices('tok-A',
    { ok: true, results: { getRosterList: { ok: true, rows: [] } } },
    [], BC.nameOfSlice);
  const map = await BC.cacheBootstrap('tok-A');
  assert.ok(map.getRosterList);
  BC.__resetForTest();
});

test('persistBatchSlices：results 空或缺漏 → 不拋錯、不寫入', async () => {
  const st = fakeStore(); BC.__setStoreForTest(st);
  await BC.persistBatchSlices('tok-A', { ok: true, results: {} }, [], BC.nameOfSlice);
  await BC.persistBatchSlices('tok-A', { ok: true }, [], BC.nameOfSlice);
  await BC.persistBatchSlices('tok-A', null, [], BC.nameOfSlice);
  assert.equal(st.length, 0);
  BC.__resetForTest();
});

test('persistBatchSlices 回的 Promise 要等所有加密寫入落地才 resolve', async () => {
  const st = fakeStore(); BC.__setStoreForTest(st);
  await BC.persistBatchSlices('tok-A',
    { ok: true, results: { getRosterList: { ok: true, rows: [1] }, listOptions: { ok: true, rows: [2] } } },
    [{ a: 'getRosterList' }, { a: 'listOptions' }], BC.nameOfSlice);
  assert.equal(st.length, 2, 'resolve 當下兩筆都必須已經在磁碟上');
  BC.__resetForTest();
});

test('queueRead：任一時刻只有一個任務在跑', async () => {
  let running = 0, maxRunning = 0;
  const task = async () => {
    running++; maxRunning = Math.max(maxRunning, running);
    await sleep(10);
    running--;
  };
  await Promise.all([BC.queueRead(task), BC.queueRead(task), BC.queueRead(task)]);
  assert.equal(maxRunning, 1, '同時最多一個');
});

test('queueRead：前一個 reject，後面的仍會跑', async () => {
  let ran = false;
  const bad = BC.queueRead(() => Promise.reject(new Error('boom')));
  await bad.catch(() => {});
  await BC.queueRead(async () => { ran = true; });
  assert.equal(ran, true);
});

test('queueRead：任務要等持久化落地才 resolve，下一支才讀得到新值', async () => {
  const st = fakeStore(); BC.__setStoreForTest(st);
  let seen = null;
  await BC.queueRead(async () => {
    await BC.cacheSave('tok-A', 'listOptions', { ok: true, v: 'new' });
  });
  await BC.queueRead(async () => {
    const map = await BC.cacheBootstrap('tok-A');
    seen = map.listOptions && map.listOptions.value.v;
  });
  assert.equal(seen, 'new', '前一支寫進去的，後一支必須看得到');
  BC.__resetForTest();
});

test('queueRead 回傳值就是 fn 的回傳值', async () => {
  const v = await BC.queueRead(() => Promise.resolve(42));
  assert.equal(v, 42);
});

/* 🔴 撤權的每一條路都要真的把磁碟清空——`?t=` 那條路 2026-09-16 之前就會清，
 *    LINE 那兩條不會。逐條跑，不要只跑其中一條。 */
['revoked_token_path', 'revoked_line_path', 'revoked_line_path_local', 'token_removed']
  .forEach((key) => {
    test('handleVerdict：撤銷（' + key + '）→ 清持久快取、清記憶體、之後 cacheGet 恆 null', async () => {
      const st = fakeStore(); BC.__setStoreForTest(st);
      await BC.cacheSave('tok-A', 'listOptions', { ok: true, v: 'x' });
      await BC.cacheBootstrap('tok-A');
      assert.ok(BC.cacheGet('listOptions'), '⬛ 零點：快取要先存得進去，否則下面清不清都一樣');

      const v = await BC.handleVerdict('tok-A', 信封(key));
      assert.equal(v, 'revoked', key + ' 判成 ' + v + ' ⇒ 他裝置上那份快取不會被清掉');
      assert.equal(st.length, 0, '磁碟要清空');
      assert.equal(BC.cacheGet('listOptions'), null, '記憶體也要清');
      assert.equal(BC.isRevoked(), true);
      BC.__resetForTest();
    });
  });

test('handleVerdict：離線 → 保留快取，不標撤銷', async () => {
  const st = fakeStore(); BC.__setStoreForTest(st);
  await BC.cacheSave('tok-A', 'listOptions', { ok: true, v: 'x' });
  await BC.cacheBootstrap('tok-A');

  const v = await BC.handleVerdict('tok-A', { ok: false, msg: '連線逾時，請重新整理。' });
  assert.equal(v, 'offline');
  assert.ok(BC.cacheGet('listOptions'), '離線時快取必須留著');
  assert.equal(BC.isRevoked(), false);
  BC.__resetForTest();
});

/* ⬛ 對照組②：**沒有被撤權**的人，行為一格都不能變。
 *    角色不符是 2026-07-30 線上事故（看到權限訊息就蓋整頁）的迴歸測試；
 *    上游故障與回退鈕那兩格更貴——判成撤銷就是清光全體的離線資料。 */
['role_mismatch_token', 'role_mismatch_line', 'line_upstream', 'line_needs_sheet',
 'line_unbound', 'line_bad_token']
  .forEach((key) => {
    test('handleVerdict：⬛ 不是撤權（' + key + '）→ 什麼都不做', async () => {
      const st = fakeStore(); BC.__setStoreForTest(st);
      await BC.cacheSave('tok-A', 'listOptions', { ok: true, v: 'x' });
      await BC.cacheBootstrap('tok-A');

      const v = await BC.handleVerdict('tok-A', 信封(key));
      assert.equal(v, 'ok');
      assert.ok(BC.cacheGet('listOptions'), key + ' 竟然清了快取');
      assert.equal(BC.isRevoked(), false, key + ' 竟然標成撤銷 ⇒ 之後整頁被蓋掉');
      BC.__resetForTest();
    });
  });

test('offlineLabel：把時間戳講成人看得懂的一句話', () => {
  const s = BC.offlineLabel(new Date(2026, 7, 19, 9, 5).getTime());
  assert.ok(s.indexOf('離線') >= 0);
  assert.ok(s.indexOf('8/19') >= 0);
  assert.ok(s.indexOf('09:05') >= 0);
});

test('currentTaipeiYear：裝置在西半球的跨年時刻，仍回台北的年度', () => {
  // 2026-01-01 00:30 台北 = 2025-12-31 16:30 UTC
  const t = Date.UTC(2025, 11, 31, 16, 30);
  assert.equal(BC.currentTaipeiYear(t), 2026);
});

test('currentTaipeiYear：台北仍是去年時不得提前跳年', () => {
  const t = Date.UTC(2025, 11, 31, 10, 0);   // 台北 2025-12-31 18:00
  assert.equal(BC.currentTaipeiYear(t), 2025);
});

const P = (o) => BC.planCheckinBundle(o);

test('planCheckinBundle：第二發還在飛 → 等它，不另送', () => {
  assert.deepEqual(P({ secondPending: true, tpl: '', stationsCached: true, previewUsable: true, verdict: 'ok' }),
    { wait: true, send: null });
  // 不同活動也一樣要等，不得回「立刻送」
  assert.deepEqual(P({ secondPending: true, tpl: '', stationsCached: false, previewUsable: false, verdict: 'ok' }),
    { wait: true, send: null });
});

test('planCheckinBundle：tpl 空＋兩支都有 → 不發請求', () => {
  assert.deepEqual(P({ secondPending: false, tpl: '', stationsCached: true, previewUsable: true, verdict: 'ok' }),
    { wait: false, send: [] });
});

test('planCheckinBundle：tpl 非空 → preview 一律重查，stations 可沿用', () => {
  assert.deepEqual(P({ secondPending: false, tpl: '改過的', stationsCached: true, previewUsable: true, verdict: 'ok' }),
    { wait: false, send: ['previewPassBroadcast'] });
});

test('planCheckinBundle：tpl 非空＋兩支都沒有 → 一支 batch 帶兩支', () => {
  assert.deepEqual(P({ secondPending: false, tpl: 'x', stationsCached: false, previewUsable: false, verdict: 'ok' }),
    { wait: false, send: ['listStaffStations', 'previewPassBroadcast'] });
});

test('planCheckinBundle：撤銷或離線 → 什麼都不送', () => {
  assert.deepEqual(P({ secondPending: false, tpl: '', stationsCached: false, previewUsable: false, verdict: 'revoked' }),
    { wait: false, send: [] });
  assert.deepEqual(P({ secondPending: false, tpl: '', stationsCached: false, previewUsable: false, verdict: 'offline' }),
    { wait: false, send: [] });
});

// ── takeOnce：第二發的切片只能被消費一次 ─────────────────────────────────────
// 為何要測（2026-08-19 外部審查）：SECOND 只 resolve 一次，pick2(a) 每次都回同一份
// 開頁快照。所有「寫入後的重載」（刪範本→snLoad、發 LINE→snLoad、發佈桌次→loadSeating、
// 新增單位→loadOptionsAdmin、恢復駁回→loadLog）都被舊快照攔截，且零錯誤訊息。
// pick2 活在頁面的 inline script 裡測不到，所以判斷抽成這支純函式。
const T = BC.takeOnce;

test('takeOnce：同一個 action 只有第一次回 true，之後恆 false', () => {
  const used = {};
  assert.equal(T(used, 'getRosterList'), true);    // 第一次：可沿用第二發的切片
  assert.equal(T(used, 'getRosterList'), false);   // 寫入後重載：必須自己重打
  assert.equal(T(used, 'getRosterList'), false);   // 第三次以後仍然 false
});

test('takeOnce：不同 action 各自算一次，不互相消費', () => {
  const used = {};
  assert.equal(T(used, 'listOptions'), true);
  assert.equal(T(used, 'listHrNotices'), true);    // 被上一支消費掉就錯了
  assert.equal(T(used, 'listOptions'), false);
  assert.equal(T(used, 'listHrNotices'), false);
  // 兩頁各有自己的帳本，互不影響
  const other = {};
  assert.equal(T(other, 'listOptions'), true);
});

test('takeOnce：壞輸入一律回 false（保守：回 false 只是多打一支，回 true 會發出錯的 LINE）', () => {
  assert.equal(T(null, 'getSeatingBoard'), false);
  assert.equal(T(undefined, 'getSeatingBoard'), false);
  assert.equal(T({}, ''), false);
  assert.equal(T({}, undefined), false);
  // 原型上的名字不可被誤判成「已用過」——直接取值會拿到 Object.prototype.constructor
  assert.equal(T({}, 'constructor'), true);
  assert.equal(T({}, 'toString'), true);
});

// ── 舊 iOS Safari 的兩個零錯誤訊息陷阱 ──────────────────────────────────────
test('currentTaipeiYear：Intl 對 IANA 時區丟 RangeError 時要退回裝置年，不得往外拋', () => {
  // 為何（2026-08-19 外部審查）：舊 Safari／精簡版 ICU 對非 UTC 的 timeZone 會丟 RangeError。
  // 這支的呼叫端在同步的頂層路徑上（stats.html 組第二發的 batch 參數、snLoad），
  // 拋出去 → SECOND reject → 桌次／報到／員工三個分頁永遠停在「載入中…」。
  // 與 2026-07-31 AbortController 在 iOS 12.1 炸掉整頁同型。
  const real = Intl.DateTimeFormat;
  Intl.DateTimeFormat = function () { throw new RangeError('Invalid time zone specified: Asia/Taipei'); };
  try {
    const y = BC.currentTaipeiYear(Date.UTC(2026, 7, 19, 12));
    assert.equal(y, new Date(Date.UTC(2026, 7, 19, 12)).getFullYear());
  } finally {
    Intl.DateTimeFormat = real;
  }
  // 還原後行為不變（確認上面的 stub 真的有被拆掉，不是測試互相污染）
  assert.equal(BC.currentTaipeiYear(Date.UTC(2026, 0, 1, 0)), 2026);
});

test('revokedOverlay：四個位移要長寫，不可只靠 inset（Safari 14.1 以前不認得）', () => {
  // 只寫 inset:0 → 舊 iOS 整條宣告被丟棄 → 四個位移退回 auto → 覆蓋層縮成小白框，
  // 底下已經畫滿的 153 人姓名照樣看得見，且零錯誤訊息。
  let styleStr = '';
  const el = { id: '', innerHTML: '', setAttribute(k, v) { if (k === 'style') styleStr = v; } };
  global.document = {
    getElementById() { return null; },
    createElement() { return el; },
    body: { appendChild() {} },
  };
  try {
    BC.revokedOverlay();
    ['top:0', 'right:0', 'bottom:0', 'left:0'].forEach((p) => {
      assert.ok(styleStr.indexOf(p) >= 0, '覆蓋層樣式缺 ' + p + '：' + styleStr);
    });
    assert.ok(styleStr.indexOf('position:fixed') >= 0);
  } finally {
    delete global.document;
  }
});

// ── 髒旗標：使用者動過的區塊，背景重繪不准蓋掉（2026-08-20 誤發事故後補）──────
// 在 vm 裡給一個假 document 真的跑一次事件流程——只測 isDirty/clearDirty 的純語意
// 會漏掉「監聽有沒有真的掛上」，而那正是這支唯一會壞的地方。
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
function loadWithFakeDom() {
  const listeners = {};
  const el = {
    __jdcDirtyBound: false,
    addEventListener(type, fn, capture) { (listeners[type] = listeners[type] || []).push({ fn, capture }); },
  };
  const ctx = {
    console, Promise, Date, Math, JSON, Object, Array, String, Number, isFinite,
    document: { getElementById(id) { return id === 'box' ? el : null; } },
  };
  vm.createContext(ctx);
  const src = fs.readFileSync(path.join(__dirname, '..', 'assets', 'board-cache.js'), 'utf8')
    .replace(/if \(typeof module[\s\S]*$/, '');
  vm.runInContext(src, ctx, { filename: 'board-cache.js' });
  return { ctx, el, listeners };
}

test('watchDirty：把 input／change 掛在容器上，且用捕獲階段（子元素被換掉也不必重掛）', () => {
  const { ctx, el, listeners } = loadWithFakeDom();
  assert.equal(ctx.isDirty('box'), false, '起始不該是髒的');
  ctx.watchDirty('box');
  assert.deepEqual(Object.keys(listeners).sort(), ['change', 'input']);
  assert.ok(listeners.input.every((l) => l.capture === true), '必須用捕獲階段');
  assert.equal(el.__jdcDirtyBound, true);
});

test('watchDirty：同一個容器掛兩次不會重複綁', () => {
  const { ctx, listeners } = loadWithFakeDom();
  ctx.watchDirty('box'); ctx.watchDirty('box'); ctx.watchDirty('box');
  assert.equal(listeners.input.length, 1, '重複呼叫應該只綁一次');
});

test('watchDirty：使用者一動就變髒，clearDirty 才清掉', () => {
  const { ctx, listeners } = loadWithFakeDom();
  ctx.watchDirty('box');
  assert.equal(ctx.isDirty('box'), false);
  listeners.input[0].fn();                       // 模擬使用者打字
  assert.equal(ctx.isDirty('box'), true, '打字之後必須是髒的');
  ctx.clearDirty('box');
  assert.equal(ctx.isDirty('box'), false, 'clearDirty 之後必須乾淨');
});

test('watchDirty：容器不存在時安靜略過，不得拋錯', () => {
  const { ctx } = loadWithFakeDom();
  assert.doesNotThrow(() => ctx.watchDirty('不存在的id'));
  assert.equal(ctx.isDirty('不存在的id'), false);
});

// ── 報到碼通知落地快取（2026-08-23）────────────────────────────────────
// 為何推翻 3.3.3 的「恆不落地」：使用者 2026-08-23 指示「照資深員工通知當時怎麼做，
// 就怎麼做」。資深通知（getSeniorNotice）同樣是「範本＋名單＋發送狀態」算出來的資料、
// 下游同樣是收不回來的 LINE，它是落地快取的，且 2026-08-20 誤發事故後使用者已明確
// 拍板「保留秒顯，只修漏洞」。兩張長得幾乎一樣的卡不該一張秒顯、一張每次白等。
//
// 安全性不靠快取正確，靠三道既有防線（都查證過）：
//   ① 網路回來會覆蓋（兩段繪製，與 renderSenior 同形）
//   ② 送出前的 confirm 把狀態講進確認框
//   ③ 後端 doPassBroadcast_ 的冪等網（Code.js 的 res.skipped / skippedNames）
//      ＋送出當下重驗 published / eventDate / templateHasUrl
test('N.preview：以 actId 分開，切活動不會吃到別場的預覽', () => {
  assert.equal(BC.N.preview('midyear2026'), 'previewPassBroadcast:midyear2026');
  assert.notEqual(BC.N.preview('a'), BC.N.preview('b'));
});

test('nameOfSlice：previewPassBroadcast 只在 tpl 為空時落地（那份才等於伺服器存的範本）', () => {
  assert.equal(BC.nameOfSlice('previewPassBroadcast', { ok: true }, { actId: 'a', tpl: '' }),
    'previewPassBroadcast:a');
  assert.equal(BC.nameOfSlice('previewPassBroadcast', { ok: true }, { actId: 'a' }),
    'previewPassBroadcast:a', 'tpl 未帶＝後端退回存起來的那份，與空字串等價');
});

test('nameOfSlice：tpl 有內容 → 不落地（那是使用者還沒按儲存的草稿）', () => {
  // 存下去的話，下次開頁會秒顯一份根本沒存進伺服器的範本，而使用者以為存過了。
  assert.equal(BC.nameOfSlice('previewPassBroadcast', { ok: true }, { actId: 'a', tpl: '改過的範本' }), null);
  // 只有空白也算沒帶——與後端 String(tpl||'').trim() || passTemplate_() 同一條規則。
  // 這裡刻意用「純空白」而不是空字串：兩者在 JS 是不同的值，但後端視為同一件事，
  // 前端算名稱時若只比 ===''，空白字串會被當成草稿而永遠不落地（靜默失效）。
  assert.equal(BC.nameOfSlice('previewPassBroadcast', { ok: true }, { actId: 'a', tpl: '   ' }),
    'previewPassBroadcast:a');
});

test('cacheDrop：只刪指定那一個鍵，同指紋的其他快取不受牽連', async () => {
  const st = fakeStore(); BC.__setStoreForTest(st);
  await BC.cacheSave('tok-A', 'previewPassBroadcast:a', { ok: true, willSend: 137 });
  await BC.cacheSave('tok-A', 'getRosterList', { ok: true, rows: ['王小明'] });
  await BC.cacheDrop('tok-A', 'previewPassBroadcast:a');
  assert.equal(BC.cacheGet('previewPassBroadcast:a'), null, '記憶體要一起清，否則本次開頁仍讀得到舊值');
  assert.ok(BC.cacheGet('getRosterList'), '別人的快取不該被牽連');
  // 磁碟也要真的沒了——只清 _mem 的話，重新整理又會把舊狀態撈回來。
  await BC.cacheBootstrap('tok-A');
  assert.equal(BC.cacheGet('previewPassBroadcast:a'), null, '重開頁仍不該讀到已失效的預覽');
  assert.ok(BC.cacheGet('getRosterList'));
});

test('cacheDrop：沒有 store（隱私模式）或鍵不存在 → 安靜完成，不丟例外', async () => {
  BC.__setStoreForTest(null);
  await BC.cacheDrop('tok-A', 'previewPassBroadcast:a');
  const st = fakeStore(); BC.__setStoreForTest(st);
  await BC.cacheDrop('tok-A', '不存在的鍵');
});
