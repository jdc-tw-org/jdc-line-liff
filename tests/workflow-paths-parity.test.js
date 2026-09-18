/**
 * 同一支 workflow 的 `push.paths` 與 `pull_request.paths` 必須逐字相同。
 *
 * 為何存在（2026-09-18，#75）：GitHub Actions **不吃 YAML anchor**，所以同一支
 * workflow 的兩份路徑過濾清單只能抄兩份。只改一份的下場是「PR 會跑但合併不會跑」
 * 或反過來——而那一格**不會變紅，它只是從來沒有出現過**，而「沒跑」與「跑了而且過了」
 * 在 PR 的檢查清單上長得一模一樣。在這支測試之前，唯一擋著它的是寫在 yml 裡
 * **給人看的註解**；而「改 paths 時順手只改一份」正是徒手就會做的事 ⇒ 散文擋不住。
 *
 * 🔴 **不寫死是哪幾支 workflow**：掃 `.github/workflows/` 底下所有 `*.yml`。
 *    寫死等於「下一支新 workflow 不在保護範圍」，而且看不出來。
 *
 * ── 這支驗得到什麼、驗不到什麼 ───────────────────────────────────
 *   驗得到：同一支 workflow 內，`push` 與 `pull_request` 兩個觸發器的
 *           `paths:`／`paths-ignore:` 兩份清單是不是同一份。錨點就是檔案自己，
 *           **沒有第二份要同步的硬編清單**。
 *   ❌ 驗不到：清單本身對不對（該不該列 `assets/**.css`）。那是人的判斷，
 *           這支只保證「你對其中一份做的決定，另一份也生效」。
 *   ❌ 驗不到：GitHub 實際會不會觸發。真相在 Actions 頁，不在單元測試射程內。
 *
 * ── 正規化到什麼程度（每一格都是取捨，代價寫在旁邊）─────────────────
 *   ① 換行與縮排：**吃掉**。`paths: ['a', 'b',\n        'c']` 與 block 形式
 *      （`paths:` 換行後 `- 'a'`）視為同一份。
 *      代價：把 flow 改寫成 block 這種純排版的改動不會被擋——這是刻意的，
 *            YAML 對這兩種寫法的語意完全相同，擋它只會製造假陽性。
 *   ② 引號種類：**吃掉**（`'a'`、`"a"`、裸 `a` 三者相同）。
 *      代價：同上，純風格差異不報。glob 裡不會有需要靠引號種類區分的跳脫。
 *   ③ 順序：**算數**（逐項比對，第 i 格對第 i 格）。
 *      理由：GitHub 的 paths 過濾支援 `!` 排除樣式，而**有 `!` 時順序是語意的**
 *            （後面的樣式覆蓋前面的）⇒ 順序不同有可能是真的行為不同。
 *            而且 yml 裡那句註解寫的就是「逐字相同」。
 *      代價：**純粹把兩份的順序排得不一樣會被判紅**，即使目前沒有 `!` 樣式、
 *            行為其實相同。這是刻意選的假陽性方向——它很吵、很好修（排回去），
 *            而反方向（漏掉真的行為差異）是靜默的。
 *      ⚠️ 要改成「順序不算數」＝把下面的 diffOne 換成集合比對，
 *         代價是 `!` 樣式的順序錯會靜默放過。
 *   ④ 整行註解（行首 `#`）：**吃掉**。行尾註解（引號外的 `#`）也吃掉。
 *
 * ── 「只有一邊有」判成什麼 ─────────────────────────────────────
 *   🔴 **這一格是還開著、要擁有者拍板的**（#75 上寫明「提議＋代價，不要自己選」）。
 *   目前實作＝**兩個觸發器都在、但只有一邊有 `paths:` ⇒ 判違規**（§3）。
 *     理由：那正是「只改一份」的極端形態——把一整份刪掉。判成豁免的話，
 *           刪掉一整份就繞過這支測試，而繞過去是靜默的。
 *     代價：如果有人**刻意**要「PR 跑全部、push 只跑指定路徑」，這支會逼他改，
 *           而那個改動是不必要的。真的要這樣做時，正確處置是**刪掉 §3 這個 test**
 *           並在 yml 裡寫明為什麼——不是加例外清單（例外清單＝第二份要同步的東西）。
 *   ⬛ **只有一個觸發器存在**（例如排程用的 `update-roster.yml` 連 `pull_request`
 *      都沒有）⇒ **豁免**，但 §4 會把它印出來放到眼前。
 *      代價：把 `pull_request:` 整個刪掉仍然繞得過這支測試。那是另一種形狀
 *           （「這支 workflow 該不該有 PR 觸發」），不在本票範圍，只回報。
 *
 * ⚠️ 這個 repo 的正式頁面零 npm 相依 ⇒ **不裝 YAML 解析套件**，沿用
 *    `workflow-env-wiring.test.js` 的做法：對原始文字下正規表示式。
 *    代價：解析器是自己寫的 ⇒ §5 用合成樣本釘住它（含一組已知會命中的對照組），
 *          沒有 §5 的話，§2 全綠有可能只是因為我根本沒抓到任何清單。
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const WF = path.join(__dirname, '..', '.github', 'workflows');
const FILTER_KEYS = ['paths', 'paths-ignore'];

// ─────────── 量測工具 ───────────

const indentOf = (line) => (line.match(/^ */) || [''])[0].length;

