/**
 * 「這一頁怎麼認人」的**唯一**一支抽取器，以及它的基準快照產生器。
 *
 * ══ 為何有這一支（2026-09-16，gas #98）═════════════════════════════════
 *
 * 上線前手寫的那份認證盤點，**同一份清單錯了三次**：
 *   · 說 `staff.html` 不讀 token —— 它讀（`new URLSearchParams(...).get('t')`）
 *   · 說三台鑄造機已停產   —— `admin.html` 線上實打命中 4
 *   · 說 `board.html` 命中 0 —— 那個 0 是**在另一個 repo 裡 grep 的**
 *
 * 🔴 **共同成因不是粗心，是「用手選的關鍵詞去量」。**
 *    `assets/url-token.js` 的檔頭 2026-09-12 就列著「`?t=` 有四種寫法、沒有共用函式」，
 *    而四天後的盤點仍然只搜了其中兩種。⇒ 手選關鍵詞的定義域，**沒有人看得見它有多窄**。
 *
 * ⚠️ **而且那份清單自己也會過期。** 本檔寫成的當天實測：票上記載的
 *    「`board.html` 是寫法② `function getToken(){…/[?&]t=…/}`」**已經不成立**
 *    ——E1a 把它換成了 `return urlToken();`，而**沒有任何東西紅**。
 *    ⇒ 所以本檔不找那四種寫法的**字面**，找的是它們背後的**機制**（見下）。
 *
 * ══ 四種 token 層形狀，以及為什麼是這四種 ═══════════════════════════════
 *
 * JS 要從網址取一個**具名**參數，只有三條路，每條都逼參數名以某種形式出現在原始碼裡：
 *
 *   S1  以名字為鍵的解析 API          `q('t')`／`new URLSearchParams(s).get('t')`
 *   S2  對 search 字串做**字串**外科   字串字面值含 `t=`（`split('?t=')`）
 *   S3  對 search 字串做**正則**比對   正則字面值含 `t=`
 *   S4  名字被藏進共用函式             識別字 `urlToken`／`urlParam`
 *
 * ⚠️ **`mt` 是另一個參數，而 `[?&]mt=` 的文字裡含有 `t=`。** 所以 `t=` 前面那一格
 *    必須不是識別字字元。這一格是實測逼出來的（`admin.html`／`board.html` 兩個參數都有）。
 *
 * 🔴 **已知的盲區（會少報，而少報是靜默的）——釘在 `tests/auth-inventory.test.js`，不只寫在這裡：**
 *   ① **位置取值**：`location.search.slice(1).split('=')[1]`
 *      ——參數名**一個字都沒出現**，本檔四種形狀窮盡的是「名字以某種形式出現」，它出了定義域。
 *   ② **名字先進變數**：`var k = 't'; …get(k)`
 *      ——S1 要求 `'t'` 緊接在 `(` 之後。放寬成「任何 `'t'` 字串」會把
 *        `hr-stats.html` 的 `propRows(…, rt, 't', RAMP4, …)` 收進來（實測 2 筆假陽性）
 *        ⇒ 這是**刻意選的精確度／召回率取捨**，不是沒想到。
 *   ③ **action 名不在第一引數**：既有的 `action-scan.js` 的 `literalCalls()` 只認
 *      `ident('str'`，而 `me.html`／`line-messages.html` 走 `gasCall(GAS_URL, 'listMyPages', …)`
 *      ⇒ **整支 action 抽不到**。本檔的第②格對這兩頁因此會少報。
 *
 * ⚠️ **不自己寫 tokenizer。** 註解要被丟掉、字串與正則要各自認得，這件事
 *    `tests/helpers/action-scan.js` 的 `tokenize()` 已經做了（2026-09-12）。
 *    再寫一支＝兩份會分歧，而分歧是靜默的。
 *
 * ══ 🔴 兩把**互相獨立**的尺，以及為什麼不能只用一把 ═══════════════════════
 *
 * 第一版拿「這一頁有沒有讀 `?t=`」當尺，`line-messages.html` 被判成「活的」——
 * **而它是墓碑**。它確實有一行活碼 `var TOKEN = qs('t')`，只是那顆 token 哪裡都不去
 * （`EXEC_URL`／`callApi` 都刪了，只用來觸發停用畫面）。
 * ⇒ **正確的尺是「值有沒有流進一次網路呼叫」，不是「有沒有被讀」。**
 *
 *   尺 A  值有沒有流進傳輸  回溯持有者變數（含三元、`||`、`return` 出具名函式），
 *                          再看那些名字有沒有落在某個傳輸函式的引數區。
 *   尺 B  傳輸的引數區裡有沒有一格參數名叫 `token`／`t`  不看值從哪來。
 *
 * ⚠️ **兩把的失效方向不同，這是刻意的**：尺 A 的持有者鏈會過度擴散（假陽性），
 *    尺 B 不看來源（送的是別顆 token 也會亮）。**所以「兩把不一致」本身就是訊號**，
 *    而不是拿去取聯集。不一致時本檔回 `不確定`，讓它紅，不讓它靜靜挑一邊。
 *    （實作當天就靠這個抓到一次：`verify.html` 尺 B 中、尺 A 沒中 ⇒ 開檔查，
 *      是尺 A 漏了「讀取式在具名函式內、值經 `return` 出來」。）
 *
 * ══ 這一份**不**回答什麼（寫清楚，否則下一個人會高估它）═══════════════════
 *
 * ❌ **不回答「這一頁有幾道門」。** 第一道（`ACTION_ROLES` 路由層）讀得到；
 *    **第二道可以手寫在 handler 裡、不進任何清冊** ——2026-09-16 一手證實：
 *    `getActivityStats` 不在後端的 messaging 第二道清冊上，而它的 handler 第一行
 *    就是 `boardOrViewAuthFromIdentity_`。⇒ **「不在清冊上」≠「沒有第二道」。**
 *    所以本檔的第②格**只宣稱第一道**，而基準檔是**快照比對、不是寫死的期望值**。
 * ❌ 不回答「線上部署的是不是這一份」。那要靠逐位元組比對，不是靜態掃描。
 *
 * ══ ⏳ 解除條件（寫成條件，不是現在狀態）═══════════════════════════════
 *
 * ⏳ **升級**：等「這一頁有幾道門」那一欄從推論變成事實
 *    （＝有一份逐 handler 盤點，能對每一支 action 回答「它的 handler 裡有沒有自己的身分判斷」），
 *    就把第②格從**快照比對**改成**寫死的斷言**。
 *    在那之前寫死＝把一個已知會錯的答案釘進程式（期望值比註解更像事實，
 *    執行者跑出正確結果反而會回頭改壞）。
 * ⏳ **退場**：若連續兩個季度，這條測試的紅燈**全部**是「改頁面時順手更新基準」
 *    而沒有任何一次逼出真問題，就撤掉它。
 *    判斷要讀的資料＝`git log --oneline -- tests/auth-inventory.baseline.md`，**現在就會自動累積**。
 *
 * ══ 用法 ═══════════════════════════════════════════════════════════════
 *
 *   node tests/helpers/auth-scan.js            # 寫入 tests/auth-inventory.baseline.md
 *   node tests/helpers/auth-scan.js --check    # 不寫檔，比對現況與基準；不同回退出碼 1
 *   node tests/helpers/auth-scan.js --out <路徑>
 *
 * ⚠️ 刻意**不寫產生時間**——帶時間戳的基準檔每次重跑都會 diff，
 *    而「全部都在動」與「有一格變了」在 diff 上會長得一樣。（借自 gas 的 `ci/roles-matrix/snapshot.js`。）
 */
