/**
 * #123：`stats.html` 的寫入呼叫在自動重送時要帶**同一個** nonce；發送入口傳輸失敗時要說「不確定有沒有送出」。
 *
 * 🔴 **由來**（#121 查證）：本頁 `jsonp` 決定要不要自動重送，看的是「有沒有傳 timeoutMs」，不是讀或寫。
 *    原註解寫「僅限讀取」，前提不成立——十幾支寫入沒帶 timeoutMs，GAS 404 後 2 秒照樣重送一次，
 *    而且不帶 nonce ⇒ 後端再執行一次。`removeSeniorTemplate` 會多刪一則（後端用「第幾則」刪）、
 *    `addGuests`（走 jsonpW，最多共送 3 次）會重複寫入整包來賓列，畫面兩者都顯示成功。
 *
 * ⚠️ 這一檔**真的把頁面跑起來**（`helpers/page-stub.js`），由替身 fetch 讓第一發回 GAS 404 那種非 JSONP 回應，
 *    再看兩發送出去的網址是不是同一個 nonce。只掃原始碼的話，量到的是「有沒有寫 nonce」，
 *    量不到「重送時是不是同一個」——那正是唯一會靜默失效的地方。
 *
 * 檢核代號對照票上：K1 同一個 nonce／K2 重按換新的／K3 讀取不變／K4 發送入口分得出傳輸失敗。
 * 最後一段是完整性掃描：**每一個** jsonp／jsonpW 呼叫不是在唯讀白名單裡，就是帶 nonce（二擇一，逼新增的人表態）。
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { runPage, settle, waitFor, execOnly, fakeEl, ROOT } = require('./helpers/page-stub.js');

const FILE = 'stats.html';
const SRC = fs.readFileSync(path.join(ROOT, FILE), 'utf8');

async function drain() { for (let i = 0; i < 15; i++) await settle(); }

const actionOf = (u) => new URL(u).searchParams.get('action');
const nonceOf = (u) => new URL(u).searchParams.get('nonce');

/**
 * 起一頁 stats（①舊路，AUTH_OK 同步為真），換上：
 *   - 依 id 記住的假 DOM（handler 讀 `.value`／寫 `.textContent` 都看得到）
 *   - 可排程的 fetch：`plan[action]` 是一串回應，用完就回預設 `{ok:true}`
 *   - 重送間隔（jsonp 的 2000ms、jsonpW 的 1500ms）縮成 1ms，其餘計時器不動
 */
function boot() {
  const r = runPage({ file: FILE, search: '?t=STUBTOKEN&act=A1' });
  const { ctx, urls } = r;
  const plan = {};
  ctx.fetch = (u) => {
    urls.push(String(u));
    const a = actionOf(String(u));
    const q = plan[a];
    // 沒排程的一律 {ok:false}：不讓假 DOM 上的渲染器去碰它不需要的欄位（同 stats-e1b-wiring 的 replying）
    const step = (q && q.length) ? q.shift() : { ok: false, msg: '測試替身' };
    // GAS 404：回的是 HTML，沒有 JSONP 外皮 ⇒ 頁面的解析會丟 'bad'——與「斷線」同一條傳輸失敗路徑
    if (step === 404) return Promise.resolve({ text: () => Promise.resolve('<!DOCTYPE html><html><body>404 Not Found</body></html>') });
    return Promise.resolve({ text: () => Promise.resolve('cb(' + JSON.stringify(step) + ')') });
  };
  const els = {};
  ctx.document.getElementById = (id) => (els[id] = els[id] || fakeEl());
  const origSet = ctx.setTimeout;
  ctx.setTimeout = (fn, ms) => origSet(fn, (ms === 2000 || ms === 1500) ? 1 : ms);
  ctx.confirm = () => true;
  ctx.prompt = () => 'X';
  return Object.assign(r, { plan, els });
}

const sent = (urls, action, from) => execOnly(urls).slice(from || 0).filter((u) => actionOf(u) === action);