/** 去掉整行註解。⚠️ 註解裡寫 `paths: [...]` 當例子會被算成真的清單——yml 檔頭常這樣寫。 */
const stripFullLineComments = (src) =>
  src.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');

/** 引號外的 `#` 之後全部丟掉（行尾註解）。 */
function stripInlineComment(s) {
  let q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; continue; }
    if (c === '#') return s.slice(0, i);
  }
  return s;
}

function unquote(s) {
  s = s.trim();
  if (s.length >= 2 && s[0] === "'" && s[s.length - 1] === "'") return s.slice(1, -1).replace(/''/g, "'");
  if (s.length >= 2 && s[0] === '"' && s[s.length - 1] === '"') return s.slice(1, -1);
  return s;
}

/** 頂層鍵（第 0 欄）的整塊。找不到回 null。 */
function topLevelBlock(src, key) {
  const lines = src.split('\n');
  const i = lines.findIndex((l) => new RegExp('^' + key + ':').test(l));
  if (i < 0) return null;
  const out = [lines[i]];
  for (let j = i + 1; j < lines.length; j++) {
    if (/^\S/.test(lines[j])) break;
    out.push(lines[j]);
  }
  return out.join('\n');
}

/** 某個縮排鍵底下的整塊（含鍵那一行）。找不到回 null。 */
function subBlock(src, key) {
  if (src === null) return null;
  const lines = src.split('\n');
  const i = lines.findIndex((l) => new RegExp('^\\s+' + key + ':').test(l));
  if (i < 0) return null;
  const ind = indentOf(lines[i]);
  const out = [lines[i]];
  for (let j = i + 1; j < lines.length; j++) {
    if (lines[j].trim() === '') { out.push(lines[j]); continue; }
    if (indentOf(lines[j]) <= ind) break;
    out.push(lines[j]);
  }
  return out.join('\n');
}

/** flow 形式 `[a, b, c]`：引號感知地切出項目。 */
function splitFlow(text) {
  const items = [];
  let cur = '', q = null, depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      cur += c;
      if (c === q) {
        if (q === "'" && text[i + 1] === "'") { cur += text[++i]; continue; }
        q = null;
      }
      continue;
    }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    if (c === '#') break;                                   // 引號外的行尾註解
    if (c === '[') { depth++; if (depth === 1) cur = ''; else cur += c; continue; }
    if (c === ']') { depth--; if (depth === 0) break; cur += c; continue; }
    if (c === ',' && depth === 1) { items.push(cur); cur = ''; continue; }
    cur += c;
  }
  items.push(cur);
  return items.map((s) => s.trim()).filter((s) => s !== '').map(unquote);
}