const fs = require('node:fs');
const path = require('node:path');
const AS = require('./action-scan.js');

const ROOT = path.join(__dirname, '..', '..');
const DEFAULT_OUT = path.join(ROOT, 'tests', 'auth-inventory.baseline.md');
/** 角色表的副本（後端產、本 repo 收）。**不另抄一份角色表**——抄了就是同一個判斷散在兩處。 */
const FIXTURE = path.join(__dirname, '..', 'fixtures', 'action-roles.json');

const IDCH = /[A-Za-z0-9_$]/;
/** 文字裡有沒有「參數名剛好是 `t`」的 `t=`（排掉 `mt=`／`at=` 這種尾巴撞上的）。 */
function hasParamT(text) {
  let k = -1;
  while ((k = text.indexOf('t=', k + 1)) >= 0) {
    if (k === 0 || !IDCH.test(text[k - 1])) return true;
  }
  return false;
}
const HELPER_IDS = new Set(['urlToken', 'urlParam']);
/** 傳輸的種子。本地包裝（`jsonp` 包了 `fetch`）由 `netCallees` 遞移補上。 */
const NET_SEED = ['fetch', 'XMLHttpRequest', 'sendBeacon', 'EventSource', 'WebSocket', 'gasCall', 'importScripts'];

/** 每個 token 落在「哪幾層呼叫的引數區」裡。 */
function callChains(tk) {
  const chain = [];
  const out = new Array(tk.length);
  for (let k = 0; k < tk.length; k++) {
    out[k] = chain.slice();
    if (tk[k].t === 'punct' && tk[k].v === '(') {
      const p = tk[k - 1];
      chain.push(p && p.t === 'id' ? p.v : null);
    } else if (tk[k].t === 'punct' && tk[k].v === ')') chain.pop();
  }
  return out;
}

