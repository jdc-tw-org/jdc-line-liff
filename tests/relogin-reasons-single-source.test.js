/**
 * 「哪些代號重新登入有用」前端只准一份：`assets/liff-relogin.js` 的 `RELOGIN_REASONS`（#115）。
 *
 * 為何存在：改前實際有三份前端副本（本檔、`me.html` 的 `重登有用的`、`authz.html` 的
 * `重登有用的`），而 liff-relogin.js 檔頭寫「三份」（含後端）、me.html 自己的註解寫
 * 「只有一份」——同一個判斷散在多處，沒有任何東西要求它們相等。
 * 收斂後各頁一律呼叫 `reloginUseful()`／`reloginVerdict()`；這支掃原始碼守著不再長回來。
 *
 * 量法：凡是載入 `assets/liff-relogin.js` 的頁（**自動找，不寫死清單**），
 * 拿掉註解之後不得出現 `line_bad_token`／`line_no_token`。
 *
 * ⚠️ 明寫的例外（只有這一個）：`hr-stats.html` 的 `gateFailText(r)` 裡的文案表 `var M = {…}`
 *    （`line_bad_token: [...]`、`line_no_token: [...]` 兩列，@6be9b3f 約 L1170–1173）。
 *    理由：那是「代號 → 給人看的話」的**文案表**，每一個 `GATE_REJECT` 代號都有一句
 *    （包括重登沒用的 `line_unbound`、`role_*`），它不決定要不要重登——決定的是
 *    `reloginOnDeadCredential`。把它改成讀 `RELOGIN_REASONS` 反而會讓文案表缺鍵。
 *    例外只放行「行首是 `line_(bad|no)_token: [`」的那兩行，而且**恰好兩行**：
 *    多一行（例如有人在那一頁另寫判斷）就紅。
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const CODE = /line_(bad|no)_token/;
const HR_STATS_EXCEPTION = /^\s*line_(bad|no)_token: \[/;

/** 拿掉註解：整行註解（`*`、`//`、`/*`、`<!--` 開頭）跳過；行尾 ` // …` 截掉（`https://` 前面沒有空白，不會被誤截）。 */
function codeLines(src) {
  const out = [];
  src.split('\n').forEach((line, i) => {
    const t = line.trim();
    if (/^(\*|\/\/|\/\*|<!--)/.test(t)) return;
    out.push({ n: i + 1, text: line.replace(/\s\/\/.*$/, '') });
  });
  return out;
}

function hits(file, src) {
  return codeLines(src).filter((l) => CODE.test(l.text)).map((l) => ({ file, ...l }));
}

const PAGES = fs.readdirSync(ROOT).filter((f) => f.endsWith('.html'))
  .filter((f) => /<script src="assets\/liff-relogin\.js"><\/script>/.test(fs.readFileSync(path.join(ROOT, f), 'utf8')));

test('⬛ 零點：自動找到的頁涵蓋已知會掛它的那幾支（否則「0 命中」恆真）', () => {
  for (const p of ['authz.html', 'me.html', 'line.html', 'wall.html', 'checkin.html', 'hr-stats.html']) {
    assert.ok(PAGES.includes(p), `${p} 沒被找到 ⇒ 下面那條對它零鑑別力`);
  }
});

test('⬛ 零點：掃描器認得出改前 authz／me 那種寫法，也不會被註解騙到', () => {
  const before = [
    "var 重登有用的 = { line_no_token: 1, line_bad_token: 1 };",
    "if (r.reason === 'line_bad_token') relogin();",
  ].join('\n');
  assert.equal(hits('sample', before).length, 2);
  const commentsOnly = [
    ' * 後端回 `line_bad_token` 時……',
    '  // 收到 line_no_token ⇒ ……',
    "var u = 'https://example.tw/x'; // line_bad_token 在註解裡",
  ].join('\n');
  assert.deepEqual(hits('sample', commentsOnly), []);
});

test('🔴 載入 liff-relogin.js 的頁，程式碼裡不得另抄重登代號（一律問 reloginUseful／reloginVerdict）', () => {
  const bad = [];
  for (const p of PAGES) {
    for (const h of hits(p, fs.readFileSync(path.join(ROOT, p), 'utf8'))) {
      if (p === 'hr-stats.html' && HR_STATS_EXCEPTION.test(h.text)) continue;
      bad.push(`${h.file}:${h.n}: ${h.text.trim()}`);
    }
  }
  assert.deepEqual(bad, [], '頁面另抄了一份代號 ⇒ 與 RELOGIN_REASONS 分歧時沒有任何東西會紅');
});

test('hr-stats 的例外恰好兩行（文案表那兩列），不多不少', () => {
  const src = fs.readFileSync(path.join(ROOT, 'hr-stats.html'), 'utf8');
  const ex = hits('hr-stats.html', src).filter((h) => HR_STATS_EXCEPTION.test(h.text));
  assert.equal(ex.length, 2, '文案表變了就重看這個例外還成不成立');
});

test('authz、me 真的改讀 reloginUseful（不是刪了判斷）', () => {
  assert.match(fs.readFileSync(path.join(ROOT, 'authz.html'), 'utf8'), /return !!reason && reloginUseful\(reason\);/);
  assert.match(fs.readFileSync(path.join(ROOT, 'me.html'), 'utf8'), /if \(reason && reloginUseful\(reason\)\) \{/);
});
