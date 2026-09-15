/**
 * 「停在快取而刷新失敗」提示的**接線**測試（2026-09-13）。
 *
 * refresh-fail.test.js 釘的是 board-cache.js 的純函式與 DOM 行為；它證明不了頁面
 * **真的有呼叫**——同型的洞見 board-cache-wiring.test.js 檔頭（快取寫了兩個月沒人讀）。
 *
 * 手法：把 board.html 的函式原文抽出來，和**真的** board-cache.js 跑在同一個 vm context
 * （＝瀏覽器的 <script src> 再加內嵌 script），替身只給網路與繪製。
 *
 * 另有一條**絆線**：全站 `cacheGet(` 的呼叫數逐檔釘住。新增一個 SWR 區塊 ⇒ 數字變 ⇒ 紅，
 * 逼人回來決定它失敗時要不要說話。⚠️ 它只數得到 `cacheGet`——自己用 localStorage／
 * sessionStorage 做秒顯的頁面（checkin.html 的 swrGet、index.html 的 bstate／獎金卡）數不到，
 * 那幾處另列在交件報告裡。
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const S = require('./helpers/source-scan.js');

const ROOT = path.join(__dirname, '..');
const BC_SRC = fs.readFileSync(path.join(ROOT, 'assets', 'board-cache.js'), 'utf8');

/** 抽一支頂層函式的原文——走共用的 source-scan（引擎剖析），不自己手寫抽取式。 */
const grab = (file, name) => S.fnSrc(name, file);

/** 會真的插節點的最小 DOM。每個 id 都掛在同一個父節點下。 */
function makeDom(ids) {
  const nodes = {};
  const parent = {
    kids: [],
    insertBefore(el, ref) { this.kids.splice(Math.max(0, this.kids.indexOf(ref)), 0, el); el.parentNode = this; nodes[el.id] = el; },
    removeChild(el) { this.kids.splice(this.kids.indexOf(el), 1); delete nodes[el.id]; el.parentNode = null; },
  };
  ids.forEach((id) => {
    const el = { id, innerHTML: '', parentNode: parent, addEventListener() {} };
    parent.kids.push(el); nodes[id] = el;
  });
  const document = {
    getElementById: (id) => nodes[id] || null,
    createElement: () => ({ id: '', textContent: '', setAttribute() {} }),
  };
  return { document, nodes, parent };
}

function pageCtx(dom, extra) {
  const ctx = vm.createContext({ console, Promise, String, JSON, Object, Array, Date, Math, Number, isFinite,
    document: dom.document });
  vm.runInContext(BC_SRC, ctx, { filename: 'assets/board-cache.js' });   // 真貨
  Object.assign(ctx, extra);
  return ctx;
}

const tick = () => new Promise((r) => setTimeout(r, 10));
const AT = new Date(2026, 8, 12, 9, 5).getTime();
const UPSTREAM = { ok: false, reason: 'line_upstream', msg: '系統目前無法確認您的身分（不是您的問題）。' };
const HR_CACHE = { value: { ok: true, rows: [{ 姓名: '乙' }] }, savedAt: AT };

/* ══ board.html 人事異動（F5 點名的那一格）══════════════════════════════════ */

function runLoadHr({ cached, first }) {
  const dom = makeDom(['hr-pending']);
  const paints = []; const hints = [];
  const ctx = pageCtx(dom, {
    CACHE_READY: Promise.resolve(), TOKEN: 't',
    cacheGet: (n) => (n === 'getHrPending' ? cached : null),
    pick: () => Promise.resolve(first), jsonp: () => Promise.resolve(first),
    paintHr: (r) => paints.push(r), hintStale: (id) => hints.push(id),
  });
  vm.runInContext('var hrFirst=true, logLoaded=false;\n' + grab('board.html', 'loadHr'), ctx, { filename: 'board.html-loadHr' });
  ctx.loadHr();
  return tick().then(() => ({ ctx, dom, paints, hints }));
}

test('🔴 人事異動：有快取＋身分服務故障 → 清單只畫快取那一次（不重繪）、上方掛提示（時間＋後端 msg）', async () => {
  const { dom, paints, hints } = await runLoadHr({ cached: HR_CACHE, first: UPSTREAM });
  assert.equal(paints.length, 1, '失敗後又畫了一次 ⇒ 會蓋掉清單（或她正在改的生效日）');
  assert.equal(paints[0], HR_CACHE.value);
  const tag = dom.nodes['hr-pending-refail'];
  assert.ok(tag, '有快取而刷新失敗時沒有提示 ⇒ 就是這一次要修的缺陷');
  assert.equal(tag.textContent, '⚠️ 這裡顯示的是 9/12 09:05 的資料，目前無法更新：' + UPSTREAM.msg);
  assert.deepEqual(hints, [], '失敗時出了「伺服器上有較新的資料」⇒ 假話');
});

test('人事異動：刷新成功 → 畫第二次、沒有提示；之後的刷新（核定後）成功會拿掉上一輪的提示', async () => {
  const ok = { ok: true, rows: [] };
  const a = await runLoadHr({ cached: HR_CACHE, first: ok });
  assert.equal(a.paints.length, 2);
  assert.equal(a.dom.nodes['hr-pending-refail'], undefined);

  const b = await runLoadHr({ cached: HR_CACHE, first: UPSTREAM });
  assert.ok(b.dom.nodes['hr-pending-refail'], '前置：先要有提示');
  b.ctx.jsonp = () => Promise.resolve(ok);   // hrFirst 已是 false ⇒ 走 jsonp
  b.ctx.loadHr();
  await tick();
  assert.equal(b.dom.nodes['hr-pending-refail'], undefined, '成功後提示還在 ⇒ 最新資料被標成舊的');
});