/**
 * 取某個觸發器區塊裡 `key:` 的清單。**沒有這個鍵回 null**（要跟「有但是空的」分開，
 * 三態比兩態誠實）。flow 與 block 兩種寫法都吃，回傳正規化後的字串陣列。
 */
function filterList(block, key) {
  if (block === null) return null;
  const lines = block.split('\n');
  const i = lines.findIndex((l) => new RegExp('^\\s*' + key + ':\\s*(\\[|$|#)').test(l));
  if (i < 0) return null;
  const ind = indentOf(lines[i]);
  let rest = lines[i].slice(lines[i].indexOf(key + ':') + key.length + 1);

  if (stripInlineComment(rest).trim().startsWith('[')) {
    // flow 形式，可能跨行：一直吃到中括號收斂
    let buf = rest, j = i;
    const balanced = (t) => {
      let d = 0, q = null;
      for (let k = 0; k < t.length; k++) {
        const c = t[k];
        if (q) { if (c === q) q = null; continue; }
        if (c === '"' || c === "'") { q = c; continue; }
        if (c === '#') break;
        if (c === '[') d++;
        if (c === ']') { d--; if (d === 0) return true; }
      }
      return false;
    };
    while (!balanced(buf) && j + 1 < lines.length) { j++; buf += ' ' + lines[j]; }
    return splitFlow(buf);
  }
  // block 形式：接下來縮排更深的 `- xxx`
  const items = [];
  for (let j = i + 1; j < lines.length; j++) {
    if (lines[j].trim() === '') continue;
    if (indentOf(lines[j]) <= ind) break;
    const m = /^\s*-\s+(.*)$/.exec(lines[j]);
    if (!m) break;
    items.push(unquote(stripInlineComment(m[1]).trim()));
  }
  return items;
}

/** 一支 workflow 的形狀。 */
function analyze(src) {
  const on = topLevelBlock(stripFullLineComments(src), 'on');
  const push = subBlock(on, 'push');
  const pr = subBlock(on, 'pull_request');
  const lists = {};
  for (const k of FILTER_KEYS) lists[k] = { push: filterList(push, k), pull_request: filterList(pr, k) };
  return { foundOn: on !== null, hasPush: push !== null, hasPr: pr !== null, lists };
}

/** 兩份清單的差異，逐格描述。相同回 []。 */
function diffOne(name, key, a, b) {
  const out = [];
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) {
      out.push(name + ' 的 ' + key + '：第 ' + (i + 1) + ' 格不同'
        + ' → push=' + (i < a.length ? JSON.stringify(a[i]) : '（沒有這一格）')
        + '、pull_request=' + (i < b.length ? JSON.stringify(b[i]) : '（沒有這一格）'));
    }
  }
  return out;
}

/** 這支 workflow 的違規（兩份不同／只有一邊有）。 */
function violations(name, a) {
  const out = [];
  if (!a.hasPush || !a.hasPr) return out;          // 只有一個觸發器 ⇒ 豁免（見檔頭）
  for (const k of FILTER_KEYS) {
    const { push, pull_request: pr } = a.lists[k];
    if (push === null && pr === null) continue;
    if (push === null || pr === null) {
      out.push(name + '：只有 ' + (push ? 'push' : 'pull_request') + ' 有 ' + k
        + '，另一邊沒有 ⇒ 兩個事件走的過濾不同（見本檔檔頭「只有一邊有」）');
      continue;
    }
    out.push(...diffOne(name, k, push, pr));
  }
  return out;
}

function workflowFiles() {
  return fs.readdirSync(WF).filter((x) => /\.ya?ml$/.test(x)).sort();
}

