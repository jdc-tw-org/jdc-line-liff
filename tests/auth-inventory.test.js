/**
 * 認證盤點：**基準快照比對**，加上「這把尺自己還準不準」的三組自驗。
 *
 * ══ 為何是快照、不是寫死的期望值（這一格是拍板的，不要改回去）═══════════
 *
 * 本檔量的第②格是**第一道**門檻。「這一頁有幾道門」今天**仍然是推論**——
 * 2026-09-16 一手證實過它會錯：`getActivityStats` 不在後端的 messaging 第二道清冊上，
 * 而它的 handler 第一行就是 `boardOrViewAuthFromIdentity_`。
 * 🔴 **「不在清冊上」≠「沒有第二道」——第二道可以手寫在 handler 裡而不進任何清冊。**
 *
 * ⇒ 現在把答案寫死，等於把一個**已知會錯**的答案釘進程式。
 *   （期望值比註解更像事實：執行者跑出正確結果，反而會回頭把正確的改壞。）
 *   **快照不宣稱誰對，只說「變了」。** 解除條件寫在 `tests/helpers/auth-scan.js` 的檔頭。
 *
 * ══ 這條紅的時候該怎麼辦 ═══════════════════════════════════════════════
 *
 *   1. 看它印出來的逐行差異——它會指出是**哪一頁的哪一格**變了。
 *   2. 問「這是有意的嗎」。
 *      · 是（例如刻意把某頁的 `?t=` 拆掉）⇒ `node tests/helpers/auth-scan.js` 重產，**在同一顆 commit 裡**。
 *      · 否 ⇒ 你剛剛靜默改掉了某一頁怎麼認人。
 *   3. ⚠️ **不要為了讓它綠而重產。** 重產是宣告「我知道它變了」，不是消音。
 *
 * ══ ⚠️ 三組自驗在防什麼 ═══════════════════════════════════════════════
 *
 * 快照比對有一個致命的失效方式：**抽取器整支壞掉、回傳空的，快照也會「逐字相同」**
 * （因為基準檔是同一支壞掉的抽取器產的，只要它壞得夠穩定）。
 * ⇒ 所以下面每一條都**自帶對照組**：斷言「該抓到的有抓到」與「該漏的確實漏」成對出現。
 *   只寫其中一半的話，`shapes()` 恆回空陣列時三條會一起假通過。
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const AS = require('./helpers/action-scan.js');
const A = require('./helpers/auth-scan.js');

const sh = (code) => A.shapes(AS.tokenize(code)).map((h) => h.s);

/* ══════════════════════════════════════════════════════════════════════
 * 一、基準快照
 * ════════════════════════════════════════════════════════════════════ */

test('認證盤點與基準快照逐字相同（不同就是有一頁的認人方式變了）', () => {
  assert.ok(fs.existsSync(A.DEFAULT_OUT), '基準檔不存在：tests/auth-inventory.baseline.md');
  const want = fs.readFileSync(A.DEFAULT_OUT, 'utf8');
  const got = A.build();
  if (want !== got) {
    const a = want.split('\n'); const b = got.split('\n');
    const diff = [];
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (a[i] !== b[i]) diff.push('第 ' + (i + 1) + ' 行\n  基準：' + (a[i] ?? '（無此行）') + '\n  現況：' + (b[i] ?? '（無此行）'));
    }
    assert.fail('認證盤點與基準檔不同。有意的話跑 `node tests/helpers/auth-scan.js` 重產，'
      + '並在同一顆 commit 裡送出。\n' + diff.join('\n'));
  }
});

/* ══════════════════════════════════════════════════════════════════════
 * 二、⬛ 零點與對照：這把尺分不分得開
 * ════════════════════════════════════════════════════════════════════ */

test('⬛ 零點：`staff.html`（解析 API）與 `board.html`（共用函式）都要命中——只中一個就是定義域還是窄的', () => {
  const s = A.tokenVerdict('staff.html');
  const b = A.tokenVerdict('board.html');
  assert.ok(s.shapes.length > 0, 'staff.html 一個形狀都沒命中 ⇒ 抽取器壞了或定義域變窄');
  assert.ok(b.shapes.length > 0, 'board.html 一個形狀都沒命中 ⇒ 抽取器壞了或定義域變窄');
  // ⚠️ 只斷言「兩者用的是**不同**形狀」，不斷言各是哪一種——
  //    `board.html` 2026-09 就從正則改成共用函式，寫死形狀名等於替一個會變的東西背書。
  assert.notDeepStrictEqual(s.shapes, b.shapes,
    '兩頁命中了完全一樣的形狀集合 ⇒ 這個零點失去鑑別力（它要證明的是「兩種不同寫法都接得住」）');
});