/** 具名 function 宣告的本體 token 區間。⚠️ 匿名函式沒有名字可掛，略過（＝少報）。 */
function fnRanges(tk) {
  const out = [];
  for (let k = 0; k + 1 < tk.length; k++) {
    if (!(tk[k].t === 'id' && tk[k].v === 'function')) continue;
    const nm = tk[k + 1];
    if (!nm || nm.t !== 'id') continue;
    let j = k + 2; let depth = 0; let start = -1;
    for (; j < tk.length; j++) {
      if (tk[j].t !== 'punct') continue;
      if (tk[j].v === '{') { if (start < 0) start = j; depth++; } else if (tk[j].v === '}') { depth--; if (depth === 0) break; }
    }
    if (start >= 0 && j < tk.length) out.push({ name: nm.v, from: start, to: j });
  }
  return out;
}

/** 傳輸函式集合＝種子＋本地包裝的遞移閉包。 */
function netCallees(tk) {
  const set = new Set(NET_SEED);
  const ranges = fnRanges(tk);
  for (let pass = 0; pass < 6; pass++) {
    let grew = false;
    ranges.forEach((r) => {
      if (set.has(r.name)) return;
      for (let k = r.from; k <= r.to; k++) {
        if (tk[k].t === 'id' && set.has(tk[k].v) && tk[k + 1] && tk[k + 1].v === '(') { set.add(r.name); grew = true; break; }
      }
    });
    if (!grew) break;
  }
  return set;
}

/** 四種形狀的命中（token 層＝註解已經被 `tokenize` 丟掉）。 */
function shapes(tk) {
  const out = [];
  for (let k = 0; k < tk.length; k++) {
    const x = tk[k];
    if (x.t === 'str' && x.v === 't' && tk[k - 1] && tk[k - 1].v === '(' && tk[k - 2] && tk[k - 2].t === 'id') {
      out.push({ s: 'S1', k, txt: tk[k - 2].v + "('t')" });
    } else if (x.t === 'str' && hasParamT(x.v)) out.push({ s: 'S2', k, txt: JSON.stringify(x.v) });
    else if (x.t === 'regex' && hasParamT(x.v)) out.push({ s: 'S3', k, txt: x.v });
    else if (x.t === 'id' && HELPER_IDS.has(x.v)) out.push({ s: 'S4', k, txt: x.v + '()' });
  }
  return out;
}

/** 讀出來的值存進哪些名字。S2 不建持有者——它同時也是「鑄造連結」的形狀，分不出讀或寫。 */
function holders(tk, hits) {
  const names = new Set();
  const ranges = fnRanges(tk);
  const reads = hits.filter((h) => h.s !== 'S2');
  // ① 讀取式所在的**最內層具名函式**（值經 `return` 出來，回溯賦值鏈看不到它）
  reads.forEach((h) => {
    let best = null;
    ranges.forEach((r) => {
      if (h.k >= r.from && h.k <= r.to && (!best || (r.to - r.from) < (best.to - best.from))) best = r;
    });
    if (best) names.add(best.name);
  });
  // ② 直接賦值：`var TOKEN = <讀取式>`
  reads.forEach((h) => {
    for (let b = h.k - 1; b >= Math.max(0, h.k - 10); b--) {
      if (tk[b].t === 'punct' && tk[b].v === '=' && tk[b - 1] && tk[b - 1].t === 'id') { names.add(tk[b - 1].v); return; }
      if (tk[b].t === 'punct' && (tk[b].v === ';' || tk[b].v === '{' || tk[b].v === '}')) return;
    }
  });
  // ③ 賦值傳遞的不動點：`t = m ? m[1] : ''`／`x = t || ''`
  for (let pass = 0; pass < 8; pass++) {
    let grew = false;
    for (let k = 0; k + 1 < tk.length; k++) {
      if (tk[k].t !== 'id' || names.has(tk[k].v)) continue;
      if (!(tk[k + 1].t === 'punct' && tk[k + 1].v === '=')) continue;
      if (tk[k + 2] && tk[k + 2].v === '=') continue;                       // `==`
      for (let j = k + 2; j < tk.length; j++) {
        const y = tk[j];
        if (y.t === 'punct' && (y.v === ';' || y.v === ',' || y.v === '}')) break;
        if (y.t === 'id' && names.has(y.v)) { names.add(tk[k].v); grew = true; break; }
      }
    }
    if (!grew) break;
  }
  return names;
}