/* ══ 單發寫入：每一個 handler 都量 ══════════════════════════════════════ */
// 每一項＝一個使用者動作。setup 把 handler 會讀的畫面值填好；body 是成功時後端回的東西。
const SINGLE = [
  { action: 'grantRefill', setup: (c, e) => { e['refill-act'] = val('A1'); e['refill-person'] = val('U:U1'); },
    run: (c) => c.doGrantRefill(), body: { ok: true, msg: '已開放' } },
  { action: 'revokeRefill', run: (c) => c.doRevokeRefill('A1', 'U1', '甲') },
  { action: 'setTables', setup: (c, e) => { e['ti-act'] = val('A1'); }, run: (c) => c.moveSeat('emp', 'I1', '甲') },
  { action: 'setGuestTable', setup: (c, e) => { e['ti-act'] = val('A1'); }, run: (c) => c.moveSeat('guest', '5', '乙') },
  { action: 'publishTables', setup: (c, e) => { e['ti-act'] = val('A1'); c.SB = { pubState: 'dirty' }; }, run: (c) => c.seatPublish() },
  { action: 'unpublishTables', setup: (c, e) => { e['ti-act'] = val('A1'); c.SB = { pubState: 'clean' }; }, run: (c) => c.seatUnpublish() },
  { action: 'saveSeniorTemplate', setup: (c, e) => { e['sn-idx'] = val('0'); }, run: (c) => c.snSaveTpl() },
  { action: 'addSeniorTemplate', run: (c) => c.snAddTpl(), body: { ok: true, idx: 1 } },
  { action: 'removeSeniorTemplate', setup: (c, e) => { e['sn-idx'] = val('1'); c.SN = { titles: ['一', '二'], status: {} }; },
    run: (c) => c.snDelTpl() },
  { action: 'addStaffStation', tag: 'addStaffStation（新增）', setup: (c, e) => { e['st-name'] = val('站一'); },
    run: (c) => c.stAdd(), body: { ok: true, station: '站一' } },
  { action: 'addStaffStation', tag: 'addStaffStation（換發）', run: (c) => c.stRegen('TOK', '站一'), body: { ok: true, station: '站一' } },
  { action: 'removeStaffStation', run: (c) => c.stDel('TOK', '站一') },
  { action: 'cancelPassSchedule', setup: (c, e) => { e['ck-act'] = val('A1'); c.BC_SCHED = { status: 'scheduled', date: '2026-10-10' }; },
    run: (c) => c.bcSchedule() },
  { action: 'schedulePassBroadcast', setup: (c, e) => { e['ck-act'] = val('A1'); e['bc-date'] = val('2026-10-10'); c.BC_SCHED = null; },
    run: (c) => c.bcSchedule() },
  { action: 'savePassTemplate', run: (c) => c.bcSaveTpl() },
  { action: 'addActivity', setup: (c, e) => { e['na-name'] = val('中秋'); e['na-deadline'] = val('2026-10-10'); },
    run: (c) => c.createAct(), body: { ok: true, id: 'A2', deadline: '2026-10-10' } },
  { action: 'setActivityStatus', run: (c) => c.setSt('A1', '開放') },
  { action: 'deleteActivity', run: (c) => c.delAct('A1', '中秋') },
  { action: 'updateActivity', setup: (c) => { c.prompt = () => '2026-10-10'; }, run: (c) => c.chgDl('A1') },
];
function val(v) { const el = fakeEl(); el.value = v; return el; }