test('⬛ 對照：`stats.html`＝活的、`line-messages.html`＝墓碑——兩者都命中形狀但結論相反', () => {
  // 🪦 **這一條的「活的」那一半 2026-09-18 從 `admin.html` 換成 `stats.html`**
  //    （`jdc-tw-org/jdc-line-gas#99`）。原因不是挑一個會過的：`admin.html` 那一頁
  //    整個退場成墓碑，**它連 token 都不再讀** ⇒ 它一個形狀都不命中，
  //    而這一條需要的正是「兩頁都命中形狀、結論卻相反」。
  //    ⚠️ `stats.html` 這一輪刻意維持雙軌（副總走 `VIEW_TOKENS`，`view` 在
  //       `NOT_ASSIGNABLE_ROLES` 裡、結構上沒有 LINE 路）⇒ 它會是最後一批才退場的。
  //    🔴 **解除條件**：等 `stats.html` 也退場時，這一條要再換一頁「活的」，
  //       而不是把它刪掉——刪掉的話「命中數」就悄悄變成判定的依據了。
  const ad = A.tokenVerdict('stats.html');
  const lm = A.tokenVerdict('line-messages.html');
  assert.ok(ad.shapes.length > 0 && lm.shapes.length > 0,
    '對照組要成立，兩頁都必須命中形狀；有一頁沒命中的話「命中數」就有鑑別力了，本條就白測');
  assert.strictEqual(ad.verdict, '活的');
  assert.strictEqual(lm.verdict, '墓碑（讀了但不送）');
});

test('🪦 `admin.html` 退場之後，它連 token 都不讀了', () => {
  // 🔴 這一條是上面那一條「換掉主角」的理由本身，釘成可執行的斷言——
  //    不然「為什麼換人」只活在註解裡，而註解對下一個人是零攔截力。
  const ad = A.tokenVerdict('admin.html');
  assert.strictEqual(ad.shapes.length, 0,
    '`admin.html` 又開始讀 token 了（命中形狀：' + ad.shapes.join('、') + '）'
    + ' ⇒ 那一頁是墓碑，它不該再有任何認人的動作');
});

test('兩把尺不一致時必須是 `不確定`，不可以靜靜挑一邊', () => {
  // 今天沒有任何一頁處於不一致狀態。哪天有了，這條會紅並逼人去看那一頁。
  const bad = AS.pages().filter((p) => A.tokenVerdict(p).verdict.startsWith('🔴'));
  assert.deepStrictEqual(bad, [], '有頁面落在「送了 token 卻找不到讀取點」⇒ 兩把尺打架，要人去判，不要重產基準蓋掉');
});

/* ══════════════════════════════════════════════════════════════════════
 * 三、🔴 盲區：釘住「抓不到」，而不是寫在註解裡
 *
 * 每一條都是一對：**抓不到的那個** ＋ **同一條路上抓得到的對照組**。
 * 哪天有人改進了抽取器讓盲區消失，這裡會紅——那是好事，更新它並把檔頭那段盲區描述一起改。
 * ════════════════════════════════════════════════════════════════════ */

test('🔴 盲區①：位置取值（參數名一個字都沒出現）抓不到——對照組：同一條路的字串外科抓得到', () => {
  assert.deepStrictEqual(sh("var x = location.search.slice(1).split('=')[1] || '';"), [],
    '盲區①消失了：位置取值現在抓得到 ⇒ 更新 auth-scan.js 檔頭的盲區清單');
  assert.deepStrictEqual(sh("var x = location.search.split('?t=')[1] || '';"), ['S2'],
    '對照組失效：字串外科本來就該被 S2 接住。兩條一起壞＝抽取器整支回空的');
});

test('🔴 盲區②：參數名先存進變數抓不到——對照組：名字直接當引數抓得到', () => {
  assert.deepStrictEqual(sh("var k = 't'; var x = new URLSearchParams(location.search).get(k) || '';"), [],
    '盲區②消失了：名字先進變數現在抓得到 ⇒ 更新 auth-scan.js 檔頭的盲區清單');
  assert.deepStrictEqual(sh("var x = new URLSearchParams(location.search).get('t') || '';"), ['S1'],
    '對照組失效：名字直接當引數本來就該被 S1 接住');
  // 這個盲區是**刻意的取捨**：放寬成「任何 `'t'` 字串」會把下面這種收進來（實測的假陽性形狀）。
  assert.deepStrictEqual(sh("propRows(['x'], rt, 't', RAMP4, labels);"), [],
    '放寬 S1 之後假陽性回來了：第二引數的 `t` 不是參數名');
});

test('🔴 盲區③：action 名不在第一引數時，`literalCalls()` 抽不到——對照組：在第一引數時抽得到', () => {
  const miss = AS.literalCalls("gasCall(GAS_URL, 'listMyPages', { idToken: x });").map((c) => c.arg);
  assert.ok(!miss.includes('listMyPages'),
    '盲區③消失了：action 名在第二引數現在抽得到 ⇒ 更新檔頭，並重產基準（me/line-messages 那兩格會從「抽不到」變成真值）');
  const hit = AS.literalCalls("jsonp('listMyPages', { idToken: x });").map((c) => c.arg);
  assert.ok(hit.includes('listMyPages'), '對照組失效：第一引數是字串的呼叫本來就該抽得到');
});

/* ══════════════════════════════════════════════════════════════════════
 * 四、母體不可以退化成手寫清單
 * ════════════════════════════════════════════════════════════════════ */

test('頁面母體是現掃出來的，加一頁會自動進基準', () => {
  const pages = AS.pages();
  assert.ok(pages.length >= 13, '頁數掉到 13 以下 ⇒ 母體抽法壞了（現掃 repo 根目錄的 *.html）');
  const body = fs.readFileSync(A.DEFAULT_OUT, 'utf8');
  pages.forEach((p) => assert.ok(body.includes('`' + p + '`'), p + ' 不在基準檔裡 ⇒ 有人加了一頁而沒重產'));
});