// ─────────── §1 量測工具本身要有東西量到（防「零命中＝全都相同」的誤讀）───────────

test('⬛ §1 零點的前提：真的掃到 workflow、而且真的抓到成對的 paths 清單', () => {
  const files = workflowFiles();
  assert.ok(files.length > 0, '一個 workflow 都沒掃到 ⇒ 路徑錯了，不是 repo 沒有 workflow');
  let paired = 0;
  for (const f of files) {
    const a = analyze(fs.readFileSync(path.join(WF, f), 'utf8'));
    assert.ok(a.foundOn, f + ' 找不到頂層 `on:` ⇒ 解析器看不懂這支，不是這支沒有觸發器');
    if (a.hasPush && a.hasPr && a.lists.paths.push && a.lists.paths.pull_request) paired++;
  }
  assert.ok(paired > 0,
    '沒有任何一支抓到「push 與 pull_request 都有 paths」⇒ 抓法壞了。'
    + '沒有這一條，§2 的全綠會被讀成「兩份都相同」，其實是「什麼都沒量到」');
  console.log('\n  掃到 ' + files.length + ' 支 workflow，其中 ' + paired + ' 支有成對的 paths 清單\n');
});

// ─────────── §2 核心斷言 ───────────

test('🔴 §2 每一支 workflow：push.paths 與 pull_request.paths 必須逐字相同', () => {
  const bad = [];
  for (const f of workflowFiles()) {
    bad.push(...violations(f, analyze(fs.readFileSync(path.join(WF, f), 'utf8'))));
  }
  assert.deepStrictEqual(bad, [],
    'GitHub Actions 不吃 YAML anchor，這兩份只能抄兩份；不同步的下場是'
    + '「PR 會跑但合併不會跑」或反過來，而且零錯誤訊息：\n  ' + bad.join('\n  '));
});

// ─────────── §3 只有一邊有 paths（⚠️ 判成違規——這一格還開著要拍板，見檔頭）───────────

test('🔴 §3 兩個觸發器都在時，不可以只有一邊有 paths（要改成豁免＝刪掉這個 test）', () => {
  const bad = [];
  for (const f of workflowFiles()) {
    const a = analyze(fs.readFileSync(path.join(WF, f), 'utf8'));
    if (!a.hasPush || !a.hasPr) continue;
    for (const k of FILTER_KEYS) {
      const { push, pull_request: pr } = a.lists[k];
      if ((push === null) !== (pr === null)) bad.push(f + ' 的 ' + k + '：只有一邊有');
    }
  }
  assert.deepStrictEqual(bad, [], '把一整份刪掉，是「只改一份」的極端形態：\n  ' + bad.join('\n  '));
});

// ─────────── §4 豁免名單放到眼前（不是檢查，永遠會過）───────────

test('§4 這些 workflow 不在比對範圍內（缺 push 或 pull_request 觸發器）', () => {
  const 豁免 = [];
  for (const f of workflowFiles()) {
    const a = analyze(fs.readFileSync(path.join(WF, f), 'utf8'));
    if (!a.hasPush || !a.hasPr) {
      豁免.push('    ' + f + '：'
        + (a.hasPush ? '有 push' : '沒有 push') + '、'
        + (a.hasPr ? '有 pull_request' : '沒有 pull_request'));
    }
  }
  console.log('\n  豁免（缺其中一個觸發器 ⇒ 沒有兩份可以比）：\n'
    + (豁免.join('\n') || '    （沒有）')
    + '\n  ⚠️ 把 `pull_request:` 整個刪掉仍然繞得過 §2／§3——那是另一種形狀，本測試不管。\n');
  assert.ok(true);
});

// ─────────── §5 用合成樣本釘住解析器與每一個正規化決定 ───────────