for (const s of SINGLE) {
  const tag = s.tag || s.action;

  test(`K1 ${tag}：第一發 404、自動重送成功 ⇒ 兩發帶同一個 nonce`, async () => {
    const h = boot();
    try {
      await drain();
      if (s.setup) s.setup(h.ctx, h.els);
      h.plan[s.action] = [404, s.body || { ok: true }];
      const from = execOnly(h.urls).length;
      s.run(h.ctx);
      const ok = await waitFor(() => sent(h.urls, s.action, from).length >= 2);
      const got = sent(h.urls, s.action, from);
      assert.ok(ok, tag + '：404 之後沒有自動重送（送了 ' + got.length + ' 發）——這一條的前提不成立，量不到 nonce');
      assert.equal(got.length, 2, tag + '：送了 ' + got.length + ' 發');
      const [n1, n2] = got.map(nonceOf);
      assert.ok(n1, tag + '：第一發沒帶 nonce ⇒ 404 後的自動重送會讓後端再執行一次');
      assert.equal(n2, n1, tag + '：重送換了 nonce（' + n1 + ' → ' + n2 + '）⇒ 後端認不出是同一次，照樣再執行一次');
    } finally { h.cleanup(); }
  });

  test(`K2 ${tag}：使用者按兩次 ⇒ 兩個不同的 nonce（不誤擋真正的第二次）`, async () => {
    const h = boot();
    try {
      await drain();
      if (s.setup) s.setup(h.ctx, h.els);
      h.plan[s.action] = [s.body || { ok: true }, s.body || { ok: true }];
      const from = execOnly(h.urls).length;
      s.run(h.ctx);
      await waitFor(() => sent(h.urls, s.action, from).length >= 1);
      if (s.setup) s.setup(h.ctx, h.els);        // 成功分支會清輸入框，第二次照使用者重新填好
      s.run(h.ctx);
      await waitFor(() => sent(h.urls, s.action, from).length >= 2);
      const got = sent(h.urls, s.action, from).map(nonceOf);
      assert.equal(got.length, 2, tag + '：兩次點擊送了 ' + got.length + ' 發');
      assert.ok(got[0] && got[1], tag + '：有一發沒帶 nonce');
      assert.notEqual(got[0], got[1],
        tag + '：兩次點擊同一個 nonce ⇒ 後端把第二次當成重送、**靜默不執行**（nonce 被提到 handler 外面了）');
    } finally { h.cleanup(); }
  });
}

/* ══ 分包寫入（jsonpW）：每一包各自一個 nonce，重送沿用 ════════════════ */

function guestAoa(n) {
  const rows = [['負責人員', '廠商名稱', '參加人數']];
  for (let i = 0; i < n; i++) rows.push(['甲', '測試廠商' + '名'.repeat(60) + i, 1]);
  return rows;
}

test('K1 clearGuests＋addGuests：每一包第一發 404 ⇒ 重送同一個 nonce；不同包、不同 nonce', async () => {
  const h = boot();
  try {
    await drain();
    h.els['ti-act'] = val('A1');
    h.ctx.SB = null;
    h.ctx.readSheetAoa_ = () => Promise.resolve(guestAoa(20));
    h.plan.clearGuests = [404, { ok: true }];
    h.plan.addGuests = [];
    for (let i = 0; i < 20; i++) h.plan.addGuests.push(404, { ok: true, added: 1 });
    const from = execOnly(h.urls).length;
    h.ctx.upGuests({ files: [{}], value: '' });
    await waitFor(() => /完成/.test(h.els['gl-msg'] && h.els['gl-msg'].textContent));
    assert.match(h.els['gl-msg'].textContent, /完成/, '匯入沒有跑完：' + (h.els['gl-msg'] || {}).textContent);

    const cg = sent(h.urls, 'clearGuests', from).map(nonceOf);
    assert.equal(cg.length, 2);
    assert.ok(cg[0], 'clearGuests 沒帶 nonce');
    assert.equal(cg[1], cg[0], 'clearGuests 重送換了 nonce');

    const ag = sent(h.urls, 'addGuests', from);
    assert.ok(ag.length >= 4 && ag.length % 2 === 0, '分包數不足以量「不同包、不同 nonce」（送了 ' + ag.length + ' 發）');
    const chunkNonces = [];
    for (let i = 0; i < ag.length; i += 2) {
      const a = nonceOf(ag[i]), b = nonceOf(ag[i + 1]);
      assert.ok(a, '第 ' + (i / 2 + 1) + ' 包沒帶 nonce ⇒ 404 那一包會重複寫入整包來賓列');
      assert.equal(b, a, '第 ' + (i / 2 + 1) + ' 包重送換了 nonce');
      assert.equal(new URL(ag[i]).searchParams.get('rows'), new URL(ag[i + 1]).searchParams.get('rows'), '重送的不是同一包');
      chunkNonces.push(a);
    }
    assert.equal(new Set(chunkNonces).size, chunkNonces.length,
      '兩包共用同一個 nonce ⇒ 後端把第二包當成第一包的重送、**不寫入**（後端的鍵只有 nonce 本身）');
  } finally { h.cleanup(); }
});