test('⬛ 對照組 人事異動：沒有快取＋失敗 → 維持原本的錯誤框（paintHr 收到失敗），且沒有提示', async () => {
  const { dom, paints } = await runLoadHr({ cached: null, first: UPSTREAM });
  assert.equal(paints.length, 1);
  assert.equal(paints[0], UPSTREAM, '沒快取卻沒畫錯誤框 ⇒ 畫面停在「載入中」');
  assert.equal(dom.nodes['hr-pending-refail'], undefined, '錯誤框與提示同時出現');
});

/* ══ board.html 新人報到（使用者可能正在打字的那一格）══════════════════════ */

test('🔴 新人報到：有快取＋失敗＋她正在編輯 → 不重繪、掛提示，且**不**出「伺服器上有較新的資料」', async () => {
  const dom = makeDom(['pending']);
  const renders = []; const hints = [];
  const ctx = pageCtx(dom, {
    CACHE_READY: Promise.resolve(),
    cacheGet: (n) => ({ value: { ok: true, rows: [] }, savedAt: n === 'getCheckinPending' ? AT : 1 }),
    pick: () => Promise.resolve(UPSTREAM),
    renderLoad: (rs) => renders.push(rs), hintStale: (id) => hints.push(id),
    repaintEmpWarnings() {}, gEmpConflicts: {},
    isDirty: () => true,
  });
  vm.runInContext(grab('board.html', 'load'), ctx, { filename: 'board.html-load' });
  ctx.load();
  await tick();
  assert.equal(renders.length, 1, '只該有快取那一次');
  assert.deepEqual(hints, [], '刷新失敗時說「伺服器上有較新的資料」是假話');
  assert.match(dom.nodes['pending-refail'].textContent, /9\/12 09:05 的資料，目前無法更新：系統目前無法確認您的身分/);
});

/* ══ 絆線：全站 SWR 區塊清單 ═══════════════════════════════════════════════ */

/**
 * 每一檔的 `cacheGet(` 呼叫數（剝註解後）。**數字變了就是有人加／拆了秒顯區塊**
 * ⇒ 回來決定：它的網路段失敗時，畫面停在快取，有沒有說出來？
 * 重算：node -e 逐檔 stripComments(scriptText(f)).match(/\bcacheGet\(/g)
 */
const SWR_TABLE = {
  'board.html':            { cacheGet: 7, fns: ['load', 'loadHr', 'loadLog', 'loadRoster', 'loadOptionsAdmin'] },
  'stats.html':            { cacheGet: 7, fns: ['loadActs', 'loadTablesTab', 'loadCheckinTab', 'loadSeating', 'snLoad', 'loadCheckinBundle', 'loadStats'] },
  'attend.html':           { cacheGet: 4 },
  'line-messages.html':         { cacheGet: 2 },
  'hr-stats.html':         { cacheGet: 1 },
  'assets/anniv.js':       { cacheGet: 1 },
  'admin.html':            { cacheGet: 1, excluded: '命中快取就不打 API——沒有「第二段」，不是 SWR' },
  'assets/board-cache.js': { cacheGet: 1, excluded: '定義處（註解外只剩函式宣告那一個）' },
};

function codeOf(f) {
  return S.stripComments(f.endsWith('.html') ? S.scriptText(f) : fs.readFileSync(path.join(ROOT, f), 'utf8'));
}

test('絆線：全站 cacheGet( 的分布與清單一致（新增 SWR 區塊 ⇒ 紅，回來決定失敗時怎麼說）', () => {
  const files = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html'))
    .concat(fs.readdirSync(path.join(ROOT, 'assets')).filter((f) => f.endsWith('.js') && !f.endsWith('.min.js')).map((f) => 'assets/' + f));
  const seen = {};
  files.forEach((f) => { const n = (codeOf(f).match(/\bcacheGet\(/g) || []).length; if (n) seen[f] = n; });
  const want = {};
  Object.keys(SWR_TABLE).forEach((f) => { want[f] = SWR_TABLE[f].cacheGet; });
  assert.deepEqual(seen, want);
});

test('絆線：清單上每個 SWR 區塊都接了 settleRefresh／markRefreshFail', () => {
  Object.entries(SWR_TABLE).forEach(([f, row]) => {
    if (row.excluded) return;
    if (row.fns) {
      row.fns.forEach((fn) => {
        const src = S.stripComments(grab(f, fn));
        assert.match(src, /\b(settleRefresh|markRefreshFail)\(/, `${f} ${fn}：網路段失敗時沒有接提示`);
      });
    } else {
      assert.match(codeOf(f), /\b(settleRefresh|markRefreshFail)\(/, `${f}：沒有任何一處接提示`);
    }
  });
});

test('⬛ 對照組：絆線的量法數得到已知的那一格（board.html loadHr 的 cacheGet）', () => {
  assert.equal((S.stripComments(grab('board.html', 'loadHr')).match(/\bcacheGet\(/g) || []).length, 1);
  // 同一條判準對一支確定沒接的函式要回「沒有」，否則上面那條是永遠的綠燈
  assert.doesNotMatch(S.stripComments(grab('board.html', 'renderLog')), /\b(settleRefresh|markRefreshFail)\(/);
});