/** 尺 A：持有者有沒有落進傳輸函式的引數區。 */
function reachesNet(tk, names, net) {
  const chains = callChains(tk);
  const out = [];
  for (let k = 0; k < tk.length; k++) {
    if (tk[k].t !== 'id' || !names.has(tk[k].v)) continue;
    if (chains[k].some((c) => c && net.has(c))) out.push(tk[k].v);
  }
  return [...new Set(out)];
}

/** 尺 B：傳輸的引數區裡有沒有一格參數名叫 `token`／`t`。 */
function sendsTokenParam(tk, net) {
  const chains = callChains(tk);
  const out = [];
  for (let k = 0; k + 1 < tk.length; k++) {
    const x = tk[k];
    if (!((x.t === 'id' || x.t === 'str') && (x.v === 'token' || x.v === 't'))) continue;
    if (!(tk[k + 1].t === 'punct' && tk[k + 1].v === ':')) continue;
    if (chains[k].some((c) => c && net.has(c))) out.push(x.v);
  }
  return [...new Set(out)];
}

/** 原文層（含註解）有沒有出現過這四種形狀——用來分辨「只活在註解裡」。 */
function rawMentions(code) {
  let n = (code.match(/\(\s*(['"])t\1\s*\)/g) || []).length
        + (code.match(/urlToken|urlParam/g) || []).length;
  let k = -1;
  while ((k = code.indexOf('t=', k + 1)) >= 0) if (k === 0 || !IDCH.test(code[k - 1])) n++;
  return n;
}

/**
 * 第①格：這一頁的 `?t=` 是活的還是墓碑。
 *
 * ⚠️ **只看 inline。** 共用 asset 裡的呼叫點屬於別的頁，靜態上分不出誰真的會執行到
 *    （`action-scan.js` 檔頭記著那次實測自爆：`board-cache.js` 的呼叫點讓 `attend.html`
 *     被算成需要別頁的 action ⇒ 檢查變綠）。
 */
function tokenVerdict(file) {
  const code = AS.inlineScript(file);
  const tk = AS.tokenize(code);
  const hits = shapes(tk);
  const net = netCallees(tk);
  const A = reachesNet(tk, holders(tk, hits), net);
  const B = sendsTokenParam(tk, net);
  const reads = hits.filter((h) => h.s !== 'S2').length;
  const anyShape = hits.length;
  const sends = A.length > 0 || B.length > 0;

  let verdict;
  if (anyShape && sends) verdict = '活的';
  else if (reads) verdict = '墓碑（讀了但不送）';
  else if (sends) verdict = '🔴 不確定（送了 token，卻找不到讀取點）';
  else if (rawMentions(code)) verdict = '墓碑（只在註解）';
  else verdict = '沒有這條路';
  return { verdict, shapes: [...new Set(hits.map((h) => h.s))].sort(), rulerA: A.length > 0, rulerB: B.length > 0 };
}

/**
 * 第②格：進得去要什麼角色（**只有第一道**）。
 *
 * ⚠️ 刻意**不記 action 名字**，只記**角色門檻的集合**。
 *    理由：這 13 頁的 action 清單三個月動過上百次，而多一支 `[admin,activity]` 的 action
 *    **不改變任何人進不進得去**。把 action 名記進基準＝每隔幾天紅一次，
 *    而吵人的基準會被學會無視——那時它等於不存在，但看起來還在。
 */
function gateOf(file, fx) {
  const code = AS.inlineScript(file);
  const known = (a) => Object.prototype.hasOwnProperty.call(fx.actions, a);
  const acts = new Set();
  AS.literalCalls(code).forEach((c) => { if (known(c.arg)) acts.add(c.arg); });
  AS.batchItems(code).forEach((a) => { if (known(a)) acts.add(a); });

  const dp = fx.dispatchPages.find((p) => p.page === file);
  const entry = dp ? dp.gateAction + ' [' + fx.actions[dp.gateAction].roles.join(',') + ']' : '未宣告';
  const thresholds = [...new Set([...acts].map((a) => fx.actions[a].roles.join(',')))].sort();
  return { entry, thresholds: thresholds.length ? thresholds : ['（抽不到）'] };
}

function sha12(p) {
  return require('node:crypto').createHash('sha256').update(fs.readFileSync(p)).digest('hex').slice(0, 12);
}

function build() {
  const fx = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  const pages = AS.pages();
  const L = [];
  L.push('# 認證盤點基準快照（兩格）');
  L.push('');
  L.push('> 🔴 **這是快照，不是期望值表。** 它只說「跟上次比，變了沒有」，**不宣稱哪一格是對的**。');
  L.push('> 尤其第②格只是**第一道**門檻——第二道可以手寫在 handler 裡而不進任何清冊，');
  L.push('> 所以「這一頁有幾道門」今天仍然是推論。解除條件寫在 `tests/helpers/auth-scan.js` 的檔頭。');
  L.push('');
  L.push('## 這份是怎麼來的');
  L.push('');
  L.push('| | |');
  L.push('|---|---|');
  L.push('| 產生器 | `tests/helpers/auth-scan.js` |');
  L.push('| 詞法掃描 | `tests/helpers/action-scan.js` 的 `tokenize()`（**共用同一支**，不另寫） |');
  L.push('| 角色表副本 `tests/fixtures/action-roles.json` sha256 | `' + sha12(FIXTURE) + '` |');
  L.push('| 頁面母體 | repo 根目錄的 `*.html` **現掃**（不是手寫清單） |');
  L.push('| 頁數 | ' + pages.length + ' |');
  L.push('');
  L.push('⚠️ 刻意不寫產生時間——帶時間戳的基準檔每次重跑都會 diff，');
  L.push('而「全部都在動」與「有一格變了」在 diff 上會長得一樣。');
  L.push('');
  L.push('## 逐頁');
  L.push('');
  L.push('`入口`＝後端 `dispatchPages` 宣告的那一支（只有分流頁有）。');
  L.push('`角色門檻`＝這一頁 inline 打得到的 action 各自註冊的角色集合，**去重後排序**。');
  L.push('');
  const w = (s, n) => s + ' '.repeat(Math.max(0, n - [...s].reduce((a, c) => a + (c.charCodeAt(0) > 0x2000 ? 2 : 1), 0)));
  L.push('| ' + w('頁', 20) + ' | ' + w('① `?t=`', 24) + ' | ' + w('② 入口（第一道）', 44) + ' | ② 角色門檻 |');
  L.push('|' + '-'.repeat(22) + '|' + '-'.repeat(26) + '|' + '-'.repeat(46) + '|---|');
  pages.forEach((p) => {
    const t = tokenVerdict(p);
    const g = gateOf(p, fx);
    L.push('| ' + w('`' + p + '`', 20) + ' | ' + w(t.verdict, 24) + ' | ' + w('`' + g.entry + '`', 44) + ' | ' + g.thresholds.map((s) => '`' + s + '`').join('<br>') + ' |');
  });
  L.push('');
  return L.join('\n');
}

function main(argv) {
  const check = argv.includes('--check');
  const oi = argv.indexOf('--out');
  const out = oi >= 0 ? argv[oi + 1] : DEFAULT_OUT;
  const text = build();

  if (!check) {
    fs.writeFileSync(out, text);
    process.stdout.write('已寫入 ' + path.relative(ROOT, out) + '（' + text.split('\n').length + ' 行）\n');
    return 0;
  }
  if (!fs.existsSync(out)) { process.stdout.write('🔴 基準檔不存在：' + path.relative(ROOT, out) + '\n'); return 1; }
  const old = fs.readFileSync(out, 'utf8');
  if (old === text) { process.stdout.write('✅ 與基準檔逐字相同（' + AS.pages().length + ' 頁）\n'); return 0; }
  const a = old.split('\n'); const b = text.split('\n');
  process.stdout.write('🔴 與基準檔不同——逐行列出差異（左＝基準檔、右＝現況）：\n');
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) {
      process.stdout.write('  第 ' + (i + 1) + ' 行\n    基準：' + (a[i] === undefined ? '（無此行）' : a[i])
        + '\n    現況：' + (b[i] === undefined ? '（無此行）' : b[i]) + '\n');
    }
  }
  return 1;
}

module.exports = {
  ROOT, DEFAULT_OUT, FIXTURE, NET_SEED,
  hasParamT, callChains, fnRanges, netCallees, shapes, holders,
  reachesNet, sendsTokenParam, rawMentions, tokenVerdict, gateOf, build,
};

if (require.main === module) process.exit(main(process.argv.slice(2)));