test('K1 setTables／setGuestTables／clearSeatMarks（排位匯入）：第一發 404 ⇒ 重送同一個 nonce', async () => {
  const h = boot();
  try {
    await drain();
    h.els['ti-act'] = val('A1');
    h.ctx.SB = { seats: [{ kind: 'emp', name: '甲', id: 'U1' }, { kind: 'guest', name: '乙', id: '5' }] };
    h.ctx.readSheetAoa_ = () => Promise.resolve([[]]);
    h.ctx.parseSeatingUpload = () => [{ name: '甲', table: '1' }, { name: '乙', table: '2' }];
    h.plan.setTables = [404, { ok: true, applied: 1 }];
    h.plan.setGuestTables = [404, { ok: true }];
    h.plan.clearSeatMarks = [404, { ok: true }];
    const from = execOnly(h.urls).length;
    h.ctx.upSeating({ files: [{}], value: '' });
    await waitFor(() => /匯入完成/.test(h.els['sm-msg'] && h.els['sm-msg'].textContent));
    assert.match(h.els['sm-msg'].textContent, /匯入完成/, '排位匯入沒有跑完：' + (h.els['sm-msg'] || {}).textContent);
    for (const a of ['setTables', 'setGuestTables', 'clearSeatMarks']) {
      const n = sent(h.urls, a, from).map(nonceOf);
      assert.equal(n.length, 2, a + ' 送了 ' + n.length + ' 發');
      assert.ok(n[0], a + ' 沒帶 nonce');
      assert.equal(n[1], n[0], a + ' 重送換了 nonce');
    }
  } finally { h.cleanup(); }
});

test('K2 upGuests 重新上傳 ⇒ clearGuests 換新的 nonce', async () => {
  const h = boot();
  try {
    await drain();
    h.els['ti-act'] = val('A1');
    h.ctx.SB = null;
    h.ctx.readSheetAoa_ = () => Promise.resolve(guestAoa(1));
    h.plan.clearGuests = [{ ok: true }, { ok: true }];
    h.plan.addGuests = [{ ok: true, added: 1 }, { ok: true, added: 1 }];
    const from = execOnly(h.urls).length;
    h.ctx.upGuests({ files: [{}], value: '' });
    await waitFor(() => sent(h.urls, 'addGuests', from).length >= 1);
    h.ctx.upGuests({ files: [{}], value: '' });
    await waitFor(() => sent(h.urls, 'clearGuests', from).length >= 2);
    const n = sent(h.urls, 'clearGuests', from).map(nonceOf);
    assert.equal(n.length, 2);
    assert.ok(n[0] && n[1]);
    assert.notEqual(n[0], n[1], '重新上傳沿用上一次的 nonce ⇒ 後端重播上一次、不清除');
  } finally { h.cleanup(); }
});

/* ══ K3：讀取呼叫行為不變 ═════════════════════════════════════════════ */

test('K3 讀取（沒帶 timeoutMs）第一發 404 ⇒ 照舊自動重送一次、而且不帶 nonce', async () => {
  const h = boot();
  try {
    await drain();
    h.plan.getBindLink = [404, { ok: true, url: 'x' }];
    const from = execOnly(h.urls).length;
    const r = await h.ctx.jsonp('getBindLink', { token: 'STUBTOKEN' });
    const got = sent(h.urls, 'getBindLink', from);
    assert.equal(got.length, 2, '讀取 404 後沒有自動重送（送了 ' + got.length + ' 發）');
    got.forEach((u) => assert.equal(nonceOf(u), null, '讀取帶了 nonce（每一發多一次 ScriptLock 與兩次 Property 讀寫）：' + u));
    assert.equal(r.ok, true, '重送成功了，回來的卻不是成功');
  } finally { h.cleanup(); }
});