const 合成 = (pushPaths, prPaths) =>
  'name: x\n\non:\n  push:\n    branches: [main]\n' + pushPaths
  + '  pull_request:\n' + prPaths + '  workflow_dispatch: {}\n\njobs:\n  a:\n    runs-on: x\n';

test('⬛ §5-1 對照組：兩份差一格 ⇒ 必須命中，而且紅字指名是哪一格', () => {
  const a = analyze(合成("    paths: ['a.html', 'b.js']\n", "    paths: ['a.html', 'c.js']\n"));
  const v = violations('假的.yml', a);
  assert.equal(v.length, 1, '差一格卻沒命中 ⇒ 這把尺什麼都擋不住');
  assert.match(v[0], /假的\.yml/);
  assert.match(v[0], /第 2 格/);
  assert.match(v[0], /"b\.js"/);
  assert.match(v[0], /"c\.js"/);
});

test('⬛ §5-2 零點：逐字相同 ⇒ 零命中', () => {
  const a = analyze(合成("    paths: ['a.html', 'b.js']\n", "    paths: ['a.html', 'b.js']\n"));
  assert.deepStrictEqual(violations('假的.yml', a), []);
});

test('⬛ §5-3 正規化①②：跨行、縮排、block 形式、引號種類都吃掉', () => {
  const flow跨行 = "    paths: ['a.html',\n            \"b.js\"]\n";
  const block形式 = "    paths:\n      - a.html\n      - 'b.js'\n";
  const a = analyze(合成(flow跨行, block形式));
  assert.deepStrictEqual(a.lists.paths.push, ['a.html', 'b.js']);
  assert.deepStrictEqual(a.lists.paths.pull_request, ['a.html', 'b.js']);
  assert.deepStrictEqual(violations('假的.yml', a), [], '只差排版與引號 ⇒ 刻意不報');
});

test('⬛ §5-4 正規化③：順序不同**算**不同（這是選的，代價見檔頭）', () => {
  const a = analyze(合成("    paths: ['a.html', 'b.js']\n", "    paths: ['b.js', 'a.html']\n"));
  assert.equal(violations('假的.yml', a).length, 2, '順序不同要被判成不同，否則 `!` 排除樣式的順序錯會靜默放過');
});

test('⬛ §5-5 只有一邊有 paths ⇒ 命中（現行判準：違規）', () => {
  const a = analyze(合成("    paths: ['a.html']\n", ''));
  const v = violations('假的.yml', a);
  assert.equal(v.length, 1);
  assert.match(v[0], /只有 push 有 paths/);
});

test('⬛ §5-6 只有一個觸發器（排程型）⇒ 豁免，不是違規', () => {
  const 排程 = 'name: x\n\non:\n  schedule:\n    - cron: \'0 22 * * *\'\n  workflow_dispatch: {}\n\njobs:\n  a:\n    runs-on: x\n';
  const a = analyze(排程);
  assert.equal(a.hasPush, false);
  assert.equal(a.hasPr, false);
  assert.deepStrictEqual(violations('排程.yml', a), []);
});

test('⬛ §5-7 註解不算數：整行註解與行尾註解都不能混進清單', () => {
  const 帶註解 = "    # 這行講 paths: ['騙人的'] 只是舉例\n    paths: ['a.html']   # 行尾也不算\n";
  const a = analyze(合成(帶註解, "    paths: ['a.html']\n"));
  assert.deepStrictEqual(a.lists.paths.push, ['a.html'], '註解被吃進清單 ⇒ 對所有寫了說明的 yml 誤報');
  assert.deepStrictEqual(violations('假的.yml', a), []);
});

test('⬛ §5-8 paths-ignore 走同一把尺（目前沒人用，先釘住形狀）', () => {
  const a = analyze(合成("    paths-ignore: ['x.md']\n", "    paths-ignore: ['y.md']\n"));
  const v = violations('假的.yml', a);
  assert.equal(v.length, 1);
  assert.match(v[0], /paths-ignore/);
});