test('K3 讀取兩發都 404 ⇒ 回失敗（transport:true），不卡住', async () => {
  const h = boot();
  try {
    await drain();
    h.plan.getBindLink = [404, 404];
    const r = await h.ctx.jsonp('getBindLink', { token: 'STUBTOKEN' });
    assert.equal(r.ok, false);
    assert.equal(r.transport, true);
  } finally { h.cleanup(); }
});

/* ══ K4：發送入口分得出「傳輸失敗」與「伺服器拒絕」 ══════════════════════ */

const SENDERS = [
  { name: 'snSend', msg: 'sn-msg', reload: (u) => actionOf(u) === 'getSeniorNotice',
    setup: (c, e) => {
      c.SN = { year: '2026', titles: ['一'], status: { 0: 'none' } };
      e['sn-idx'] = val('0'); e['sn-idx'].selectedOptions = [{ textContent: '一' }];
      c.document.querySelectorAll = (sel) => (sel === '.sn-ck:checked' ? [{ dataset: { uid: 'U1' }, checked: true }] : []);
    }, run: (c) => c.snSend() },
  { name: 'bcSendOne', msg: 'bc-msg', reload: (u) => /previewPassBroadcast/.test(decodeURIComponent(u)),
    setup: (c, e) => { e['ck-act'] = val('A1'); e['bc-one-sel'] = val('I1'); e['bc-one-sel'].selectedOptions = [{ textContent: '甲' }]; },
    run: (c) => c.bcSendOne() },
  { name: 'bcSend', msg: 'bc-msg', reload: (u) => /previewPassBroadcast/.test(decodeURIComponent(u)),
    setup: (c, e) => { e['ck-act'] = val('A1'); c.BC = { tplHasUrl: true, willSend: 3 }; },
    run: (c) => c.bcSend() },
];
const ACTION = { snSend: 'sendSeniorNotice', bcSendOne: 'sendPassBroadcast', bcSend: 'sendPassBroadcast' };

for (const s of SENDERS) {
  test(`K4 ${s.name}：傳輸失敗 ⇒ 說「不確定有沒有送出」並重新載入發送狀態；而且不自動重送`, async () => {
    const h = boot();
    try {
      await drain();
      s.setup(h.ctx, h.els);
      h.plan[ACTION[s.name]] = [404];
      const from = execOnly(h.urls).length;
      s.run(h.ctx);
      const reloaded = await waitFor(() => execOnly(h.urls).slice(from).some(s.reload));
      const text = h.els[s.msg].textContent;
      assert.match(text, /不確定有沒有送出/, s.name + ' 傳輸失敗卻說：「' + text + '」⇒ 引誘重按，超過 hub 120 秒就整批再送一次');
      assert.ok(reloaded, s.name + ' 傳輸失敗後沒有重新載入發送狀態 ⇒ 確認框的「已發送過」警告不會出現（實送：'
        + execOnly(h.urls).slice(from).map(actionOf).join(',') + '）');
      assert.equal(sent(h.urls, ACTION[s.name], from).length, 1, s.name + ' 自動重送了發送');
    } finally { h.cleanup(); }
  });

  test(`K4 ${s.name}：伺服器拒絕 ⇒ 照舊顯示它的拒絕訊息，不說「不確定」`, async () => {
    const h = boot();
    try {
      await drain();
      s.setup(h.ctx, h.els);
      h.plan[ACTION[s.name]] = [{ ok: false, msg: '名單有變動，請重新整理' }];
      const from = execOnly(h.urls).length;
      s.run(h.ctx);
      await waitFor(() => /名單有變動/.test(h.els[s.msg].textContent));
      assert.equal(h.els[s.msg].textContent, '名單有變動，請重新整理');
      assert.equal(sent(h.urls, ACTION[s.name], from).length, 1);
    } finally { h.cleanup(); }
  });
}

/* ══ 完整性：每一個 jsonp／jsonpW 呼叫，不是唯讀白名單，就是帶 nonce ══════ */
// 上面每一條都是對著已知的呼叫點寫的。守不到的是「日後有人加一支新的寫入、忘了帶 nonce」——
// 那支就會在 404 後靜默重跑。所以反過來掃全部呼叫點，兩邊都不符合就紅，逼新增的人表態。
// ⚠️ 讀取刻意不帶：每個帶 nonce 的呼叫，後端要多一次 ScriptLock 與兩次 Property 讀寫，讀取重播本來就無害。
const READ_ACTIONS = ['listActivities', 'getRefillCandidates', 'getSeatingBoard', 'getBindLink', 'getSeniorNotice',
  'batch', 'listStaffStations', 'listGuests', 'listOptions', 'getCheckinCodes', 'getActivityReplies',
  'getUndelivered', 'getActivityStats'];

test('每一個 jsonp／jsonpW 呼叫都必須「在唯讀白名單裡」或「帶事先產生的 nonce」，二擇一', () => {
  const CODE = SRC.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  const all = [];
  const re = /\bjsonpW?\(\s*'([A-Za-z]\w*)'/g;
  let m;
  while ((m = re.exec(CODE))) all.push({ action: m[1], idx: m.index });
  // 掃描器自己沒漏：字面量呼叫數＝全部呼叫數（扣掉 `(action,` 開頭的：兩支定義本身與它們內部的轉手／遞迴）
  const total = (CODE.match(/[^A-Za-z_$.]jsonpW?\(/g) || []).length
    - (CODE.match(/[^A-Za-z_$.]jsonpW?\(action,/g) || []).length
    - (CODE.match(/[^A-Za-z_$.]jsonpW?\(\)/g) || []).length;       // 行尾註解裡提到的 `jsonp()`，不是呼叫
  assert.equal(all.length, total, '有 ' + (total - all.length) + ' 個呼叫的 action 不是字面字串，這個掃描器看不到它們');
  assert.ok(all.length >= 40, '只掃到 ' + all.length + ' 個呼叫點——掃描器壞了');

  const missing = [], inline = [];
  all.forEach(({ action, idx }) => {
    if (READ_ACTIONS.indexOf(action) >= 0) return;
    const line = CODE.slice(idx, CODE.indexOf('\n', idx));
    const arg = line.slice(line.indexOf(',') + 1).trimStart();
    let params = line;
    if (!arg.startsWith('{')) {                        // 參數先組成變數再傳（grantRefill）
      const id = (arg.match(/^([A-Za-z_$][\w$]*)/) || [])[1];
      const decl = id && new RegExp('var\\s+' + id + '\\s*=\\s*\\{[^\\n]*').exec(CODE.slice(Math.max(0, idx - 1500), idx));
      params = decl ? decl[0] : '';
    }
    if (/nonce\s*:\s*newNonce\s*\(/.test(params)) inline.push(action);
    else if (!/nonce\s*:\s*[A-Za-z_$][\w$]*/.test(params)) missing.push(action);
  });
  assert.deepEqual(missing, [], '這些呼叫既不在唯讀白名單裡、也沒帶 nonce：' + missing.join('、')
    + '。本頁沒帶 timeoutMs 的呼叫 404 後會自動重送，jsonpW 對任何失敗再送最多兩次 ⇒ 寫入會靜默重跑。'
    + '寫入的請加 nonce；唯讀的請加進 READ_ACTIONS——兩者都要刻意表態');
  assert.deepEqual(inline, [], '這些呼叫在參數裡就地產生 nonce：' + inline.join('、') + '。請在呼叫前產生、存進變數再傳');
});

test('⬛ 對照組：完整性掃描器對「拿掉一支的 nonce」會命中', () => {
  const bad = SRC.replace("jsonp('removeSeniorTemplate',{token:q('t'),idx:i,nonce:nonce})",
    "jsonp('removeSeniorTemplate',{token:q('t'),idx:i})");
  assert.notEqual(bad, SRC, '對照組的替換沒命中——原始碼的寫法變了，這條要跟著改');
  const line = bad.split('\n').find((l) => l.indexOf("jsonp('removeSeniorTemplate'") >= 0);
  assert.ok(!/nonce\s*:\s*[A-Za-z_$][\w$]*/.test(line), '掃描器的判準對壞樣本也說有 nonce ⇒ 零鑑別力');
});

test('註解不再寫「僅限讀取」（那個前提不成立，#123）', () => {
  assert.equal(/僅限「?讀取」?/.test(SRC), false);
});
